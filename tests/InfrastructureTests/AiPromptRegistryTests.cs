using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using Domain.Entity;
using Domain.Enum;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Domain.Services.Admin;
using Domain.Services.Ai;
using Infrastructure.Ai;
using Infrastructure.Services.Admin;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using Tests.Shared;

namespace InfrastructureTests;

/// <summary>Prompt catalog (code defaults byte-identical), validation, registry cache / fallback / safety, provider wiring.</summary>
public class PromptCatalogTests
{
    [Fact]
    public void Keys_AreUnique_AndEveryAiFeatureIsCovered()
    {
        Assert.Equal(PromptCatalog.All.Count, PromptCatalog.All.Select(d => d.Key).Distinct().Count());
        foreach (var feature in new[] { "common", "stylist", "wardrobe", "outfit_import", "palette", "tryon", "cleanup" })
            Assert.Contains(PromptCatalog.All, d => d.Feature == feature);
        foreach (var key in new[] { "stylist.outfit.instructions", "stylist.week.instructions", "stylist.pack.instructions", "tryon.image.body", "tryon.image.face",
                     "item.detect.instructions", "item.match.instructions", "item.match.request", "palette.instructions", "photo_check.body.instructions",
                     "cleanup.item.image", "cleanup.item.jewellery.image", "common.language" })
            Assert.NotNull(PromptCatalog.Find(key));
    }

    [Fact]
    public void EveryEditableDefault_PassesItsOwnValidation_AndSchemasAreViewOnly()
    {
        foreach (var definition in PromptCatalog.All)
        {
            if (definition.Editable)
                Assert.Empty(PromptCatalog.Validate(definition, definition.Default()));
            else
                Assert.Equal(["read_only"], PromptCatalog.Validate(definition, "{}")["text"]);
        }
    }

    [Fact]
    public void EverySchemaDefault_IsTheJsonSchemaTheProviderSends()
    {
        foreach (var definition in PromptCatalog.All.Where(d => d.Kind == PromptKind.Schema))
            Assert.IsType<JsonObject>(JsonNode.Parse(definition.Default()));
        Assert.Equal(JsonNode.Parse(PromptCatalog.Find("stylist.outfit.schema")!.Default())!.ToJsonString(), Domain.Services.Styling.AiSchemas.OutfitSchema().ToJsonString());
    }

    // The code default of a templated prompt, rendered with the values the provider passes, is exactly the text it sent
    // before the registry existed (OpenAiPrompts). After a text change in OpenAiPrompts this still holds by construction.

    [Theory]
    [InlineData(1)]
    [InlineData(3)]
    public void TryOnBody_DefaultRendersExactlyLikeTheCode(int garments)
    {
        Assert.Equal(OpenAiPrompts.TryOn(garments),
            PromptTemplate.Render(PromptCatalog.Find("tryon.image.body")!.Default(), ("garmentCount", garments.ToString(System.Globalization.CultureInfo.InvariantCulture))));
    }

    [Fact]
    public void TryOnFace_DefaultRendersExactlyLikeTheCode_ForEveryFigure()
    {
        foreach (var body in Enum.GetValues<BodyType>())
            foreach (var height in new int?[] { null, 168 })
                foreach (var size in new ClothingSize?[] { null, ClothingSize.L })
                {
                    var figure = new TryOnFigure(body, height, size);
                    Assert.Equal(OpenAiPrompts.TryOnFromFace(2, figure),
                        PromptTemplate.Render(PromptCatalog.Find("tryon.image.face")!.Default(), OpenAiPrompts.TryOnFromFaceValues(2, figure)));
                }
    }

    [Theory]
    [InlineData(null, "ring", true)]
    [InlineData(ItemCategoryHint.Accessory, "necklace", true)]
    [InlineData(ItemCategoryHint.Shoes, "ankle-boots", false)]
    [InlineData(ItemCategoryHint.Top, null, false)]
    [InlineData(null, null, false)]
    public void CleanupItem_DefaultRendersExactlyLikeTheCode(ItemCategoryHint? category, string? subcategory, bool jewellery)
    {
        Assert.Equal(OpenAiPrompts.CleanupItem(category, subcategory),
            PromptTemplate.Render(PromptCatalog.Find(PromptCatalog.CleanupItem(jewellery))!.Default(), ("piece", OpenAiPrompts.CleanupPiece(category, subcategory))));
    }

    [Theory]
    [InlineData(2, null)]
    [InlineData(4, "denim jacket")]
    public void MatchRequest_And_Language_DefaultsRenderExactlyLikeTheCode(int candidates, string? hint)
    {
        Assert.Equal(OpenAiPrompts.ItemMatchRequest(candidates, hint),
            PromptTemplate.Render(PromptCatalog.Find("item.match.request")!.Default(), OpenAiPrompts.ItemMatchRequestValues(candidates, hint)));
        foreach (var language in new[] { "tr", "en", "de" })
            Assert.Equal(OpenAiPrompts.Stylist(JobKind.StylistOutfit, language),
                PromptCatalog.Find("stylist.outfit.instructions")!.Default()
                + PromptTemplate.Render(PromptCatalog.Find("common.language")!.Default(),
                    ("languageName", OpenAiPrompts.LanguageName(language)), ("languageCode", Localized.Language(language))));
    }

