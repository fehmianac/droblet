using System.Net;
using System.Text.Json;
using Domain.Entity;
using Domain.Enum;
using Domain.Extensions;
using Domain.Services;

namespace ApiTests;

/// <summary>
/// App Store UGC rule: a report resolved as contentRemoved really removes the content for everybody but its owner, on every
/// read path, and an admin can undo it (POST …/restore).
/// </summary>
public class ModerationRemovalEndpointTests(StoreSocialApiFactory factory) : IClassFixture<StoreSocialApiFactory>
{
    private static readonly StyleTag[] Tags = [StyleTag.Minimal, StyleTag.Classic, StyleTag.Boho];

    private async Task<string> ReportAsync(TestUser reporter, TestUser target, string targetKind, string? targetId)
    {
        var created = await reporter.Client.PostJsonAsync($"v1/tenant/people/{target.Handle}/report", new { targetKind, targetId, reason = "inappropriate" });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        return (await created.JsonAsync()).GetProperty("reportId").GetString()!;
    }

    private static Task<HttpResponseMessage> ResolveAsync(HttpClient admin, string reportId, string resolution = "contentRemoved") =>
        admin.PostJsonAsync($"v1/admin/moderation/report/{reportId}/resolve", new { resolution, note = "Topluluk kuralları" });

    private static Task<HttpResponseMessage> RestoreAsync(HttpClient admin, string reportId) =>
        admin.PostAsync($"v1/admin/moderation/report/{reportId}/restore", null);

    private static async Task<List<string>> IdsAsync(HttpClient client, string url)
    {
        var response = await client.GetAsync(url);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var json = await response.JsonAsync();
        var items = json.ValueKind == JsonValueKind.Array ? json : json.GetProperty("items");
        return items.EnumerateArray().Select(e => e.GetProperty("id").GetString()!).ToList();
    }

    private static async Task<List<JsonElement>> AuditAsync(HttpClient admin, string reportId) =>
        (await (await admin.GetAsync("v1/admin/audit?targetType=report&limit=100")).JsonAsync()).GetProperty("items").EnumerateArray()
        .Where(e => e.GetProperty("targetId").GetString() == reportId).ToList();

    private static async Task<List<JsonElement>> InboxAsync(HttpClient client, string type) =>
        (await (await client.GetAsync("v1/tenant/notification")).JsonAsync()).GetProperty("items").EnumerateArray()
        .Where(e => e.GetProperty("type").GetString() == type).ToList();

    private string AddLook(string tenantId, string topItemId, string bottomItemId, DateTime? at = null)
    {
        var now = at ?? DateTime.UtcNow;
        var id = Ulid.New(now);
        factory.Repository.SaveAsync(new LookEntity
        {
            Id = id, TenantId = tenantId, Name = "Hafta sonu", Occasion = Occasion.Weekend, Source = LookSource.User, CreatedAt = now, UpdatedAt = now, Version = 1,
            Slots = [new LookSlotValue { Slot = OutfitSlot.Top, ItemId = topItemId }, new LookSlotValue { Slot = OutfitSlot.Bottom, ItemId = bottomItemId }],
        }).GetAwaiter().GetResult();
        return id;
    }

