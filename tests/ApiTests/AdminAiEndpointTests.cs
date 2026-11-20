using System.Net;
using System.Text.Json;
using Domain.Entity;
using Domain.Enum;
using Domain.Events;

namespace ApiTests;

/// <summary>Admin "AI" (docs/api/admin.md §5b): prompts (draft, publish, rollback, history), trials, model settings, ai.manage.</summary>
public class AdminAiEndpointTests(StoreSocialApiFactory factory) : IClassFixture<StoreSocialApiFactory>
{
    private const string Palette = "palette.instructions";

    [Fact]
    public async Task AiManage_IsSuperAdminOnly_ByDefault()
    {
        var super = await factory.AdminAsync();
        var me = await (await super.GetAsync("v1/admin/auth/me")).JsonAsync();
        Assert.Contains("ai.manage", me.GetProperty("permissions").EnumerateArray().Select(p => p.GetString()));

        foreach (var role in new[] { AdminRole.ContentEditor, AdminRole.Moderator })
        {
            var admin = await factory.AdminAsync(role);
            foreach (var path in new[] { "v1/admin/ai/prompt", $"v1/admin/ai/prompt/{Palette}", "v1/admin/ai/model", "v1/admin/ai/trial/x" })
                Assert.Equal(HttpStatusCode.Forbidden, (await admin.GetAsync(path)).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await admin.PutJsonAsync($"v1/admin/ai/prompt/{Palette}/draft", new { text = "x" })).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await admin.PostJsonAsync($"v1/admin/ai/prompt/{Palette}/publish", new { })).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await admin.PostJsonAsync("v1/admin/ai/trial", new { type = "models" })).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await admin.PutJsonAsync("v1/admin/ai/model", new { values = new { TextModel = "x" } })).StatusCode);
        }
        var (user, _) = await factory.RegisterAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await user.GetAsync("v1/admin/ai/prompt")).StatusCode);
    }

    [Fact]
    public async Task List_And_Detail_ShowTheCodeDefault_Variables_AndTheSchema()
    {
        var admin = await factory.AdminAsync();
        var list = await (await admin.GetAsync("v1/admin/ai/prompt")).JsonAsync();
        var keys = list.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("key").GetString()).ToList();
        Assert.Equal(Infrastructure.Ai.PromptCatalog.All.Count, keys.Count);
        Assert.Contains("stylist.outfit.instructions", keys);
        Assert.Contains("tryon.image.body", keys);
        Assert.Contains("tryon.image.photo.body", keys);
        Assert.Contains("tryon.image.photo.face", keys);
        Assert.Contains("photo_check.reference.instructions", keys);

        var face = await (await admin.GetAsync("v1/admin/ai/prompt/tryon.image.face")).JsonAsync();
        Assert.Equal(Infrastructure.Ai.OpenAiPrompts.TryOnFromFaceTemplate, face.GetProperty("defaultText").GetString());
        Assert.Equal(JsonValueKind.Null, face.GetProperty("publishedText").ValueKind);
        Assert.Equal("preview", face.GetProperty("trialMode").GetString());
        Assert.Contains(face.GetProperty("variables").EnumerateArray(), v => v.GetProperty("name").GetString() == "bodyShape" && v.GetProperty("required").GetBoolean());

        var outfit = await (await admin.GetAsync("v1/admin/ai/prompt/stylist.outfit.instructions")).JsonAsync();
        Assert.Equal("chat", outfit.GetProperty("trialMode").GetString());
        Assert.Contains("\"suggestions\"", outfit.GetProperty("schema").GetString());
        Assert.Contains("\"candidates\"", outfit.GetProperty("sampleInput").GetString());

        var schema = await (await admin.GetAsync("v1/admin/ai/prompt/stylist.outfit.schema")).JsonAsync();
        Assert.False(schema.GetProperty("summary").GetProperty("editable").GetBoolean());
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync("v1/admin/ai/prompt/nope")).StatusCode);
    }

    [Fact]
    public async Task Draft_IsValidated_PlaceholdersLengthAndViewOnlySchemas()
    {
        var admin = await factory.AdminAsync();
        var bad = await admin.PutJsonAsync("v1/admin/ai/prompt/tryon.image.face/draft", new { text = "Photo of {{bodyShape}} in {{city}}." });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        var errors = (await bad.JsonAsync()).GetProperty("errors");
        Assert.Equal("missing", errors.GetProperty("placeholders.garmentCount")[0].GetString());
        Assert.Equal("unknown", errors.GetProperty("placeholders.city")[0].GetString());

        var tooLong = await admin.PutJsonAsync("v1/admin/ai/prompt/palette.request/draft", new { text = new string('x', 2001) });
        Assert.Equal("too_long", (await tooLong.JsonAsync()).GetProperty("errors").GetProperty("text")[0].GetString());
        var schema = await admin.PutJsonAsync("v1/admin/ai/prompt/palette.schema/draft", new { text = "{}" });
        Assert.Equal("read_only", (await schema.JsonAsync()).GetProperty("errors").GetProperty("text")[0].GetString());

        var moved = await admin.PutJsonAsync("v1/admin/ai/prompt/item.match.request/draft", new { text = "{{candidates}} candidates follow the piece{{pieceHint}}." });
        Assert.Equal(HttpStatusCode.OK, moved.StatusCode);
        var detail = await moved.JsonAsync();
        Assert.Equal(["cache_prefix_shorter"], detail.GetProperty("warnings").EnumerateArray().Select(w => w.GetString()));
        Assert.True(detail.GetProperty("summary").GetProperty("hasDraft").GetBoolean());
        Assert.Equal(0, detail.GetProperty("summary").GetProperty("publishedVersion").GetInt32());

        var discarded = await (await admin.DeleteAsync("v1/admin/ai/prompt/item.match.request/draft")).JsonAsync();
        Assert.Equal(JsonValueKind.Null, discarded.GetProperty("draftText").ValueKind);
    }

    [Fact]
    public async Task Publish_Then_Rollback_KeepAHistory_AndAreAuditedWithBeforeAndAfter()
    {
        var admin = await factory.AdminAsync();
        Assert.Equal("no_draft", await (await admin.PostJsonAsync($"v1/admin/ai/prompt/{Palette}/publish", new { note = "x" })).CodeAsync());

        Assert.Equal(HttpStatusCode.OK, (await admin.PutJsonAsync($"v1/admin/ai/prompt/{Palette}/draft", new { text = "Palette v1" })).StatusCode);
        Assert.Equal("version_conflict", await (await admin.PostJsonAsync($"v1/admin/ai/prompt/{Palette}/publish", new { note = "x", expectedVersion = 5 })).CodeAsync());
        var v1 = await (await admin.PostJsonAsync($"v1/admin/ai/prompt/{Palette}/publish", new { note = "first", expectedVersion = 0 })).JsonAsync();
        Assert.Equal(("Palette v1", 1), (v1.GetProperty("publishedText").GetString(), v1.GetProperty("summary").GetProperty("publishedVersion").GetInt32()));
        Assert.False(v1.GetProperty("summary").GetProperty("hasDraft").GetBoolean());

        var head = (await factory.Repository.GetAsync<AiPromptEntity>(AiPromptEntity.GetPk(), Palette))!;
        Assert.Equal(("Palette v1", 1, "first"), (head.Text, head.PublishedVersion, head.Note));

        await admin.PutJsonAsync($"v1/admin/ai/prompt/{Palette}/draft", new { text = "Palette v2" });
        await admin.PostJsonAsync($"v1/admin/ai/prompt/{Palette}/publish", new { note = "second" });
        await admin.PutJsonAsync($"v1/admin/ai/prompt/{Palette}/draft", new { text = "Palette v2" });
        Assert.Equal("already_live", await (await admin.PostJsonAsync($"v1/admin/ai/prompt/{Palette}/publish", new { })).CodeAsync());

        var back = await (await admin.PostJsonAsync($"v1/admin/ai/prompt/{Palette}/rollback", new { version = 1, note = "v2 was worse" })).JsonAsync();
        Assert.Equal(("Palette v1", 3), (back.GetProperty("publishedText").GetString(), back.GetProperty("summary").GetProperty("publishedVersion").GetInt32()));
        var toDefault = await (await admin.PostJsonAsync($"v1/admin/ai/prompt/{Palette}/rollback", new { version = 0 })).JsonAsync();
        Assert.Equal(JsonValueKind.Null, toDefault.GetProperty("publishedText").ValueKind);
        Assert.False(toDefault.GetProperty("summary").GetProperty("overridden").GetBoolean());
        Assert.Equal("already_live", await (await admin.PostJsonAsync($"v1/admin/ai/prompt/{Palette}/rollback", new { version = 0 })).CodeAsync());
        Assert.Equal("version_not_found", await (await admin.PostJsonAsync($"v1/admin/ai/prompt/{Palette}/rollback", new { version = 99 })).CodeAsync());

        var history = toDefault.GetProperty("history").EnumerateArray().ToList();
        Assert.Equal([4, 3, 2, 1], history.Select(h => h.GetProperty("version").GetInt32()));
        Assert.Equal(["rollback", "rollback", "publish", "publish"], history.Select(h => h.GetProperty("action").GetString()));
        Assert.True(history[0].GetProperty("live").GetBoolean());
        Assert.Equal(1, history[1].GetProperty("sourceVersion").GetInt32());
        Assert.Equal("v2 was worse", history[1].GetProperty("note").GetString());
        Assert.EndsWith("@droblet.test", history[1].GetProperty("author").GetString());

        var audit = (await (await admin.GetAsync("v1/admin/audit?action=ai.prompt.&limit=100")).JsonAsync()).GetProperty("items").EnumerateArray()
            .Where(e => e.GetProperty("targetId").GetString() == Palette).ToList();
        Assert.Equal(["ai.prompt.rollback", "ai.prompt.rollback", "ai.prompt.publish", "ai.prompt.publish"], audit.Select(e => e.GetProperty("action").GetString()));
        Assert.Contains("Palette v2", audit[2].GetProperty("after").GetString());
        Assert.Contains("Palette v1", audit[2].GetProperty("before").GetString());
        Assert.Contains("(code default)", audit[0].GetProperty("after").GetString());

        var listed = (await (await admin.GetAsync("v1/admin/ai/prompt")).JsonAsync()).GetProperty("items").EnumerateArray()
            .Single(i => i.GetProperty("key").GetString() == Palette);
        Assert.Equal(4, listed.GetProperty("publishedVersion").GetInt32());
        Assert.NotEqual(JsonValueKind.Null, listed.GetProperty("publishedBy").ValueKind);
    }

    [Fact]
    public async Task AutomaticFallback_IsListed_ForTheBanner_AndCanBeAcknowledged()
    {
        var admin = await factory.AdminAsync();
        await factory.Repository.SaveAsync(new AiPromptEntity
        {
            Key = "photo_check.face.instructions", PublishedVersion = 3, Text = null, Version = 3,
            Fallback = new AiPromptFallback(DateTime.UtcNow, 2, 3, 5, "invalid_output"),
        });
        var item = (await (await admin.GetAsync("v1/admin/ai/prompt")).JsonAsync()).GetProperty("items").EnumerateArray()
            .Single(i => i.GetProperty("key").GetString() == "photo_check.face.instructions");
        Assert.Equal(2, item.GetProperty("fallback").GetProperty("fromVersion").GetInt32());
        Assert.False(item.GetProperty("fallback").GetProperty("acknowledged").GetBoolean());

        var acknowledged = await (await admin.PostJsonAsync("v1/admin/ai/prompt/photo_check.face.instructions/acknowledge", new { })).JsonAsync();
        Assert.True(acknowledged.GetProperty("summary").GetProperty("fallback").GetProperty("acknowledged").GetBoolean());
    }

    [Fact]
    public async Task Trials_ChatPromptIsQueuedForTheStylistWorker_ImagePromptIsAPreview_VisionNeedsCatalogImages()
    {
        var admin = await factory.AdminAsync();
        await admin.PutJsonAsync("v1/admin/ai/prompt/stylist.week.instructions/draft", new { text = "Week draft" });

        var queued = await admin.PostJsonAsync("v1/admin/ai/trial", new { type = "prompt", key = "stylist.week.instructions" });
        Assert.Equal(HttpStatusCode.Accepted, queued.StatusCode);
        var trial = await queued.JsonAsync();
        var id = trial.GetProperty("id").GetString()!;
        Assert.Equal("queued", trial.GetProperty("status").GetString());
        var published = Assert.Single(factory.Events.Published.OfType<AiTrialRequestedEvent>(), e => e.JobId == id);
        Assert.Equal(JobKind.AiTrial, published.Kind);
        var stored = (await factory.Repository.GetAsync<AiTrialEntity>(AiTrialEntity.GetPk(), id))!;
        Assert.Equal("Week draft", stored.Text);
        Assert.Contains("\"days\"", stored.Input);
        Assert.Equal("queued", (await (await admin.GetAsync($"v1/admin/ai/trial/{id}")).JsonAsync()).GetProperty("status").GetString());

        var badInput = await admin.PostJsonAsync("v1/admin/ai/trial", new { type = "prompt", key = "stylist.week.instructions", input = "not json" });
        Assert.Equal("invalid_json", (await badInput.JsonAsync()).GetProperty("errors").GetProperty("input")[0].GetString());

        var preview = await admin.PostJsonAsync("v1/admin/ai/trial", new { type = "prompt", key = "tryon.image.body", text = "Wear {{garmentCount}} garments." });
        Assert.Equal(HttpStatusCode.OK, preview.StatusCode);
        var rendered = await preview.JsonAsync();
        Assert.Equal(("succeeded", "Wear 2 garments."), (rendered.GetProperty("status").GetString(), rendered.GetProperty("output").GetString()));

        var noImage = await admin.PostJsonAsync("v1/admin/ai/trial", new { type = "prompt", key = "item.detect.instructions" });
        Assert.Equal("count", (await noImage.JsonAsync()).GetProperty("errors").GetProperty("imageUrls")[0].GetString());
        var foreign = await admin.PostJsonAsync("v1/admin/ai/trial", new { type = "prompt", key = "item.detect.instructions", imageUrls = new[] { "https://evil.example/a.jpg" } });
        Assert.Equal("invalid_url", (await foreign.JsonAsync()).GetProperty("errors").GetProperty("imageUrls")[0].GetString());
        var ok = await admin.PostJsonAsync("v1/admin/ai/trial", new
        {
            type = "prompt", key = "item.detect.instructions", imageUrls = new[] { "https://test-catalog-images.s3.eu-central-1.amazonaws.com/catalog/library/a.jpg" },
        });
        Assert.Equal(HttpStatusCode.Accepted, ok.StatusCode);

        var model = await admin.PostJsonAsync("v1/admin/ai/trial", new { type = "model", model = "gpt-5-mini", modelKind = "text", effort = "minimal" });
        Assert.Equal(HttpStatusCode.Accepted, model.StatusCode);
        var badModel = await admin.PostJsonAsync("v1/admin/ai/trial", new { type = "model", model = "bad id", modelKind = "video", effort = "turbo" });
        var modelErrors = (await badModel.JsonAsync()).GetProperty("errors");
        Assert.True(modelErrors.TryGetProperty("model", out _) && modelErrors.TryGetProperty("modelKind", out _) && modelErrors.TryGetProperty("effort", out _));

        var audit = (await (await admin.GetAsync("v1/admin/audit?action=ai.trial&limit=100")).JsonAsync()).GetProperty("items");
        Assert.Contains(audit.EnumerateArray(), e => e.GetProperty("targetId").GetString() == id);
    }

    [Fact]
    public async Task ModelSettings_AreCheckedAgainstTheAllowList_WrittenToWorkerAi_AndAudited()
    {
        factory.Settings.Values["/droblet/dev/worker/Ai"] = """{"Enabled":true,"Provider":"OpenAI","TextModel":"gpt-6-astra","ImageModel":"gpt-image-2","FastTextModel":"gpt-5-mini","ReasoningEffort":{"outfit":"low"}}""";
        await factory.Repository.DeleteAsync(AiModelListEntity.GetPk(), AiModelListEntity.GetSk());
        var admin = await factory.AdminAsync();

        var settings = await (await admin.GetAsync("v1/admin/ai/model")).JsonAsync();
        Assert.Equal(60, settings.GetProperty("reloadSeconds").GetInt32());
        Assert.Empty(settings.GetProperty("availableModels").EnumerateArray());
        var fields = settings.GetProperty("settings").GetProperty("fields").EnumerateArray().ToDictionary(f => f.GetProperty("key").GetString()!);
        Assert.Equal("gpt-6-astra", fields["TextModel"].GetProperty("value").GetString());
        Assert.Equal("model", fields["TextModel"].GetProperty("type").GetString());
        Assert.Equal("low", fields["ReasoningEffort.outfit"].GetProperty("value").GetString());
        Assert.Contains("xhigh", fields["ReasoningEffort.outfit"].GetProperty("options").EnumerateArray().Select(o => o.GetString()));

        // No allow-list yet: model ids cannot be saved (refresh it first); other fields can.
        var unknown = await admin.PutJsonAsync("v1/admin/ai/model", new { values = new Dictionary<string, object> { ["TextModel"] = "gpt-6.1-sol" } });
        Assert.Equal("models_unknown", (await unknown.JsonAsync()).GetProperty("errors").GetProperty("TextModel")[0].GetString());

        await factory.Repository.SaveAsync(new AiModelListEntity { Ids = ["gpt-5-mini", "gpt-6-astra", "gpt-6.1-sol", "gpt-image-2"], FetchedAt = DateTime.UtcNow });
        var notAvailable = await admin.PutJsonAsync("v1/admin/ai/model", new { values = new Dictionary<string, object> { ["ImageModel"] = "gpt-image-9" } });
        Assert.Equal("not_available", (await notAvailable.JsonAsync()).GetProperty("errors").GetProperty("ImageModel")[0].GetString());
        var invalid = await admin.PutJsonAsync("v1/admin/ai/model", new { values = new Dictionary<string, object?> { ["ReasoningEffort.packing"] = "turbo", ["TextModel"] = null } });
        var invalidErrors = (await invalid.JsonAsync()).GetProperty("errors");
        Assert.Equal("invalid", invalidErrors.GetProperty("ReasoningEffort.packing")[0].GetString());
        Assert.Equal("invalid", invalidErrors.GetProperty("TextModel")[0].GetString());

        var ok = await admin.PutJsonAsync("v1/admin/ai/model", new
        {
            values = new Dictionary<string, object?>
            {
                ["TextModel"] = "gpt-6.1-sol", ["FastTextModel"] = null, ["ReasoningEffort.outfit"] = null, ["ReasoningEffort.photo_check"] = "minimal",
                ["Image.TryOnQuality"] = "medium", ["ServiceTier"] = "priority", ["FastTextOperations"] = "photo_check,item_match",
            },
        });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var stored = JsonDocument.Parse(factory.Settings.Values["/droblet/dev/worker/Ai"]).RootElement;
        Assert.True(stored.GetProperty("Enabled").GetBoolean());
        Assert.Equal("OpenAI", stored.GetProperty("Provider").GetString());
        Assert.Equal("gpt-6.1-sol", stored.GetProperty("TextModel").GetString());
        Assert.False(stored.TryGetProperty("FastTextModel", out _));
        Assert.False(stored.GetProperty("ReasoningEffort").TryGetProperty("outfit", out _));
        Assert.Equal("minimal", stored.GetProperty("ReasoningEffort").GetProperty("photo_check").GetString());
        Assert.Equal("medium", stored.GetProperty("Image").GetProperty("TryOnQuality").GetString());

        var audit = (await (await admin.GetAsync("v1/admin/audit?action=ai.models.&limit=10")).JsonAsync()).GetProperty("items")[0];
        Assert.Contains("gpt-6-astra", audit.GetProperty("before").GetString());
        Assert.Contains("gpt-6.1-sol", audit.GetProperty("after").GetString());
        Assert.DoesNotContain("TimeoutSeconds", audit.GetProperty("after").GetString()); // only the changed keys
    }

    [Fact]
    public async Task ModelGroup_IsNotOnTheGenericSettingsPage_NorWritableThroughIt()
    {
        var admin = await factory.AdminAsync();
        var groups = (await (await admin.GetAsync("v1/admin/setting")).JsonAsync()).EnumerateArray().Select(g => g.GetProperty("group").GetString());
        Assert.DoesNotContain("aiModels", groups);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PutJsonAsync("v1/admin/setting/aiModels", new { values = new Dictionary<string, object> { ["PromptCacheKey"] = true } })).StatusCode);
        Assert.DoesNotContain("aiLimits", groups);
    }

    [Fact]
    public async Task AiLimits_AreEditable_PricingIsShownReadOnly()
    {
        factory.Settings.Values["/droblet/dev/api/AiLimits"] = """{"StylistJobsPerDay":40,"ItemRecognitionsPerDay":150,"PaletteAnalysesPerDay":5,"AiStartsPerMinute":20}""";
        factory.Settings.Values["/droblet/dev/worker/Ai/Pricing"] = """{"Models":{"gpt-6-astra":{"Input":10}}}""";
        var admin = await factory.AdminAsync();

        var settings = await (await admin.GetAsync("v1/admin/ai/model")).JsonAsync();
        Assert.Contains("gpt-6-astra", settings.GetProperty("pricing").GetString());
        Assert.Equal(40, settings.GetProperty("limits").GetProperty("fields")[0].GetProperty("value").GetInt32());

        var bad = await admin.PutJsonAsync("v1/admin/ai/limits", new { values = new Dictionary<string, object> { ["StylistJobsPerDay"] = -1 } });
        Assert.Equal("out_of_range", (await bad.JsonAsync()).GetProperty("errors").GetProperty("StylistJobsPerDay")[0].GetString());
        Assert.Equal(HttpStatusCode.OK, (await admin.PutJsonAsync("v1/admin/ai/limits", new { values = new Dictionary<string, object> { ["StylistJobsPerDay"] = 60 } })).StatusCode);
        var stored = JsonDocument.Parse(factory.Settings.Values["/droblet/dev/api/AiLimits"]).RootElement;
        Assert.Equal((60, 150), (stored.GetProperty("StylistJobsPerDay").GetInt32(), stored.GetProperty("ItemRecognitionsPerDay").GetInt32()));
        var audit = (await (await admin.GetAsync("v1/admin/audit?action=ai.limits.&limit=10")).JsonAsync()).GetProperty("items")[0];
        Assert.Contains("60", audit.GetProperty("after").GetString());
    }
}