    [Fact]
    public void Validate_RequiredMissing_Unknown_TooLong_Malformed_Empty()
    {
        var face = PromptCatalog.Find("tryon.image.face")!;
        var errors = PromptCatalog.Validate(face, "Photo with {{bodyShape}} and {{mood}}.");
        Assert.Equal(["missing"], errors["placeholders.garmentCount"]);
        Assert.Equal(["unknown"], errors["placeholders.mood"]);
        Assert.False(errors.ContainsKey("placeholders.height")); // optional

        Assert.Equal(["too_long"], PromptCatalog.Validate(PromptCatalog.Find("palette.request")!, new string('a', PromptCatalog.RequestMaxLength + 1))["text"]);
        Assert.Equal(["malformed_placeholder"], PromptCatalog.Validate(PromptCatalog.Find("palette.instructions")!, "Use {{ x }} here")["text"]);
        Assert.Equal(["empty"], PromptCatalog.Validate(PromptCatalog.Find("palette.instructions")!, "  ")["text"]);
        Assert.Equal(["unknown"], PromptCatalog.Validate(PromptCatalog.Find("stylist.outfit.instructions")!, "Hi {{languageName}}")["placeholders.languageName"]);
    }

    [Fact]
    public void CacheWarning_WhenAVariableMovesAboveTheStaticText()
    {
        var match = PromptCatalog.Find("item.match.request")!;
        Assert.Empty(PromptCatalog.CacheWarnings(match, match.Default()));
        Assert.Equal(["cache_prefix_shorter"], PromptCatalog.CacheWarnings(match, "{{candidates}} candidates. First image: the piece{{pieceHint}}."));
        Assert.Empty(PromptCatalog.CacheWarnings(PromptCatalog.Find("palette.instructions")!, "anything"));
    }
}

public class PromptRegistryTests
{
    private sealed class CountingRepository(InMemoryRepository inner) : DelegatingRepository(inner)
    {
        public int PromptReads { get; private set; }
        public bool Fail { get; set; }

        public override Task<List<T>> GetAllAsync<T>(string pk, CancellationToken ct = default)
        {
            if (pk == AiPromptEntity.GetPk())
            {
                PromptReads++;
                if (Fail)
                    throw new Amazon.DynamoDBv2.AmazonDynamoDBException("unreachable");
            }
            return base.GetAllAsync<T>(pk, ct);
        }
    }

    private static (PromptRegistry Registry, CountingRepository Repository, InMemoryRepository Store, FakeTimeProvider Clock, AiOptions Options) Create()
    {
        var store = new InMemoryRepository();
        var repository = new CountingRepository(store);
        var clock = Fixtures.Clock();
        var options = new AiOptions();
        var audit = new AuditLog(store, clock, NullLogger<AuditLog>.Instance);
        var registry = new PromptRegistry(new Lazy<IRepository>(repository), Fixtures.Monitor(options), new Lazy<IAuditLog>(audit), clock, NullLogger<PromptRegistry>.Instance);
        return (registry, repository, store, clock, options);
    }

    private static async Task PublishAsync(InMemoryRepository store, string key, params string?[] versions)
    {
        var head = new AiPromptEntity { Key = key };
        for (var i = 0; i < versions.Length; i++)
            await store.SaveAsync(new AiPromptVersionEntity { Key = key, Number = i + 1, Text = versions[i], At = Fixtures.Now });
        head.PublishedVersion = versions.Length;
        head.Version = versions.Length; // as written by the versioned publish
        head.Text = versions[^1];
        await store.SaveAsync(head);
    }

    [Fact]
    public async Task NoOverride_IsNull_TheCodeDefaultApplies()
    {
        var (registry, _, _, _, _) = Create();
        Assert.Null(await registry.GetAsync("palette.instructions", default));
    }

    [Fact]
    public async Task PublishedOverride_IsServed_FromCache_UntilTheTtl()
    {
        var (registry, repository, store, clock, _) = Create();
        await PublishAsync(store, "palette.instructions", "v1 text");

        Assert.Equal(new PromptOverride("palette.instructions", 1, "v1 text"), await registry.GetAsync("palette.instructions", default));
        await PublishAsync(store, "palette.instructions", "v1 text", "v2 text");
        Assert.Equal("v1 text", (await registry.GetAsync("palette.instructions", default))!.Template);
        Assert.Null(await registry.GetAsync("palette.request", default));
        Assert.Equal(1, repository.PromptReads);

        clock.Advance(TimeSpan.FromSeconds(61));
        Assert.Equal("v2 text", (await registry.GetAsync("palette.instructions", default))!.Template);
        Assert.Equal(2, repository.PromptReads);
    }