    [Fact]
    public async Task Look_ContentRemoved_DisappearsFromEveryReadPath_OwnerKeepsIt_RestoreBringsItBack()
    {
        var admin = await factory.AdminAsync();
        var owner = await factory.UserAsync(ClosetVisibility.Public);
        var follower = await factory.UserAsync();
        var stranger = await factory.UserAsync();
        factory.Closet.AddItem(owner.TenantId, "top-1", ItemCategory.Top, "white");
        factory.Closet.AddItem(owner.TenantId, "bottom-1", ItemCategory.Bottom, "black");
        var removed = AddLook(owner.TenantId, "top-1", "bottom-1", DateTime.UtcNow.AddMinutes(-2));
        var kept = AddLook(owner.TenantId, "top-1", "bottom-1", DateTime.UtcNow.AddMinutes(-1));
        (await follower.Client.PostAsync($"v1/tenant/follow/{owner.Handle}", null)).EnsureSuccessStatusCode();
        (await follower.Client.PutAsync($"v1/tenant/people/{owner.Handle}/look/{removed}/save", null)).EnsureSuccessStatusCode();
        (await follower.Client.PutJsonAsync($"v1/tenant/people/{owner.Handle}/look/{removed}/rating", new { score = 4 })).EnsureSuccessStatusCode();
        Assert.Contains(removed, await IdsAsync(follower.Client, "v1/tenant/feed"));

        var reportId = await ReportAsync(stranger, owner, "look", removed);
        var resolved = await ResolveAsync(admin, reportId);
        var resolvedJson = await resolved.JsonAsync();

        Assert.Equal(HttpStatusCode.OK, resolved.StatusCode);
        Assert.Equal("contentRemoved", resolvedJson.GetProperty("resolution").GetString());
        Assert.Equal(JsonValueKind.String, resolvedJson.GetProperty("contentRemovedAt").ValueKind);

        // Every viewer but the owner: closet, counts, feed (first page and the rest), saved looks, rating, save.
        foreach (var viewer in new[] { follower, stranger })
        {
            Assert.Equal([kept], await IdsAsync(viewer.Client, $"v1/tenant/people/{owner.Handle}/look"));
            Assert.Equal(1, (await (await viewer.Client.GetAsync($"v1/tenant/people/{owner.Handle}")).JsonAsync()).GetProperty("lookCount").GetInt32());
            Assert.Equal(HttpStatusCode.NotFound, (await viewer.Client.PutJsonAsync($"v1/tenant/people/{owner.Handle}/look/{removed}/rating", new { score = 5 })).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await viewer.Client.PutAsync($"v1/tenant/people/{owner.Handle}/look/{removed}/save", null)).StatusCode);
        }
        var feed = await (await follower.Client.GetAsync("v1/tenant/feed")).JsonAsync();
        Assert.DoesNotContain(removed, feed.GetProperty("items").EnumerateArray().Select(e => e.GetProperty("id").GetString()));
        Assert.Equal(JsonValueKind.Null, feed.GetProperty("pageToken").ValueKind);   // not even on a later page
        Assert.Empty(await IdsAsync(follower.Client, "v1/tenant/saved-look"));
        Assert.Single(await factory.Repository.GetKeysAsync(SavedLookEntity.GetPk(follower.TenantId)));   // kept for a restore

        // The owner: wardrobe list + detail carry moderation { hidden, reason }; her own profile view still lists it.
        var ownLooks = (await (await owner.Client.GetAsync("v1/tenant/look")).JsonAsync()).EnumerateArray().ToList();
        var flagged = ownLooks.Single(l => l.GetProperty("id").GetString() == removed);
        Assert.True(flagged.GetProperty("moderation").GetProperty("hidden").GetBoolean());
        Assert.Equal("inappropriate", flagged.GetProperty("moderation").GetProperty("reason").GetString());
        Assert.Equal(JsonValueKind.Null, ownLooks.Single(l => l.GetProperty("id").GetString() == kept).GetProperty("moderation").ValueKind);
        var detail = await (await owner.Client.GetAsync($"v1/tenant/look/{removed}")).JsonAsync();
        Assert.True(detail.GetProperty("moderation").GetProperty("hidden").GetBoolean());
        Assert.Contains(removed, await IdsAsync(owner.Client, $"v1/tenant/people/{owner.Handle}/look"));

        // An owner edit keeps the flag.
        var version = detail.GetProperty("version").GetInt64();
        var edit = await owner.Client.PutJsonAsync($"v1/tenant/look/{removed}", new
        {
            name = "Yeni ad", occasion = "weekend", favorite = true, baseVersion = version,
            slots = new[] { new { slot = "top", itemId = "top-1" }, new { slot = "bottom", itemId = "bottom-1" } },
        });
        Assert.Equal(HttpStatusCode.OK, edit.StatusCode);
        Assert.True((await edit.JsonAsync()).GetProperty("moderation").GetProperty("hidden").GetBoolean());
        Assert.Equal([kept], await IdsAsync(stranger.Client, $"v1/tenant/people/{owner.Handle}/look"));