    [Fact]
    public async Task ConcurrentCallers_ShareOneRead()
    {
        var (registry, repository, store, _, _) = Create();
        await PublishAsync(store, "palette.instructions", "x");
        await Task.WhenAll(Enumerable.Range(0, 20).Select(_ => registry.GetAsync("palette.instructions", default).AsTask()));
        Assert.Equal(1, repository.PromptReads);
    }

    [Fact]
    public async Task UnreachableStore_MeansCodeDefault_AndIsRetriedAfter15Seconds()
    {
        var (registry, repository, store, clock, _) = Create();
        await PublishAsync(store, "palette.instructions", "x");
        repository.Fail = true;

        Assert.Null(await registry.GetAsync("palette.instructions", default));
        Assert.Null(await registry.GetAsync("palette.instructions", default));
        Assert.Equal(1, repository.PromptReads);

        repository.Fail = false;
        clock.Advance(TimeSpan.FromSeconds(16));
        Assert.Equal("x", (await registry.GetAsync("palette.instructions", default))!.Template);
    }

    [Fact]
    public async Task RolledBackToDefault_Disabled_Or_InvalidOverride_MeansCodeDefault()
    {
        var (registry, _, store, _, options) = Create();
        await PublishAsync(store, "palette.instructions", "x", null);
        await PublishAsync(store, "tryon.image.body", "no garment count placeholder"); // a required placeholder is missing
        await PublishAsync(store, "palette.request", "y");
        Assert.Null(await registry.GetAsync("palette.instructions", default));
        Assert.Null(await registry.GetAsync("tryon.image.body", default));

        options.Prompts.Enabled = false;
        Assert.Null(await registry.GetAsync("palette.request", default));
    }

    [Fact]
    public async Task Failures_BelowTheThreshold_KeepTheOverride_AtTheThreshold_FallBackToThePreviousVersion_WithAudit()
    {
        var (registry, _, store, clock, options) = Create();
        options.Prompts.FailureThreshold = 3;
        await PublishAsync(store, "palette.instructions", "good", "bad");
        var used = new[] { (await registry.GetAsync("palette.instructions", default))! };

        await registry.ReportFailureAsync(used, "invalid_output", default);
        await registry.ReportFailureAsync(used, "invalid_output", default);
        Assert.Equal("bad", (await store.GetAsync<AiPromptEntity>(AiPromptEntity.GetPk(), "palette.instructions"))!.Text);

        await registry.ReportFailureAsync(used, "invalid_output", default);
        var head = (await store.GetAsync<AiPromptEntity>(AiPromptEntity.GetPk(), "palette.instructions"))!;
        Assert.Equal("good", head.Text);
        Assert.Equal(3, head.PublishedVersion);
        Assert.Equal(new AiPromptFallback(clock.GetUtcNow().UtcDateTime, 2, 3, 3, "invalid_output"), head.Fallback);
        var entry = (await store.GetAsync<AiPromptVersionEntity>(AiPromptVersionEntity.GetPk("palette.instructions"), AiPromptVersionEntity.GetSk(3)))!;
        Assert.Equal(("auto_fallback", 1), (entry.Action, entry.SourceVersion));
        var audit = Assert.Single(await store.GetAllAsync<AdminAuditEntity>(AdminAuditEntity.GetPk()));
        Assert.Equal(("ai.prompt.auto_fallback", "palette.instructions", null), (audit.Action, audit.TargetId, audit.AdminId));
        Assert.Contains("bad", audit.Before);
        Assert.Contains("good", audit.After);

        // The cache was dropped: the restored text is served at once.
        Assert.Equal("good", (await registry.GetAsync("palette.instructions", default))!.Template);
        // A late failure report of the old version changes nothing.
        await registry.ReportFailureAsync(used, "invalid_output", default);
        Assert.Equal(3, (await store.GetAsync<AiPromptEntity>(AiPromptEntity.GetPk(), "palette.instructions"))!.PublishedVersion);
    }

    [Fact]
    public async Task FirstPublishedVersionFailing_FallsBackToTheCodeDefault()
    {
        var (registry, _, store, _, options) = Create();
        options.Prompts.FailureThreshold = 1;
        await PublishAsync(store, "palette.instructions", "bad");
        await registry.ReportFailureAsync([(await registry.GetAsync("palette.instructions", default))!], "refused_or_cut_off", default);
        var head = (await store.GetAsync<AiPromptEntity>(AiPromptEntity.GetPk(), "palette.instructions"))!;
        Assert.Null(head.Text);
        Assert.Null(await registry.GetAsync("palette.instructions", default));
    }

    [Fact]
    public async Task ThresholdZero_NeverFallsBack()
    {
        var (registry, _, store, _, options) = Create();
        options.Prompts.FailureThreshold = 0;
        await PublishAsync(store, "palette.instructions", "a", "b");
        for (var i = 0; i < 10; i++)
            await registry.ReportFailureAsync([(await registry.GetAsync("palette.instructions", default))!], "invalid_output", default);
        Assert.Equal("b", (await store.GetAsync<AiPromptEntity>(AiPromptEntity.GetPk(), "palette.instructions"))!.Text);
    }

    [Fact]
    public void Workers_ResolveTheProvider_WithTheDynamoRegistry()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<Microsoft.Extensions.Configuration.IConfiguration>(new Microsoft.Extensions.Configuration.ConfigurationBuilder().Build());
        Infrastructure.DependencyInjection.AddDrobletCore(services, new Microsoft.Extensions.Configuration.ConfigurationBuilder().Build());
        Infrastructure.DependencyInjection.AddDrobletAi(services);
        using var provider = services.BuildServiceProvider();
        Assert.IsType<PromptRegistry>(provider.GetRequiredService<IPromptRegistry>());
        Assert.NotNull(provider.GetRequiredService<OpenAiProvider>());
    }
}

/// <summary>Every capability of the provider takes every one of its prompts from the registry (published override first).</summary>
public class ProviderReadsThroughRegistryTests
{
    private sealed class FakeRegistry : IPromptRegistry
    {
        public Dictionary<string, PromptOverride> Overrides { get; } = new(StringComparer.Ordinal);
        public List<(string Key, string Reason)> Failures { get; } = [];
        public HashSet<string> Asked { get; } = new(StringComparer.Ordinal);

        public ValueTask<PromptOverride?> GetAsync(string key, CancellationToken ct)
        {
            Asked.Add(key);
            return ValueTask.FromResult(Overrides.GetValueOrDefault(key));
        }

        public Task ReportFailureAsync(IReadOnlyCollection<PromptOverride> used, string reason, CancellationToken ct)
        {
            Failures.AddRange(used.Select(u => (u.Key, reason)));
            return Task.CompletedTask;
        }
    }

    private sealed class Handler(string chatContent) : HttpMessageHandler
    {
        public List<string> Bodies { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Bodies.Add(request.Content is null ? "" : Encoding.UTF8.GetString(await request.Content.ReadAsByteArrayAsync(cancellationToken)));
            var body = request.RequestUri!.AbsolutePath.EndsWith("/images/edits", StringComparison.Ordinal)
                ? new JsonObject { ["data"] = new JsonArray(new JsonObject { ["b64_json"] = Convert.ToBase64String([.. "RIFF"u8, 0, 0, 0, 0, .. "WEBP"u8]) }) }.ToJsonString()
                : new JsonObject
                {
                    ["model"] = "m",
                    ["choices"] = new JsonArray(new JsonObject { ["finish_reason"] = "stop", ["message"] = new JsonObject { ["content"] = chatContent } }),
                }.ToJsonString();
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        }
    }

    private static readonly ImageInput Photo = new([0xFF, 0xD8, 0xFF, 0x01], "image/jpeg");

    private static (OpenAiProvider Provider, Handler Handler) Create(FakeRegistry? registry, string chatContent = "{}")
    {
        var handler = new Handler(chatContent);
        var options = new AiOptions { Enabled = true, ApiKey = "sk-test", TextModel = "t", ImageModel = "i", BaseUrl = "https://ai.test", TimeoutSeconds = 5 };
        return (new OpenAiProvider(new HttpClient(handler), Fixtures.Monitor(options), NullLogger<OpenAiProvider>.Instance, registry), handler);
    }