        // Owner notification (inbox), once; audit before / after.
        var inbox = Assert.Single(await InboxAsync(owner.Client, "content_removed"));
        Assert.Equal(("look", removed, "inappropriate"), (inbox.GetProperty("data").GetProperty("targetKind").GetString(),
            inbox.GetProperty("data").GetProperty("targetId").GetString(), inbox.GetProperty("data").GetProperty("reason").GetString()));
        Assert.Empty(await InboxAsync(stranger.Client, "content_removed"));
        var removeAudit = Assert.Single(await AuditAsync(admin, reportId), e => e.GetProperty("action").GetString() == "report.contentRemove");
        Assert.Contains("\"hidden\":false", removeAudit.GetProperty("before").GetString());
        Assert.Contains("\"hidden\":true", removeAudit.GetProperty("after").GetString());

        // Idempotent: resolving again changes nothing (no second notification, no second audit row).
        Assert.Equal(HttpStatusCode.OK, (await ResolveAsync(admin, reportId)).StatusCode);
        Assert.Single(await InboxAsync(owner.Client, "content_removed"));
        Assert.Single(await AuditAsync(admin, reportId), e => e.GetProperty("action").GetString() == "report.contentRemove");

        // Restore: visible again everywhere, the saved look comes back; audited; idempotent; resolve never re-hides it.
        var restored = await RestoreAsync(admin, reportId);
        var restoredJson = await restored.JsonAsync();
        Assert.Equal(HttpStatusCode.OK, restored.StatusCode);
        Assert.Equal(JsonValueKind.String, restoredJson.GetProperty("contentRestoredAt").ValueKind);
        Assert.Equal("resolved", restoredJson.GetProperty("status").GetString());
        Assert.Contains(removed, await IdsAsync(stranger.Client, $"v1/tenant/people/{owner.Handle}/look"));
        Assert.Contains(removed, await IdsAsync(follower.Client, "v1/tenant/feed"));
        Assert.Equal([removed], await IdsAsync(follower.Client, "v1/tenant/saved-look"));
        Assert.Equal(JsonValueKind.Null, (await (await owner.Client.GetAsync($"v1/tenant/look/{removed}")).JsonAsync()).GetProperty("moderation").ValueKind);
        var restoreAudit = Assert.Single(await AuditAsync(admin, reportId), e => e.GetProperty("action").GetString() == "report.contentRestore");
        Assert.Contains("\"hidden\":true", restoreAudit.GetProperty("before").GetString());
        Assert.Contains("\"hidden\":false", restoreAudit.GetProperty("after").GetString());
        Assert.Equal(HttpStatusCode.OK, (await RestoreAsync(admin, reportId)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await ResolveAsync(admin, reportId)).StatusCode);
        Assert.Contains(removed, await IdsAsync(stranger.Client, $"v1/tenant/people/{owner.Handle}/look"));
        Assert.Single(await AuditAsync(admin, reportId), e => e.GetProperty("action").GetString() == "report.contentRestore");
    }

    [Fact]
    public async Task Item_ContentRemoved_LeavesTheCloset_AndEveryLookOfOthers_OwnerKeepsItWithTheField()
    {
        var admin = await factory.AdminAsync();
        var owner = await factory.UserAsync(ClosetVisibility.Public);
        var viewer = await factory.UserAsync();
        factory.Closet.AddItem(owner.TenantId, "top-1", ItemCategory.Top, "white");
        factory.Closet.AddItem(owner.TenantId, "bottom-1", ItemCategory.Bottom, "black");
        var look = AddLook(owner.TenantId, "top-1", "bottom-1");
        (await viewer.Client.PostAsync($"v1/tenant/follow/{owner.Handle}", null)).EnsureSuccessStatusCode();

        var reportId = await ReportAsync(viewer, owner, "item", "top-1");
        Assert.Equal(HttpStatusCode.OK, (await ResolveAsync(admin, reportId)).StatusCode);

        Assert.Equal(["bottom-1"], await IdsAsync(viewer.Client, $"v1/tenant/people/{owner.Handle}/item"));
        Assert.Equal(1, (await (await viewer.Client.GetAsync($"v1/tenant/people/{owner.Handle}")).JsonAsync()).GetProperty("itemCount").GetInt32());
        foreach (var url in new[] { $"v1/tenant/people/{owner.Handle}/look", "v1/tenant/feed" })
        {
            var json = await (await viewer.Client.GetAsync(url)).JsonAsync();
            var items = json.ValueKind == JsonValueKind.Array ? json : json.GetProperty("items");
            var pieces = items.EnumerateArray().Single(l => l.GetProperty("id").GetString() == look).GetProperty("pieces").EnumerateArray().ToList();
            Assert.Equal(["bottom-1"], pieces.Select(p => p.GetProperty("itemId").GetString()).ToList());   // the look stays, the removed piece does not
        }

        var ownList = (await (await owner.Client.GetAsync("v1/tenant/item")).JsonAsync()).EnumerateArray().ToList();
        Assert.True(ownList.Single(i => i.GetProperty("id").GetString() == "top-1").GetProperty("moderation").GetProperty("hidden").GetBoolean());
        Assert.Equal(JsonValueKind.Null, ownList.Single(i => i.GetProperty("id").GetString() == "bottom-1").GetProperty("moderation").ValueKind);
        var detail = await (await owner.Client.GetAsync("v1/tenant/item/top-1")).JsonAsync();
        Assert.Equal("inappropriate", detail.GetProperty("item").GetProperty("moderation").GetProperty("reason").GetString());
        Assert.Equal(2, (await IdsAsync(owner.Client, $"v1/tenant/people/{owner.Handle}/item")).Count);

        // Owner edit keeps the flag.
        var version = detail.GetProperty("item").GetProperty("version").GetInt64();
        var edit = await owner.Client.PutJsonAsync("v1/tenant/item/top-1", new { name = "Krem kazak", category = "top", colorIds = new[] { "cream" }, fabric = "knit", seasons = new[] { "winter" }, baseVersion = version });
        Assert.Equal(HttpStatusCode.OK, edit.StatusCode);
        Assert.True((await edit.JsonAsync()).GetProperty("moderation").GetProperty("hidden").GetBoolean());
        Assert.Equal(["bottom-1"], await IdsAsync(viewer.Client, $"v1/tenant/people/{owner.Handle}/item"));

        Assert.Equal("item", Assert.Single(await InboxAsync(owner.Client, "content_removed")).GetProperty("data").GetProperty("targetKind").GetString());

        Assert.Equal(HttpStatusCode.OK, (await RestoreAsync(admin, reportId)).StatusCode);
        Assert.Equal(2, (await IdsAsync(viewer.Client, $"v1/tenant/people/{owner.Handle}/item")).Count);
    }

    [Fact]
    public async Task Profile_ContentRemoved_OthersSeeTheHandleOnly_OwnerKeepsHerFields_HandleStaysReserved()
    {
        var admin = await factory.AdminAsync();
        var owner = await factory.UserAsync(ClosetVisibility.Public, Tags, name: "Zeynep Kaya");
        var viewer = await factory.UserAsync(ClosetVisibility.Public, Tags);
        var other = await factory.UserAsync();
        await factory.Repository.SaveAsync(new AvatarEntity
        {
            Id = Ulid.New(), TenantId = owner.TenantId, S3Key = StorageKeys.Avatar(owner.TenantId, Ulid.New(), "jpg"), ContentType = "image/jpeg", Width = 512, Height = 512, CreatedAt = DateTime.UtcNow,
        });
        factory.Closet.AddLook(owner.TenantId);
        (await viewer.Client.PostAsync($"v1/tenant/follow/{owner.Handle}", null)).EnsureSuccessStatusCode();
        (await owner.Client.PostAsync($"v1/tenant/follow/{viewer.Handle}", null)).EnsureSuccessStatusCode();
        var code = (await (await owner.Client.GetAsync("v1/tenant/invite/link")).JsonAsync()).GetProperty("code").GetString()!;
        var anonymous = factory.CreateClient();

        var before = await (await viewer.Client.GetAsync($"v1/tenant/people/{owner.Handle}")).JsonAsync();
        Assert.Equal("Zeynep Kaya", before.GetProperty("displayName").GetString());
        Assert.Equal(JsonValueKind.String, before.GetProperty("avatarUrl").ValueKind);

        var reportId = await ReportAsync(viewer, owner, "profile", null);
        Assert.Equal(HttpStatusCode.OK, (await ResolveAsync(admin, reportId)).StatusCode);

        var profile = await (await viewer.Client.GetAsync($"v1/tenant/people/{owner.Handle}")).JsonAsync();
        Assert.Equal(owner.Handle, profile.GetProperty("handle").GetString());
        Assert.Equal(JsonValueKind.Null, profile.GetProperty("displayName").ValueKind);   // the app shows "@handle"
        Assert.Equal(JsonValueKind.Null, profile.GetProperty("avatarUrl").ValueKind);
        Assert.Equal(0, profile.GetProperty("styleTags").GetArrayLength());

        var cards = new List<JsonElement>();
        cards.AddRange((await (await viewer.Client.GetAsync($"v1/tenant/people?q={owner.Handle}")).JsonAsync()).EnumerateArray());   // search
        cards.AddRange((await (await viewer.Client.GetAsync("v1/tenant/following")).JsonAsync()).EnumerateArray());
        cards.AddRange((await (await viewer.Client.GetAsync("v1/tenant/follower")).JsonAsync()).EnumerateArray());
        var ownerCards = cards.Where(c => c.GetProperty("handle").GetString() == owner.Handle).ToList();
        Assert.Equal(3, ownerCards.Count);
        Assert.All(ownerCards, c => Assert.Equal(JsonValueKind.Null, c.GetProperty("displayName").ValueKind));
        Assert.All(ownerCards, c => Assert.Equal(0, c.GetProperty("styleTags").GetArrayLength()));
        var feedLook = (await (await viewer.Client.GetAsync("v1/tenant/feed")).JsonAsync()).GetProperty("items").EnumerateArray()
            .First(l => l.GetProperty("ownerHandle").GetString() == owner.Handle);
        Assert.Equal(JsonValueKind.Null, feedLook.GetProperty("ownerDisplayName").ValueKind);
        Assert.Equal(JsonValueKind.Null, (await (await anonymous.GetAsync($"v1/invite/{code}")).JsonAsync()).GetProperty("inviterFirstName").ValueKind);
        (await viewer.Client.PutAsync($"v1/tenant/block/{owner.Handle}", null)).EnsureSuccessStatusCode();
        var blocked = (await (await viewer.Client.GetAsync("v1/tenant/block")).JsonAsync()).EnumerateArray().Single(c => c.GetProperty("handle").GetString() == owner.Handle);
        Assert.Equal(JsonValueKind.Null, blocked.GetProperty("displayName").ValueKind);
        (await viewer.Client.DeleteAsync($"v1/tenant/block/{owner.Handle}")).EnsureSuccessStatusCode();

        // The handle stays hers.
        Assert.Equal(HttpStatusCode.Conflict, (await other.Client.PutJsonAsync("v1/tenant/profile/handle", new { handle = owner.Handle })).StatusCode);

        // The owner: everything of her own, plus moderation; her own people view too; an edit keeps the flag.
        var own = await (await owner.Client.GetAsync("v1/tenant/profile")).JsonAsync();
        Assert.Equal("Zeynep Kaya", own.GetProperty("displayName").GetString());
        Assert.True(own.GetProperty("moderation").GetProperty("hidden").GetBoolean());
        Assert.Equal("Zeynep Kaya", (await (await owner.Client.GetAsync($"v1/tenant/people/{owner.Handle}")).JsonAsync()).GetProperty("displayName").GetString());
        var edit = await owner.Client.PutJsonAsync("v1/tenant/profile", new { displayName = "Zeynep K.", baseVersion = own.GetProperty("version").GetInt64() });
        Assert.Equal(HttpStatusCode.OK, edit.StatusCode);
        Assert.True((await edit.JsonAsync()).GetProperty("moderation").GetProperty("hidden").GetBoolean());
        Assert.Equal(JsonValueKind.Null, (await (await other.Client.GetAsync($"v1/tenant/people/{owner.Handle}")).JsonAsync()).GetProperty("displayName").ValueKind);

        var inbox = Assert.Single(await InboxAsync(owner.Client, "content_removed"));
        Assert.Equal("profile", inbox.GetProperty("data").GetProperty("targetKind").GetString());
        Assert.False(inbox.GetProperty("data").TryGetProperty("targetId", out _));

        Assert.Equal(HttpStatusCode.OK, (await RestoreAsync(admin, reportId)).StatusCode);
        var after = await (await viewer.Client.GetAsync($"v1/tenant/people/{owner.Handle}")).JsonAsync();
        Assert.Equal("Zeynep K.", after.GetProperty("displayName").GetString());
        Assert.Equal(JsonValueKind.String, after.GetProperty("avatarUrl").ValueKind);
        Assert.Equal(3, after.GetProperty("styleTags").GetArrayLength());
    }

    [Fact]
    public async Task Resolve_TargetGone_StillSucceeds_Restore_RefusesWhatItCannotUndo()
    {
        var admin = await factory.AdminAsync();
        var moderator = await factory.AdminAsync(AdminRole.Moderator);
        var editor = await factory.AdminAsync(AdminRole.ContentEditor);
        var owner = await factory.UserAsync(ClosetVisibility.Public);
        var reporter = await factory.UserAsync();

        var gone = await ReportAsync(reporter, owner, "look", "LOOK-DELETED");
        var resolved = await ResolveAsync(admin, gone);
        Assert.Equal(HttpStatusCode.OK, resolved.StatusCode);
        Assert.Equal("contentRemoved", (await resolved.JsonAsync()).GetProperty("resolution").GetString());
        Assert.Empty(await InboxAsync(owner.Client, "content_removed"));
        Assert.Equal(HttpStatusCode.OK, (await RestoreAsync(moderator, gone)).StatusCode);   // moderation.manage is enough

        var open = await ReportAsync(reporter, owner, "profile", null);
        var dismissed = await ReportAsync(reporter, owner, "profile", null);
        Assert.Equal(HttpStatusCode.OK, (await ResolveAsync(admin, dismissed, "dismissed")).StatusCode);

        var stillOpen = await RestoreAsync(admin, open);
        var notRemoved = await RestoreAsync(admin, dismissed);
        Assert.Equal((HttpStatusCode.Conflict, "report_not_resolved"), (stillOpen.StatusCode, await stillOpen.CodeAsync()));
        Assert.Equal((HttpStatusCode.Conflict, "report_not_content_removed"), (notRemoved.StatusCode, await notRemoved.CodeAsync()));
        Assert.Equal(HttpStatusCode.NotFound, (await RestoreAsync(admin, "NOPE")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await RestoreAsync(editor, open)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await RestoreAsync(reporter.Client, open)).StatusCode);

        // Dismissed / userWarned never hide anything.
        Assert.Equal(JsonValueKind.Null, (await (await owner.Client.GetAsync("v1/tenant/profile")).JsonAsync()).GetProperty("moderation").ValueKind);
    }
}