    private static async Task CallEverythingAsync(OpenAiProvider provider)
    {
        foreach (var kind in new[] { JobKind.StylistOutfit, JobKind.StylistWeek, JobKind.StylistPack })
            await provider.GenerateAsync(new StylistPrompt(kind, "{}", "en"), default);
        await provider.GenerateAsync(new StylistPrompt(JobKind.StylistOutfit, "{}", "en", CompactCandidates: true), default);
        await provider.GenerateAsync(new StylistPrompt(JobKind.StylistWeek, "{}", "en", Segment: Segment.Men), default);
        await provider.GenerateAsync(new StylistPrompt(JobKind.StylistOutfit, "{}", "en", Teen: true), default);
        await provider.DescribeAsync(Photo, "en", default);
        await provider.DetectItemsAsync(Photo, "en", default);
        await provider.DetectItemsAsync(Photo, "en", Segment.Men, default);
        await provider.MatchAsync(Photo, [Photo, Photo], "ring", false, default);
        await provider.AnalyzeAsync(Photo, default);
        await provider.InspectAsync(Photo, PhotoKind.Body, default);
        await provider.InspectAsync(Photo, PhotoKind.Face, default);
        await provider.CleanupAsync(Photo, default);
        await provider.CleanupItemAsync(Photo, ItemCategoryHint.Accessory, "ring", default);
        await provider.CleanupItemAsync(Photo, ItemCategoryHint.Shoes, "ankle-boots", default);
        await provider.RenderAsync(Photo, [Photo, Photo], default);
        await provider.RenderFromFaceAsync(Photo, [Photo], new TryOnFigure(BodyType.Pear, 170, ClothingSize.M), default);
        await provider.InspectReferenceAsync(Photo, default);
        await provider.RenderOutfitPhotoAsync(Photo, Photo, null, default);
        await provider.RenderOutfitPhotoAsync(Photo, Photo, new TryOnFigure(BodyType.Pear, 170, ClothingSize.M), default);
        await provider.RenderFromFaceAsync(Photo, [Photo], new TryOnFigure(BodyType.Trapezoid, 182, ClothingSize.L, Segment.Men), default);
        await provider.RenderTeenAsync(Photo, [Photo], null, default);
    }

    [Fact]
    public async Task EveryEditablePrompt_IsReadThroughTheRegistry_AndItsOverrideIsSent()
    {
        foreach (var definition in PromptCatalog.All.Where(d => d.Editable))
        {
            var registry = new FakeRegistry();
            var marker = $"OVERRIDE-{definition.Key}";
            var template = marker + string.Concat(definition.Variables.Select(v => $" <{v.Name}={PromptTemplate.Token(v.Name)}>"));
            registry.Overrides[definition.Key] = new PromptOverride(definition.Key, 7, template);
            var (provider, handler) = Create(registry);

            await CallEverythingAsync(provider);

            Assert.Contains(definition.Key, registry.Asked);
            // The marker followed by a space, a quote or the end: "OVERRIDE-item.match.request" is not "OVERRIDE-item.match.request-x".
            var sent = handler.Bodies.Where(b => System.Text.RegularExpressions.Regex.IsMatch(b, System.Text.RegularExpressions.Regex.Escape(marker) + @"(?![\w.-])")).ToList();
            Assert.NotEmpty(sent);
            // Placeholders are filled with the call's values, never sent raw.
            Assert.All(sent, b => Assert.DoesNotContain("{{", b, StringComparison.Ordinal));
        }
    }

    [Fact]
    public async Task WithoutOverrides_RequestsAreExactlyThoseOfTheCodeDefaults()
    {
        var (withRegistry, a) = Create(new FakeRegistry());
        var (without, b) = Create(null);
        await CallEverythingAsync(withRegistry);
        await CallEverythingAsync(without);
        Assert.Equal(b.Bodies.Count, a.Bodies.Count);
        for (var i = 0; i < a.Bodies.Count; i++)
            Assert.Equal(StripBoundary(b.Bodies[i]), StripBoundary(a.Bodies[i]));
        Assert.Contains(a.Bodies, body => body.Contains(JsonValue.Create(OpenAiPrompts.Stylist(JobKind.StylistPack, "en"))!.ToJsonString()[1..^1], StringComparison.Ordinal));
    }

    private static string StripBoundary(string body) => System.Text.RegularExpressions.Regex.Replace(body, "--[0-9a-f-]{36}", "--b");

    [Fact]
    public async Task UnparsableAnswer_ReportsTheOverridesItUsed_NotTheCodeDefaults()
    {
        var registry = new FakeRegistry();
        registry.Overrides["palette.instructions"] = new PromptOverride("palette.instructions", 2, "Override");
        var (provider, _) = Create(registry, "not json");

        await Assert.ThrowsAsync<AiProviderException>(() => provider.AnalyzeAsync(Photo, default));
        Assert.Equal([("palette.instructions", "invalid_output")], registry.Failures);

        await Assert.ThrowsAsync<AiProviderException>(() => provider.InspectAsync(Photo, PhotoKind.Body, default));
        Assert.Single(registry.Failures); // the photo check used no override
    }

    [Fact]
    public async Task StylistAnswerThatDoesNotFitTheDto_IsReported_ButStillReturned()
    {
        var registry = new FakeRegistry();
        registry.Overrides["stylist.outfit.instructions"] = new PromptOverride("stylist.outfit.instructions", 1, "Override");
        var (provider, _) = Create(registry, """{"suggestions":"nope"}""");
        Assert.Equal("""{"suggestions":"nope"}""", await provider.GenerateAsync(new StylistPrompt(JobKind.StylistOutfit, "{}"), default));
        Assert.Equal([("stylist.outfit.instructions", "invalid_output")], registry.Failures);
    }

    [Fact]
    public async Task DryRun_UsesTheDraft_RecordsTheExchange_AndNeverReports()
    {
        var registry = new FakeRegistry();
        registry.Overrides["palette.instructions"] = new PromptOverride("palette.instructions", 2, "Published");
        var (provider, handler) = Create(registry, "not json");

        using (var run = PromptDryRun.Begin(new Dictionary<string, string> { ["palette.instructions"] = "Draft text" }))
        {
            await Assert.ThrowsAsync<AiProviderException>(() => provider.AnalyzeAsync(Photo, default));
            Assert.Equal("Draft text", run.SystemPrompt);
            Assert.Equal(OpenAiPrompts.PaletteRequest, run.UserPrompt);
            Assert.Equal("not json", run.RawOutput);
            Assert.Equal("m", run.UsedModel);
        }
        Assert.Contains("Draft text", handler.Bodies[0]);
        Assert.Empty(registry.Failures);
        Assert.Null(PromptDryRun.Current);
    }
}

/// <summary>Admin trials run by the Stylist worker.</summary>
public class AiTrialRunnerTests
{
    private sealed class Handler(Func<HttpRequestMessage, (HttpStatusCode, string)> answer) : HttpMessageHandler
    {
        public int Calls { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls++;
            var (status, body) = answer(request);
            return Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") });
        }
    }

    private static string Chat(string content) => new JsonObject
    {
        ["model"] = "gpt-test-2026",
        ["choices"] = new JsonArray(new JsonObject { ["finish_reason"] = "stop", ["message"] = new JsonObject { ["content"] = content } }),
        ["usage"] = new JsonObject { ["prompt_tokens"] = 900, ["completion_tokens"] = 40, ["prompt_tokens_details"] = new JsonObject { ["cached_tokens"] = 512 } },
    }.ToJsonString();

    private static (AiTrialRunner Runner, InMemoryRepository Repository, Handler Handler) Create(Func<HttpRequestMessage, (HttpStatusCode, string)> answer)
    {
        var repository = new InMemoryRepository();
        var handler = new Handler(answer);
        var options = new AiOptions { Enabled = true, ApiKey = "sk-test", TextModel = "t", ImageModel = "i", BaseUrl = "https://ai.test", TimeoutSeconds = 5 };
        var provider = new OpenAiProvider(new HttpClient(handler), Fixtures.Monitor(options), NullLogger<OpenAiProvider>.Instance, CodeDefaultPrompts.Instance);
        return (new AiTrialRunner(repository, provider, new Infrastructure.Services.AiUsageRecorder(repository, NullLogger<Infrastructure.Services.AiUsageRecorder>.Instance), Fixtures.Clock(), NullLogger<AiTrialRunner>.Instance), repository, handler);
    }

    private static async Task<AiTrialEntity> RunAsync(AiTrialRunner runner, InMemoryRepository repository, AiTrialEntity trial)
    {
        trial.Id ??= "t1";
        trial.CreatedAt = Fixtures.Now;
        await repository.SaveAsync(trial);
        await runner.RunAsync(trial.Id, default);
        return (await repository.GetAsync<AiTrialEntity>(AiTrialEntity.GetPk(), trial.Id))!;
    }

    [Fact]
    public async Task PromptTrial_UsesTheDraftOnce_AndStoresRawOutputAndParseResult()
    {
        string? sentSystem = null;
        var (runner, repository, handler) = Create(request =>
        {
            sentSystem = JsonNode.Parse(request.Content!.ReadAsStringAsync().Result)!["messages"]![0]!["content"]!.GetValue<string>();
            return (HttpStatusCode.OK, Chat("""{"suggestions":[],"refusal":null}"""));
        });
        var trial = await RunAsync(runner, repository, new AiTrialEntity
        {
            Type = AiTrialType.Prompt, Key = "stylist.outfit.instructions", Text = "DRAFT outfit rules.",
            Input = PromptCatalog.SampleInput(PromptTrialTarget.StylistOutfit),
        });

        Assert.Equal(AiTrialStatus.Succeeded, trial.Status);
        Assert.True(trial.Parsed);
        Assert.Equal("""{"suggestions":[],"refusal":null}""", trial.Output);
        Assert.StartsWith("DRAFT outfit rules. Write every title", sentSystem);
        Assert.Contains("in Turkish", trial.SystemPrompt);
        Assert.Equal(("gpt-test-2026", 900L, 512L, 40L), (trial.UsedModel, trial.InputTokens, trial.CachedTokens, trial.OutputTokens));
        Assert.NotNull(trial.FinishedAt);

        // A redelivery of the same message never calls the model again.
        await runner.RunAsync(trial.Id, default);
        Assert.Equal(1, handler.Calls);
    }

    [Fact]
    public async Task PromptTrial_ItsCallIsCountedUnderTheAdminTenant_Once_NeverAUser()
    {
        var (runner, repository, _) = Create(_ => (HttpStatusCode.OK, Chat("""{"suggestions":[],"refusal":null}""")));
        var trial = await RunAsync(runner, repository, new AiTrialEntity
        {
            Type = AiTrialType.Prompt, Key = "stylist.outfit.instructions", Text = "DRAFT.", Input = PromptCatalog.SampleInput(PromptTrialTarget.StylistOutfit),
        });
        await runner.RunAsync(trial.Id, default);   // redelivery

        var day = (await repository.GetAsync<AiUsageEntity>(AiUsageEntity.GetPk(AiUsageEntity.AdminTenant), AiUsageEntity.DaySk(DateOnly.FromDateTime(Fixtures.Now))))!.Counters;
        Assert.Equal((1L, 1L, 900L), (day["jobs"], day[Domain.Services.AiUsageCounters.Op(Domain.Services.AiUsageOperations.AdminTrial, "calls")], day["in"]));
        Assert.Equal(1, day[Domain.Services.AiUsageCounters.Model("gpt-test-2026", "calls")]);
        Assert.DoesNotContain(repository.Keys, k => k.Pk.StartsWith("tenant#", StringComparison.Ordinal) || k.Pk.StartsWith("ai#usage#day#", StringComparison.Ordinal));
        Assert.Null(Infrastructure.Telemetry.AiTelemetry.Current);   // the trial's own run ended
    }

    [Fact]
    public async Task PromptTrial_UnparsableAnswer_IsAFinishedTrial_WithParsedFalse()
    {
        var (runner, repository, _) = Create(_ => (HttpStatusCode.OK, Chat("""{"days":"x"}""")));
        var trial = await RunAsync(runner, repository, new AiTrialEntity
        {
            Type = AiTrialType.Prompt, Key = "stylist.week.instructions", Text = "W", Input = PromptCatalog.SampleInput(PromptTrialTarget.StylistWeek),
        });
        Assert.Equal(AiTrialStatus.Succeeded, trial.Status);
        Assert.False(trial.Parsed);
        Assert.NotNull(trial.ParseError);
    }

    [Fact]
    public async Task ModelsTrial_StoresTheAllowList()
    {
        var (runner, repository, _) = Create(_ => (HttpStatusCode.OK,
            """{"data":[{"id":"gpt-6.1-sol"},{"id":"text-embedding-3-large"},{"id":"gpt-image-2"},{"id":"gpt-5-mini"}]}"""));
        var trial = await RunAsync(runner, repository, new AiTrialEntity { Type = AiTrialType.Models });
        Assert.Equal(AiTrialStatus.Succeeded, trial.Status);
        var list = (await repository.GetAsync<AiModelListEntity>(AiModelListEntity.GetPk(), AiModelListEntity.GetSk()))!;
        Assert.Equal(["gpt-5-mini", "gpt-6.1-sol", "gpt-image-2"], list.Ids);
    }

    [Fact]
    public async Task ModelTrial_TextIsOneTinyCall_ImageIsAnAccessCheck_ErrorsAreStored()
    {
        HttpRequestMessage? last = null;
        string? lastBody = null;
        var (runner, repository, _) = Create(request =>
        {
            last = request;
            lastBody = request.Content?.ReadAsStringAsync().Result;
            return request.Method == HttpMethod.Get
                ? (HttpStatusCode.NotFound, """{"error":{"code":"model_not_found"}}""")
                : (HttpStatusCode.OK, Chat("""{"ok":true}"""));
        });
        var text = await RunAsync(runner, repository, new AiTrialEntity { Id = "a", Type = AiTrialType.Model, Model = "gpt-5-mini", ModelKind = "text", Effort = "minimal" });
        Assert.Equal(AiTrialStatus.Succeeded, text.Status);
        Assert.Equal("""{"ok":true}""", text.Output);
        Assert.NotNull(text.LatencyMs);
        var body = JsonNode.Parse(lastBody!)!;
        Assert.Equal(("gpt-5-mini", "minimal"), (body["model"]!.GetValue<string>(), body["reasoning_effort"]!.GetValue<string>()));

        var image = await RunAsync(runner, repository, new AiTrialEntity { Id = "b", Type = AiTrialType.Model, Model = "gpt-image-9", ModelKind = "image" });
        Assert.Equal(AiTrialStatus.Failed, image.Status);
        Assert.Contains("404", image.Error);
        Assert.Equal("/v1/models/gpt-image-9", last!.RequestUri!.AbsolutePath);
    }
}

/// <summary>Forwards every call to an inner repository; tests override what they observe.</summary>
public class DelegatingRepository(IRepository inner) : IRepository
{
    public virtual Task<bool> SaveAsync(Domain.Entity.Base.IEntity entity, CancellationToken ct = default) => inner.SaveAsync(entity, ct);
    public virtual Task<T?> GetAsync<T>(string pk, string sk, CancellationToken ct = default) where T : new() => inner.GetAsync<T>(pk, sk, ct);
    public virtual Task<bool> DeleteAsync(string pk, string sk, CancellationToken ct = default) => inner.DeleteAsync(pk, sk, ct);
    public virtual Task<List<T>> GetAllAsync<T>(string pk, CancellationToken ct = default) => inner.GetAllAsync<T>(pk, ct);
    public virtual Task<List<T>> GetAllAsync<T>(string pk, string sk, SkOperator op, CancellationToken ct = default) => inner.GetAllAsync<T>(pk, sk, op, ct);
    public virtual Task<(List<T> entities, string? pageToken, long count)> GetPagedAsync<T>(string pk, string? pagedToken, int? limit, CancellationToken ct = default) =>
        inner.GetPagedAsync<T>(pk, pagedToken, limit, ct);
    public virtual Task<(List<T> entities, string? pageToken, long count)> GetPagedAsync<T>(string pk, SkOperator op, string? sk, string? pagedToken, int? limit, CancellationToken ct = default) =>
        inner.GetPagedAsync<T>(pk, op, sk, pagedToken, limit, ct);
    public virtual Task BatchWriteAsync(List<Domain.Entity.Base.IEntity> itemList, CancellationToken ct = default) => inner.BatchWriteAsync(itemList, ct);
    public virtual Task BatchWriteAsync(List<Domain.Entity.Base.IEntity> putItemList, List<Domain.Entity.Base.IEntity> deleteItemList, CancellationToken ct = default) =>
        inner.BatchWriteAsync(putItemList, deleteItemList, ct);
    public virtual Task BatchDeleteAsync(List<Domain.Entity.Base.IEntity> itemList, CancellationToken ct = default) => inner.BatchDeleteAsync(itemList, ct);
    public virtual Task BatchDeleteAsync<T>(List<T> entities, CancellationToken ct = default) where T : Domain.Entity.Base.IEntity, new() => inner.BatchDeleteAsync(entities, ct);
    public virtual Task<List<T>> BatchGetAsync<T>(List<T> entities, CancellationToken ct = default) where T : Domain.Entity.Base.IEntity, new() => inner.BatchGetAsync(entities, ct);
    public virtual Task<List<(string Pk, string Sk)>> GetKeysAsync(string pk, CancellationToken ct = default) => inner.GetKeysAsync(pk, ct);
    public virtual Task BatchDeleteKeysAsync(IReadOnlyList<(string Pk, string Sk)> keys, CancellationToken ct = default) => inner.BatchDeleteKeysAsync(keys, ct);
    public virtual Task<List<T>> QueryGsiAsync<T>(Domain.Constant.DynamoDbConstant.IndexDefinition index, string gsiPk, CancellationToken ct = default) => inner.QueryGsiAsync<T>(index, gsiPk, ct);
    public virtual Task<List<T>> QueryGsiAsync<T>(Domain.Constant.DynamoDbConstant.IndexDefinition index, string gsiPk, string gsiSk, SkOperator op, CancellationToken ct = default) =>
        inner.QueryGsiAsync<T>(index, gsiPk, gsiSk, op, ct);
    public virtual Task<bool> AtomicIncrementInMapAsync(string pk, string sk, string mapAttributeName, string mapKey, int increment = 1, CancellationToken ct = default) =>
        inner.AtomicIncrementInMapAsync(pk, sk, mapAttributeName, mapKey, increment, ct);
    public virtual Task<long> IncrementCounterAsync(string pk, string sk, string attributeName, long ttl, CancellationToken ct = default, long amount = 1) =>
        inner.IncrementCounterAsync(pk, sk, attributeName, ttl, ct, amount);
    public virtual Task<IReadOnlyDictionary<string, long>?> AddCountersAsync(string pk, string sk, IReadOnlyDictionary<string, long> increments, CancellationToken ct = default) =>
        inner.AddCountersAsync(pk, sk, increments, ct);
    public virtual Task<bool> AddCountersOnceAsync(Domain.Entity.Base.IEntity marker, IReadOnlyList<CounterUpdate> updates, CancellationToken ct = default) =>
        inner.AddCountersOnceAsync(marker, updates, ct);
    public virtual Task<bool> SaveIfVersionAsync(Domain.Entity.Base.IVersionedEntity entity, long expectedVersion, CancellationToken ct = default) =>
        inner.SaveIfVersionAsync(entity, expectedVersion, ct);
    public virtual Task<TransactOutcome> SaveWithReceiptAsync(Domain.Entity.Base.IEntity receipt, IReadOnlyList<Domain.Entity.Base.IEntity> items, CancellationToken ct = default) =>
        inner.SaveWithReceiptAsync(receipt, items, ct);
    public virtual Task<TransactResult> TransactWriteAsync(IReadOnlyList<TransactWriteOperation> operations, CancellationToken ct = default) =>
        inner.TransactWriteAsync(operations, ct);
}
