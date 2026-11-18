using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Domain.Entity;
using Domain.Enum;
using Domain.Services;

namespace ApiTests;

public class SocialVisibilityEndpointTests(StoreSocialApiFactory factory) : IClassFixture<StoreSocialApiFactory>
{
    private static readonly StyleTag[] Tags = [StyleTag.Minimal, StyleTag.Classic, StyleTag.Boho];

    private static async Task<HttpStatusCode> Status(HttpClient client, string url) => (await client.GetAsync(url)).StatusCode;

    [Fact]
    public async Task PrivateCloset_IsA404Everywhere_ForEveryoneElse()
    {
        var owner = await factory.UserAsync(ClosetVisibility.Private);
        var viewer = await factory.UserAsync();
        var lookId = factory.Closet.AddLook(owner.TenantId);
        factory.Closet.AddItem(owner.TenantId, "item-1", ItemCategory.Top, "white");

        foreach (var path in new[] { "", "/look", "/item", "/trip" })
            Assert.Equal(HttpStatusCode.NotFound, await Status(viewer.Client, $"v1/tenant/people/{owner.Handle}{path}"));
        Assert.Equal(HttpStatusCode.NotFound, (await viewer.Client.PostAsync($"v1/tenant/follow/{owner.Handle}", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await viewer.Client.PutJsonAsync($"v1/tenant/people/{owner.Handle}/look/{lookId}/rating", new { score = 5 })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await viewer.Client.PutAsync($"v1/tenant/people/{owner.Handle}/look/{lookId}/save", null)).StatusCode);
        Assert.DoesNotContain((await (await viewer.Client.GetAsync($"v1/tenant/people?q={owner.Handle[..4]}")).JsonAsync()).EnumerateArray(),
            c => c.GetProperty("handle").GetString() == owner.Handle);

        // The owner still sees everything of her own.
        Assert.Equal(HttpStatusCode.OK, await Status(owner.Client, $"v1/tenant/people/{owner.Handle}/look"));
        Assert.Equal(HttpStatusCode.OK, await Status(owner.Client, $"v1/tenant/people/{owner.Handle}/item"));
    }

    [Fact]
    public async Task FollowersOnly_ClosetOpensOnFollow_ClosesOnUnfollow_Immediately()
    {
        var owner = await factory.UserAsync(ClosetVisibility.FollowersOnly);
        var viewer = await factory.UserAsync();
        factory.Closet.AddLook(owner.TenantId);
        factory.Closet.AddItem(owner.TenantId, "item-1", ItemCategory.Top, "white");

        var locked = await (await viewer.Client.GetAsync($"v1/tenant/people/{owner.Handle}")).JsonAsync();
        var looksBefore = await Status(viewer.Client, $"v1/tenant/people/{owner.Handle}/look");
        var itemsBefore = await Status(viewer.Client, $"v1/tenant/people/{owner.Handle}/item");

        var follow = await viewer.Client.PostAsync($"v1/tenant/follow/{owner.Handle}", null);
        var followAgain = await viewer.Client.PostAsync($"v1/tenant/follow/{owner.Handle}", null);
        var open = await (await viewer.Client.GetAsync($"v1/tenant/people/{owner.Handle}")).JsonAsync();
        var looksAfter = await viewer.Client.GetAsync($"v1/tenant/people/{owner.Handle}/look");
        var itemsAfter = await Status(viewer.Client, $"v1/tenant/people/{owner.Handle}/item");

        var unfollow = await viewer.Client.DeleteAsync($"v1/tenant/follow/{owner.Handle}");
        var looksClosed = await Status(viewer.Client, $"v1/tenant/people/{owner.Handle}/look");

        Assert.True(locked.GetProperty("closetLocked").GetBoolean());
        Assert.Equal(JsonValueKind.Null, locked.GetProperty("lookCount").ValueKind);   // not even the count leaks
        Assert.Equal((HttpStatusCode.NotFound, HttpStatusCode.NotFound), (looksBefore, itemsBefore));
        Assert.Equal((HttpStatusCode.NoContent, HttpStatusCode.NoContent), (follow.StatusCode, followAgain.StatusCode));
        Assert.False(open.GetProperty("closetLocked").GetBoolean());
        Assert.True(open.GetProperty("isFollowing").GetBoolean());
        Assert.Equal((1, 1, 1), (open.GetProperty("lookCount").GetInt32(), open.GetProperty("itemCount").GetInt32(), open.GetProperty("followerCount").GetInt32()));
        Assert.Equal(HttpStatusCode.OK, looksAfter.StatusCode);
        Assert.Equal(HttpStatusCode.OK, itemsAfter);
        Assert.Equal(HttpStatusCode.NoContent, unfollow.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, looksClosed);
        Assert.Equal("cannot_target_self", await (await viewer.Client.PostAsync($"v1/tenant/follow/{viewer.Handle}", null)).CodeAsync());
    }

    [Fact]
    public async Task PublicProfile_NeverContainsPrivateFields_TripsStayClosed()
    {
        var owner = await factory.UserAsync(ClosetVisibility.Public, Tags);
        var viewer = await factory.UserAsync(ClosetVisibility.Public, [StyleTag.Minimal, StyleTag.Classic, StyleTag.Street]);
        factory.Closet.AddTrip(owner.TenantId, "trip-1");

        var response = await viewer.Client.GetAsync($"v1/tenant/people/{owner.Handle.ToUpperInvariant()}");
        var raw = await response.Content.ReadAsStringAsync();
        var profile = await response.JsonAsync();

        Assert.Equal(owner.Handle, profile.GetProperty("handle").GetString());
        Assert.Equal(50, profile.GetProperty("styleMatchPercent").GetInt32());
        Assert.False(profile.GetProperty("isSelf").GetBoolean());
        foreach (var forbidden in new[] { "email", "tenantId", owner.TenantId, "heightCm", "weightKg", "cityId", "photo" })
            Assert.DoesNotContain(forbidden, raw, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(HttpStatusCode.NotFound, await Status(viewer.Client, $"v1/tenant/people/{owner.Handle}/trip"));   // A-6: owner only
        Assert.Equal(HttpStatusCode.OK, await Status(owner.Client, $"v1/tenant/people/{owner.Handle}/trip"));
        Assert.Equal(HttpStatusCode.NotFound, await Status(viewer.Client, "v1/tenant/people/nobody-here"));
    }

    [Fact]
    public async Task Rating_OnePerUserPerLook_AverageAndCount_OverwriteNotAdd()
    {
        var owner = await factory.UserAsync();
        var alice = await factory.UserAsync();
        var bob = await factory.UserAsync();
        var lookId = factory.Closet.AddLook(owner.TenantId);
        var url = $"v1/tenant/people/{owner.Handle}/look/{lookId}/rating";

        var first = await (await alice.Client.PutJsonAsync(url, new { score = 5 })).JsonAsync();
        var second = await (await bob.Client.PutJsonAsync(url, new { score = 2 })).JsonAsync();
        var changed = await (await alice.Client.PutJsonAsync(url, new { score = 4 })).JsonAsync();
        var same = await (await alice.Client.PutJsonAsync(url, new { score = 4 })).JsonAsync();
        var looks = await (await bob.Client.GetAsync($"v1/tenant/people/{owner.Handle}/look")).JsonAsync();

        Assert.Equal((5.0, 1L, 5), (first.GetProperty("average").GetDouble(), first.GetProperty("count").GetInt64(), first.GetProperty("myScore").GetInt32()));
        Assert.Equal((3.5, 2L), (second.GetProperty("average").GetDouble(), second.GetProperty("count").GetInt64()));
        Assert.Equal((3.0, 2L), (changed.GetProperty("average").GetDouble(), changed.GetProperty("count").GetInt64()));
        Assert.Equal((3.0, 2L), (same.GetProperty("average").GetDouble(), same.GetProperty("count").GetInt64()));
        Assert.Equal(2, looks[0].GetProperty("rating").GetProperty("myScore").GetInt32());
        Assert.Equal(3.0, looks[0].GetProperty("rating").GetProperty("average").GetDouble());

        Assert.Equal(HttpStatusCode.BadRequest, (await alice.Client.PutJsonAsync(url, new { score = 6 })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await alice.Client.PutJsonAsync(url, new { score = 0 })).StatusCode);
        Assert.Equal("cannot_target_self", await (await owner.Client.PutJsonAsync(url, new { score = 5 })).CodeAsync());
        Assert.Equal(HttpStatusCode.NotFound, (await alice.Client.PutJsonAsync($"v1/tenant/people/{owner.Handle}/look/NOSUCHLOOK/rating", new { score = 5 })).StatusCode);
    }

    [Fact]
    public async Task Feed_FollowedUsersLooks_NewestFirst_Paged_WithShoppableProducts()
    {
        var admin = await factory.AdminAsync();
        var product = await factory.SeedProductAsync(admin, await factory.SeedBrandAsync(admin), 400_000, ProductCategory.Bag);
        var viewer = await factory.UserAsync();
        var friend = await factory.UserAsync();
        var other = await factory.UserAsync(ClosetVisibility.FollowersOnly);
        var stranger = await factory.UserAsync();
        var day = new DateTime(2026, 11, 1, 9, 0, 0, DateTimeKind.Utc);
        var oldest = factory.Closet.AddLook(friend.TenantId, day);
        var middle = factory.Closet.AddLook(other.TenantId, day.AddDays(1));
        var newest = factory.Closet.AddLook(friend.TenantId, day.AddDays(2), product);
        factory.Closet.AddLook(stranger.TenantId, day.AddDays(3));

        var empty = await (await viewer.Client.GetAsync("v1/tenant/feed")).JsonAsync();
        await viewer.Client.PostAsync($"v1/tenant/follow/{friend.Handle}", null);
        await viewer.Client.PostAsync($"v1/tenant/follow/{other.Handle}", null);
        var page1 = await (await viewer.Client.GetAsync("v1/tenant/feed")).JsonAsync();   // Social:FeedPageSize = 2 in tests
        var page2 = await (await viewer.Client.GetAsync($"v1/tenant/feed?pageToken={page1.GetProperty("pageToken").GetString()}")).JsonAsync();

        Assert.Equal(0, empty.GetProperty("items").GetArrayLength());
        Assert.Equal([newest, middle], page1.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("id").GetString()!).ToArray());
        Assert.Equal([oldest], page2.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("id").GetString()!).ToArray());
        Assert.Equal(JsonValueKind.Null, page2.GetProperty("pageToken").ValueKind);
        var top = page1.GetProperty("items")[0];
        Assert.Equal(friend.Handle, top.GetProperty("ownerHandle").GetString());
        Assert.Equal(product, top.GetProperty("pieces")[1].GetProperty("product").GetProperty("id").GetString());   // "Parçaları gör" → shop
        Assert.Equal(0, top.GetProperty("rating").GetProperty("count").GetInt64());

        // A followee who goes private disappears from the feed at once.
        (await other.Client.PutJsonAsync("v1/tenant/profile/visibility", new { closetVisibility = "private", baseVersion = 3 })).EnsureSuccessStatusCode();
        var afterPrivate = await (await viewer.Client.GetAsync("v1/tenant/feed")).JsonAsync();
        Assert.DoesNotContain(afterPrivate.GetProperty("items").EnumerateArray(), i => i.GetProperty("id").GetString() == middle);
    }

    [Fact]
    public async Task Block_MakesBothSidesInvisibleEverywhere_AndRemovesFollows()
    {
        var alice = await factory.UserAsync(ClosetVisibility.Public, Tags);
        var bob = await factory.UserAsync(ClosetVisibility.Public, Tags);
        var lookId = factory.Closet.AddLook(alice.TenantId);
        factory.Closet.AddLook(bob.TenantId);
        await alice.Client.PostAsync($"v1/tenant/follow/{bob.Handle}", null);
        await bob.Client.PostAsync($"v1/tenant/follow/{alice.Handle}", null);

        var block = await alice.Client.PutAsync($"v1/tenant/block/{bob.Handle}", null);

        Assert.Equal(HttpStatusCode.NoContent, block.StatusCode);
        foreach (var (viewer, target) in new[] { (alice, bob), (bob, alice) })
        {
            Assert.Equal(HttpStatusCode.NotFound, await Status(viewer.Client, $"v1/tenant/people/{target.Handle}"));
            Assert.Equal(HttpStatusCode.NotFound, await Status(viewer.Client, $"v1/tenant/people/{target.Handle}/look"));
            Assert.Equal(HttpStatusCode.NotFound, (await viewer.Client.PostAsync($"v1/tenant/follow/{target.Handle}", null)).StatusCode);
            Assert.Equal(0, (await (await viewer.Client.GetAsync("v1/tenant/feed")).JsonAsync()).GetProperty("items").GetArrayLength());
            Assert.Equal(0, (await (await viewer.Client.GetAsync("v1/tenant/following")).JsonAsync()).GetArrayLength());
            Assert.Equal(0, (await (await viewer.Client.GetAsync("v1/tenant/follower")).JsonAsync()).GetArrayLength());
            Assert.DoesNotContain((await (await viewer.Client.GetAsync($"v1/tenant/people?q={target.Handle}")).JsonAsync()).EnumerateArray(), c => c.GetProperty("handle").GetString() == target.Handle);
            Assert.DoesNotContain((await (await viewer.Client.GetAsync("v1/tenant/people/suggested")).JsonAsync()).EnumerateArray(), c => c.GetProperty("handle").GetString() == target.Handle);
        }
        Assert.Equal(HttpStatusCode.NotFound, (await bob.Client.PutJsonAsync($"v1/tenant/people/{alice.Handle}/look/{lookId}/rating", new { score = 1 })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.Client.PostJsonAsync($"v1/tenant/people/{alice.Handle}/report", new { targetKind = "profile", reason = "spam" })).StatusCode);

        // Only the blocker sees the block, and can lift it. Follows do not come back.
        Assert.Equal(bob.Handle, (await (await alice.Client.GetAsync("v1/tenant/block")).JsonAsync())[0].GetProperty("handle").GetString());
        Assert.Equal(0, (await (await bob.Client.GetAsync("v1/tenant/block")).JsonAsync()).GetArrayLength());
        Assert.Equal(HttpStatusCode.NoContent, (await alice.Client.DeleteAsync($"v1/tenant/block/{bob.Handle}")).StatusCode);
        var restored = await (await bob.Client.GetAsync($"v1/tenant/people/{alice.Handle}")).JsonAsync();
        Assert.False(restored.GetProperty("isFollowing").GetBoolean());
        Assert.Equal("cannot_target_self", await (await alice.Client.PutAsync($"v1/tenant/block/{alice.Handle}", null)).CodeAsync());
    }

    [Fact]
    public async Task Search_And_Suggested_OnlyVisibleProfiles_OrderedByStyleMatch()
    {
        var prefix = StoreSocialApiFactory.Unique("s")[..6];
        async Task<TestUser> Named(ClosetVisibility visibility, StyleTag[] tags)
        {
            var user = await factory.UserAsync(ClosetVisibility.Private, tags);
            var handle = prefix + StoreSocialApiFactory.Unique("")[..6];
            (await user.Client.PutJsonAsync("v1/tenant/profile/handle", new { handle })).EnsureSuccessStatusCode();
            var version = (await (await user.Client.GetAsync("v1/tenant/profile")).JsonAsync()).GetProperty("version").GetInt64();
            if (visibility != ClosetVisibility.Private)
                (await user.Client.PutJsonAsync("v1/tenant/profile/visibility", new { closetVisibility = visibility, baseVersion = version })).EnsureSuccessStatusCode();
            return user with { Handle = handle };
        }

        var viewer = await factory.UserAsync(ClosetVisibility.Public, Tags);
        var twin = await Named(ClosetVisibility.Public, Tags);
        var half = await Named(ClosetVisibility.Public, [StyleTag.Minimal, StyleTag.Classic, StyleTag.Street]);
        var followersOnly = await Named(ClosetVisibility.FollowersOnly, Tags);
        var hidden = await Named(ClosetVisibility.Private, Tags);

        var found = (await (await viewer.Client.GetAsync($"v1/tenant/people?q=@{prefix.ToUpperInvariant()}")).JsonAsync()).EnumerateArray().Select(c => c.GetProperty("handle").GetString()).ToHashSet();
        var suggested = (await (await viewer.Client.GetAsync("v1/tenant/people/suggested")).JsonAsync()).EnumerateArray()
            .Where(c => c.GetProperty("handle").GetString()!.StartsWith(prefix, StringComparison.Ordinal))
            .Select(c => (c.GetProperty("handle").GetString(), c.GetProperty("styleMatchPercent").GetInt32())).ToArray();

        Assert.Equal(new HashSet<string?> { twin.Handle, half.Handle, followersOnly.Handle }, found);   // private never appears
        Assert.Equal([(twin.Handle, 100), (half.Handle, 50)], suggested);                               // only Public closets are match candidates
        Assert.DoesNotContain(hidden.Handle, found);
        Assert.Equal(0, (await (await viewer.Client.GetAsync("v1/tenant/people?q=a")).JsonAsync()).GetArrayLength());
    }

    [Fact]
    public async Task SaveLook_List_Unsave()
    {
        var owner = await factory.UserAsync();
        var viewer = await factory.UserAsync();
        var lookId = factory.Closet.AddLook(owner.TenantId);

        var save = await viewer.Client.PutAsync($"v1/tenant/people/{owner.Handle}/look/{lookId}/save", null);
        var saveAgain = await viewer.Client.PutAsync($"v1/tenant/people/{owner.Handle}/look/{lookId}/save", null);
        var saved = await (await viewer.Client.GetAsync("v1/tenant/saved-look")).JsonAsync();
        var looks = await (await viewer.Client.GetAsync($"v1/tenant/people/{owner.Handle}/look")).JsonAsync();
        (await owner.Client.PutJsonAsync("v1/tenant/profile/visibility", new { closetVisibility = "private", baseVersion = 3 })).EnsureSuccessStatusCode();
        var hidden = await (await viewer.Client.GetAsync("v1/tenant/saved-look")).JsonAsync();
        var unsave = await viewer.Client.DeleteAsync($"v1/tenant/people/{owner.Handle}/look/{lookId}/save");

        Assert.Equal((HttpStatusCode.NoContent, HttpStatusCode.NoContent), (save.StatusCode, saveAgain.StatusCode));
        Assert.Equal(lookId, Assert.Single(saved.EnumerateArray()).GetProperty("id").GetString());
        Assert.True(looks[0].GetProperty("saved").GetBoolean());
        Assert.Equal(0, hidden.GetArrayLength());        // saved earlier, no longer visible
        Assert.Equal(HttpStatusCode.NoContent, unsave.StatusCode);
        Assert.Empty(await factory.Repository.GetKeysAsync(SavedLookEntity.GetPk(viewer.TenantId)));
        Assert.Empty(await factory.Repository.GetKeysAsync(SavedByEntity.GetPk(owner.TenantId)));
    }

    [Fact]
    public async Task Report_IsStoredForModeration_AdminListsAndResolves()
    {
        var admin = await factory.AdminAsync();
        var target = await factory.UserAsync();
        var reporter = await factory.UserAsync();

        var invalid = await reporter.Client.PostJsonAsync($"v1/tenant/people/{target.Handle}/report", new { targetKind = "look", reason = "inappropriate" });
        var created = await reporter.Client.PostJsonAsync($"v1/tenant/people/{target.Handle}/report", new { targetKind = "look", targetId = "LOOK1", reason = "inappropriate", note = "Uygunsuz içerik" });
        var self = await reporter.Client.PostJsonAsync($"v1/tenant/people/{reporter.Handle}/report", new { targetKind = "profile", reason = "spam" });
        var reportId = (await created.JsonAsync()).GetProperty("reportId").GetString()!;

        var open = await (await admin.GetAsync("v1/admin/moderation/report")).JsonAsync();
        var listed = open.GetProperty("items").EnumerateArray().Single(r => r.GetProperty("id").GetString() == reportId);
        var resolved = await admin.PostJsonAsync($"v1/admin/moderation/report/{reportId}/resolve", new { resolution = "contentRemoved", note = "Kaldırıldı" });
        var resolvedAgain = await admin.PostJsonAsync($"v1/admin/moderation/report/{reportId}/resolve", new { resolution = "dismissed" });
        var openAfter = await (await admin.GetAsync("v1/admin/moderation/report?status=open")).JsonAsync();
        var done = await (await admin.GetAsync("v1/admin/moderation/report?status=resolved")).JsonAsync();

        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);                  // look report without the look id
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Equal("cannot_target_self", await self.CodeAsync());
        Assert.Equal((target.Handle, reporter.Handle, "look", "LOOK1", "inappropriate"), (listed.GetProperty("targetHandle").GetString(), listed.GetProperty("reporterHandle").GetString(),
            listed.GetProperty("targetKind").GetString(), listed.GetProperty("targetId").GetString(), listed.GetProperty("reason").GetString()));
        Assert.Equal("contentRemoved", (await resolved.JsonAsync()).GetProperty("resolution").GetString());
        Assert.Equal("contentRemoved", (await resolvedAgain.JsonAsync()).GetProperty("resolution").GetString());   // already resolved: unchanged
        Assert.DoesNotContain(openAfter.GetProperty("items").EnumerateArray(), r => r.GetProperty("id").GetString() == reportId);
        Assert.Contains(done.GetProperty("items").EnumerateArray(), r => r.GetProperty("id").GetString() == reportId);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PostJsonAsync("v1/admin/moderation/report/NOPE/resolve", new { resolution = "dismissed" })).StatusCode);
    }

    [Fact]
    public async Task Invite_LinkShareResolveAndAttribution_OncePerAccount()
    {
        var admin = await factory.AdminAsync();
        var inviter = await factory.UserAsync(name: "Zeynep Kaya");
        var (invitee, _) = await factory.RegisterAsync();

        var link = await (await inviter.Client.GetAsync("v1/tenant/invite/link")).JsonAsync();
        var linkAgain = await (await inviter.Client.GetAsync("v1/tenant/invite/link")).JsonAsync();
        var code = link.GetProperty("code").GetString()!;
        var shareBody = new { clientMutationId = Domain.Extensions.Ulid.New(), channel = "whatsapp", targetKind = "look", targetId = "LOOK1", ownerHandle = inviter.Handle };
        var share = await (await inviter.Client.PostJsonAsync("v1/tenant/share", shareBody)).JsonAsync();
        var shareReplay = await (await inviter.Client.PostJsonAsync("v1/tenant/share", shareBody)).JsonAsync();
        var badShare = await inviter.Client.PostJsonAsync("v1/tenant/share", new { clientMutationId = Domain.Extensions.Ulid.New(), channel = "telegram", targetKind = "app" });

        var preview = await factory.CreateClient().GetAsync($"v1/invite/{code.ToLowerInvariant()}");
        var previewRaw = await preview.Content.ReadAsStringAsync();
        var unknown = await factory.CreateClient().GetAsync("v1/invite/ZZZZZZZZ");

        var self = await inviter.Client.PostJsonAsync("v1/tenant/invite/attribution", new { code });
        var attributed = await invitee.PostJsonAsync("v1/tenant/invite/attribution", new { code });
        var second = await invitee.PostJsonAsync("v1/tenant/invite/attribution", new { code });
        var notFound = await invitee.PostJsonAsync("v1/tenant/invite/attribution", new { code = "ZZZZZZZZ" });
        var after = await (await inviter.Client.GetAsync("v1/tenant/invite/link")).JsonAsync();
        var funnel = await (await admin.GetAsync("v1/admin/report/funnel")).JsonAsync();

        Assert.Equal(code, linkAgain.GetProperty("code").GetString());
        Assert.Equal($"https://droplet.alatech.co/i/{code}", link.GetProperty("url").GetString());
        Assert.Equal($"https://droplet.alatech.co/i/{code}?t=look&id=LOOK1&u={inviter.Handle}", share.GetProperty("url").GetString());
        Assert.Equal(share.GetProperty("shareId").GetString(), shareReplay.GetProperty("shareId").GetString());
        Assert.Single(await factory.Repository.GetKeysAsync(ShareEntity.GetPk(inviter.TenantId)));
        Assert.Equal(HttpStatusCode.BadRequest, badShare.StatusCode);
        Assert.Equal("Zeynep", JsonDocument.Parse(previewRaw).RootElement.GetProperty("inviterFirstName").GetString());
        Assert.DoesNotContain("Kaya", previewRaw);                                     // first name only on the anonymous endpoint
        Assert.DoesNotContain(inviter.Handle, previewRaw);
        Assert.Equal("invite_code_not_found", await unknown.CodeAsync());
        Assert.Equal("cannot_target_self", await self.CodeAsync());
        Assert.Equal(HttpStatusCode.NoContent, attributed.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, notFound.StatusCode);
        Assert.Equal(1, after.GetProperty("invitedCount").GetInt32());
        long Events(string name) => funnel.GetProperty("steps").EnumerateArray().Single(s => s.GetProperty("name").GetString() == name).GetProperty("events").GetInt64();
        Assert.True(Events("invited_install") >= 1 && Events("share") >= 1);
    }
}

public class SettingsAnalyticsWeatherEndpointTests(StoreSocialApiFactory factory) : IClassFixture<StoreSocialApiFactory>
{
    [Fact]
    public async Task Visibility_DefaultPrivate_Versioned_KeepsDiscoveryIndexInStep()
    {
        var (client, auth) = await factory.RegisterAsync();
        Task<PublicProfileIndexEntity?> Index() => factory.Repository.GetAsync<PublicProfileIndexEntity>(PublicProfileIndexEntity.GetPk(Segment.Women), PublicProfileIndexEntity.GetSk(auth.TenantId));

        var initial = await (await client.GetAsync("v1/tenant/settings")).JsonAsync();
        var made = await client.PutJsonAsync("v1/tenant/profile/visibility", new { closetVisibility = "public", baseVersion = 1 });
        var listed = await Index();
        var stale = await client.PutJsonAsync("v1/tenant/profile/visibility", new { closetVisibility = "private", baseVersion = 1 });
        var stillListed = await Index();
        var followers = await client.PutJsonAsync("v1/tenant/profile/visibility", new { closetVisibility = "followersOnly", baseVersion = 2 });
        var invalid = await client.PutJsonAsync("v1/tenant/profile/visibility", new { closetVisibility = "everyone", baseVersion = 3 });

        Assert.Equal("private", initial.GetProperty("closetVisibility").GetString());
        Assert.Equal(HttpStatusCode.OK, made.StatusCode);
        Assert.NotNull(listed);
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        Assert.Equal("public", (await stale.JsonAsync()).GetProperty("closetVisibility").GetString());   // 409 carries the current profile
        Assert.NotNull(stillListed);
        Assert.Equal(3, (await followers.JsonAsync()).GetProperty("version").GetInt64());
        Assert.Null(await Index());                                                   // only Public closets are discoverable
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
    }

    [Fact]
    public async Task NotificationPrefs_Defaults_VersionedUpdate_Validation_SendLists()
    {
        var (client, auth) = await factory.RegisterAsync();
        object Prefs(long baseVersion, string time = "08:15", string zone = "Europe/London", bool morning = true, bool weekly = false, bool ratings = true) =>
            new { morningOutfit = morning, morningOutfitLocalTime = time, weeklyEdit = weekly, friendRatings = ratings, timeZone = zone, baseVersion };
        Task<bool> Slot(string time) => Exists(ReminderSlotEntity.GetPk(time), ReminderSlotEntity.GetSk(auth.TenantId));
        Task<bool> Subscribed(NotificationType type) => Exists(NotificationSubscriberEntity.GetPk(type), NotificationSubscriberEntity.GetSk(auth.TenantId));
        async Task<bool> Exists(string pk, string sk) => (await factory.Repository.GetKeysAsync(pk)).Contains((pk, sk));

        var defaults = await (await client.GetAsync("v1/tenant/user/me/notifications")).JsonAsync();
        var saved = await client.PutJsonAsync("v1/tenant/user/me/notifications", Prefs(0));
        var afterSave = (await Slot("08:15"), await Subscribed(NotificationType.WeeklyEdit), await Subscribed(NotificationType.FriendRatings));
        var stale = await client.PutJsonAsync("v1/tenant/user/me/notifications", Prefs(0, "09:00"));
        var moved = await client.PutJsonAsync("v1/tenant/user/me/notifications", Prefs(1, "09:00", weekly: true, ratings: false));
        var afterMove = (await Slot("08:15"), await Slot("09:00"), await Subscribed(NotificationType.WeeklyEdit), await Subscribed(NotificationType.FriendRatings));
        var off = await client.PutJsonAsync("v1/tenant/user/me/notifications", Prefs(2, "09:00", morning: false, weekly: false, ratings: false));

        Assert.Equal((false, "07:30", "Europe/Istanbul", 0L), (defaults.GetProperty("morningOutfit").GetBoolean(), defaults.GetProperty("morningOutfitLocalTime").GetString(),
            defaults.GetProperty("timeZone").GetString(), defaults.GetProperty("version").GetInt64()));
        Assert.Equal(1, (await saved.JsonAsync()).GetProperty("version").GetInt64());
        Assert.Equal((true, false, true), afterSave);
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        Assert.Equal("08:15", (await stale.JsonAsync()).GetProperty("morningOutfitLocalTime").GetString());
        Assert.Equal(HttpStatusCode.OK, moved.StatusCode);
        Assert.Equal((false, true, true, false), afterMove);
        Assert.Equal(HttpStatusCode.OK, off.StatusCode);
        Assert.False(await Slot("09:00"));

        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutJsonAsync("v1/tenant/user/me/notifications", Prefs(3, "08:10"))).StatusCode);        // not a quarter hour
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutJsonAsync("v1/tenant/user/me/notifications", Prefs(3, zone: "Mars/Olympus"))).StatusCode);
    }

    [Fact]
    public async Task Device_RegisterWithPushToken_SwitchesNotificationsOn_Once_Remove()
    {
        var (client, auth) = await factory.RegisterAsync();

        var noToken = await client.PutJsonAsync("v1/tenant/user/me/device", new { deviceId = "device-0001", platform = "ios" });
        var prefsBefore = await (await client.GetAsync("v1/tenant/user/me/notifications")).JsonAsync();
        var withToken = await client.PutJsonAsync("v1/tenant/user/me/device", new { deviceId = "device-0001", platform = "ios", pushToken = "fcm-token-1", timeZone = "Europe/Berlin" });
        var prefsAfter = await (await client.GetAsync("v1/tenant/user/me/notifications")).JsonAsync();
        (await client.PutJsonAsync("v1/tenant/user/me/notifications", new { morningOutfit = false, morningOutfitLocalTime = "07:30", weeklyEdit = false, friendRatings = false, timeZone = "Europe/Berlin", baseVersion = 1 })).EnsureSuccessStatusCode();
        await client.PutJsonAsync("v1/tenant/user/me/device", new { deviceId = "device-0002", platform = "android", pushToken = "fcm-token-2" });
        var prefsKept = await (await client.GetAsync("v1/tenant/user/me/notifications")).JsonAsync();
        var settings = await (await client.GetAsync("v1/tenant/settings")).JsonAsync();
        var invalid = await client.PutJsonAsync("v1/tenant/user/me/device", new { deviceId = "x", platform = "windows" });
        var removed = await client.DeleteAsync("v1/tenant/user/me/device/device-0001");

        Assert.False((await noToken.JsonAsync()).GetProperty("pushEnabled").GetBoolean());
        Assert.Equal(0, prefsBefore.GetProperty("version").GetInt64());
        Assert.True((await withToken.JsonAsync()).GetProperty("pushEnabled").GetBoolean());
        Assert.Equal((true, true, true, "Europe/Berlin"), (prefsAfter.GetProperty("morningOutfit").GetBoolean(), prefsAfter.GetProperty("weeklyEdit").GetBoolean(),
            prefsAfter.GetProperty("friendRatings").GetBoolean(), prefsAfter.GetProperty("timeZone").GetString()));
        Assert.False(prefsKept.GetProperty("weeklyEdit").GetBoolean());              // a later device never overrides the user's choice
        Assert.Equal(2, settings.GetProperty("devices").GetArrayLength());
        Assert.Equal("tr", settings.GetProperty("language").GetString());
        Assert.DoesNotContain("fcm-token", settings.GetRawText());                    // tokens are never returned
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, removed.StatusCode);
        Assert.Single(await factory.Repository.GetKeysAsync(DeviceEntity.GetPk(auth.TenantId)));
    }

    [Fact]
    public async Task Events_AllowListedBatch_RejectsPerEvent_NoPersonalContentStored()
    {
        var admin = await factory.AdminAsync();
        var (client, auth) = await factory.RegisterAsync();

        var response = await client.PostJsonAsync("v1/tenant/event", new
        {
            platform = "ios", appVersion = "1.0.0",
            events = new object[]
            {
                new { name = "signup_completed", occurredAt = DateTime.UtcNow.AddMinutes(-5) },
                new { name = "paywall_viewed", props = new { source = "tryon", count = 2 } },
                new { name = "conversion" },                                             // server only
                new { name = "made_up_event" },
                new { name = "paywall_viewed", props = new { email = "a@b.co" } },
                new { name = "paywall_viewed", props = new { source = "akşam yemeği için" } },
            },
        });
        var body = await response.JsonAsync();
        var tooMany = await client.PostJsonAsync("v1/tenant/event", new { events = Enumerable.Range(0, 51).Select(_ => new { name = "paywall_viewed" }) });
        var none = await client.PostJsonAsync("v1/tenant/event", new { events = Array.Empty<object>() });
        var funnel = await (await admin.GetAsync("v1/admin/report/funnel")).JsonAsync();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(2, body.GetProperty("accepted").GetInt32());
        Assert.Equal([(2, "name_server_only"), (3, "name_not_allowed"), (4, "prop_not_allowed"), (5, "prop_value_invalid")],
            body.GetProperty("rejected").EnumerateArray().Select(r => (r.GetProperty("index").GetInt32(), r.GetProperty("code").GetString()!)).ToArray());
        Assert.Equal(HttpStatusCode.BadRequest, tooMany.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, none.StatusCode);
        Assert.True(funnel.GetProperty("steps").EnumerateArray().Single(s => s.GetProperty("name").GetString() == "paywall_viewed").GetProperty("actors").GetInt32() >= 1);

        var stored = factory.Repository.Keys.Where(k => k.Pk.StartsWith("analytics#", StringComparison.Ordinal)).Select(k => factory.Repository.Raw(k.Pk, k.Sk)).ToList();
        Assert.NotEmpty(stored);
        Assert.All(stored, json => { Assert.DoesNotContain(auth.TenantId, json); Assert.DoesNotContain(auth.UserId, json); Assert.Contains("\"ttl\"", json); });
    }

    [Fact]
    public async Task Weather_CitySearch_ForecastByCityIsCached_ByLocationIsRounded_Errors()
    {
        var (client, _) = await factory.RegisterAsync();

        var cities = await (await client.GetAsync("v1/weather/city?q=ist")).JsonAsync();
        var cityId = cities[0].GetProperty("id").GetString();
        var callsBefore = factory.Weather.ForecastCalls;
        var week = await (await client.GetAsync($"v1/weather?cityId={cityId}")).JsonAsync();
        var today = await (await client.GetAsync($"v1/weather?cityId={cityId}&days=1")).JsonAsync();
        var callsAfterCity = factory.Weather.ForecastCalls;
        var byLocation = await (await client.GetAsync("v1/weather?lat=41.0082&lon=28.9784&days=3")).JsonAsync();
        await client.GetAsync("v1/weather?lat=41.04&lon=29.04&days=3");            // same 0.1° cell → cache
        var callsAfterLocation = factory.Weather.ForecastCalls;

        Assert.Equal("İstanbul", cities[0].GetProperty("name").GetString());          // request language (profile: tr)
        Assert.Equal(7, week.GetProperty("days").GetArrayLength());
        Assert.Equal(("2026-11-18", 8.0, 15.0, "rain", 70), (week.GetProperty("days")[0].GetProperty("date").GetString(), week.GetProperty("days")[0].GetProperty("minC").GetDouble(),
            week.GetProperty("days")[0].GetProperty("maxC").GetDouble(), week.GetProperty("days")[0].GetProperty("condition").GetString(), week.GetProperty("days")[0].GetProperty("precipitationProbability").GetInt32()));
        Assert.Equal(1, today.GetProperty("days").GetArrayLength());
        Assert.Equal(1, callsAfterCity - callsBefore);                                // second read came from the global cache
        Assert.Equal(3, byLocation.GetProperty("days").GetArrayLength());
        Assert.Equal("geo:41.0:29.0", byLocation.GetProperty("locationKey").GetString());
        Assert.Equal(1, callsAfterLocation - callsAfterCity);
        Assert.Contains((41.0, 29.0), factory.Weather.Requested);                     // only the rounded location reaches the provider
        Assert.DoesNotContain(factory.Weather.Requested, r => r.Lat == 41.0082);

        Assert.Equal("city_not_found", await (await client.GetAsync("v1/weather?cityId=999")).CodeAsync());
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("v1/weather")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("v1/weather?lat=95&lon=10")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync($"v1/weather?cityId={cityId}&days=8")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("v1/weather/city?q=i")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().GetAsync("v1/weather/city?q=ist")).StatusCode);

        factory.Weather.Down = true;
        try
        {
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync($"v1/weather?cityId={cityId}")).StatusCode);          // cached
            var unavailable = await client.GetAsync("v1/weather?lat=10&lon=10");
            Assert.Equal(HttpStatusCode.ServiceUnavailable, unavailable.StatusCode);
            Assert.Equal("weather_unavailable", await unavailable.CodeAsync());
            Assert.Equal(HttpStatusCode.ServiceUnavailable, (await client.GetAsync("v1/weather/city?q=ist")).StatusCode);
        }
        finally
        {
            factory.Weather.Down = false;
        }
    }
}

public class AccountDeletionCrossTenantTests(StoreSocialApiFactory factory) : IClassFixture<StoreSocialApiFactory>
{
    [Fact]
    public async Task DeleteAccount_RemovesEveryTraceInOtherTenantsAndGlobalIndexes_KeepsAnonymousRevenue()
    {
        var admin = await factory.AdminAsync();
        var brand = await factory.SeedBrandAsync(admin);
        var product = await factory.SeedProductAsync(admin, brand, 250_000);
        StyleTag[] tags = [StyleTag.Minimal, StyleTag.Classic, StyleTag.Boho];
        var leaving = await factory.UserAsync(ClosetVisibility.Public, tags);
        var friend = await factory.UserAsync(ClosetVisibility.Public, tags);
        var blocked = await factory.UserAsync();
        var (invitee, inviteeAuth) = await factory.RegisterAsync();
        var leavingLook = factory.Closet.AddLook(leaving.TenantId);
        var friendLook = factory.Closet.AddLook(friend.TenantId);

        // Social graph in both directions.
        await leaving.Client.PostAsync($"v1/tenant/follow/{friend.Handle}", null);
        await friend.Client.PostAsync($"v1/tenant/follow/{leaving.Handle}", null);
        await leaving.Client.PutJsonAsync($"v1/tenant/people/{friend.Handle}/look/{friendLook}/rating", new { score = 1 });
        await blocked.Client.PutJsonAsync($"v1/tenant/people/{friend.Handle}/look/{friendLook}/rating", new { score = 5 });
        await friend.Client.PutJsonAsync($"v1/tenant/people/{leaving.Handle}/look/{leavingLook}/rating", new { score = 4 });
        await leaving.Client.PutAsync($"v1/tenant/people/{friend.Handle}/look/{friendLook}/save", null);
        await friend.Client.PutAsync($"v1/tenant/people/{leaving.Handle}/look/{leavingLook}/save", null);
        await leaving.Client.PostJsonAsync($"v1/tenant/people/{blocked.Handle}/report", new { targetKind = "profile", reason = "harassment" });
        await friend.Client.PostJsonAsync($"v1/tenant/people/{leaving.Handle}/report", new { targetKind = "profile", reason = "spam" });
        await leaving.Client.PutAsync($"v1/tenant/block/{blocked.Handle}", null);
        // Invite edges, settings, store.
        var code = (await (await leaving.Client.GetAsync("v1/tenant/invite/link")).JsonAsync()).GetProperty("code").GetString()!;
        (await invitee.PostJsonAsync("v1/tenant/invite/attribution", new { code })).EnsureSuccessStatusCode();
        await leaving.Client.PutJsonAsync("v1/tenant/user/me/device", new { deviceId = "device-0001", platform = "ios", pushToken = "fcm-token-1" });
        await leaving.Client.PutJsonAsync($"v1/tenant/watch-list/{product}", new { });
        await leaving.Client.PostJsonAsync("v1/tenant/cart/line", new { lines = new[] { new { productId = product, size = "M" } } });
        var clickId = (await (await leaving.Client.PostAsync($"v1/tenant/cart/checkout/{brand}", null)).JsonAsync()).GetProperty("clickId").GetString()!;
        (await factory.CreateClient().SendAsync(StoreSocialApiFactory.SignedPostback("network",
            new { clickId, orderId = "ORD-DEL-1", amountMinor = 250_000, status = "approved" }, StoreSocialApiFactory.NetworkSecret))).EnsureSuccessStatusCode();

        // Wardrobe side (E2–E7): uploads, drafts, items, looks, plan, wear log, trips, stylist feedback, palette, jobs —
        // through the API where one call does it, otherwise as the rows the workers / accept endpoints write.
        var now = DateTime.UtcNow;
        var today = CalendarDay.ToText(DateOnly.FromDateTime(now));
        var tripId = Domain.Extensions.Ulid.New();
        (await leaving.Client.PostJsonAsync("v1/tenant/item/upload-url", new { count = 1, contentType = "image/jpeg" })).EnsureSuccessStatusCode();
        (await leaving.Client.PostJsonAsync("v1/tenant/item/from-product", new { clientMutationId = Domain.Extensions.Ulid.New(), productId = product })).EnsureSuccessStatusCode();
        (await leaving.Client.PutJsonAsync($"v1/tenant/plan-day/{today}", new { lookId = leavingLook, baseVersion = 0 })).EnsureSuccessStatusCode();
        (await leaving.Client.PostJsonAsync("v1/tenant/wear-log", new { clientMutationId = Domain.Extensions.Ulid.New(), date = today, occurredAt = now, lookId = leavingLook })).EnsureSuccessStatusCode();
        (await leaving.Client.PostJsonAsync("v1/tenant/trip", new { id = tripId, cityId = "2988507", cityName = "Paris", startDate = today, endDate = today })).EnsureSuccessStatusCode();
        await factory.Repository.SaveAsync(new ItemDraftEntity { Id = "draft-1", TenantId = leaving.TenantId, Status = ItemDraftStatus.Ready, CreatedAt = now, UpdatedAt = now });
        await factory.Repository.SaveAsync(new TripItemEntity { TenantId = leaving.TenantId, TripId = tripId, ItemId = ClosetSeeder.SharedItemId, PlannedWears = 1 });
        await factory.Repository.SaveAsync(new TripDayEntity { TenantId = leaving.TenantId, TripId = tripId, Date = today });
        await factory.Repository.SaveAsync(new StylistFeedbackEntity { TenantId = leaving.TenantId, JobId = "job-1", Index = 0, CreatedAt = now });
        await factory.Repository.SaveAsync(new PaletteResultEntity { TenantId = leaving.TenantId, SeasonTypeId = "cool-winter", AnalyzedAt = now });
        await factory.Repository.SaveAsync(new JobEntity { Id = "job-1", TenantId = leaving.TenantId, Kind = JobKind.StylistOutfit, Status = JobStatus.Completed, CreatedAt = now, UpdatedAt = now });

        // Every tenant-scoped entity type of both halves that this scenario can produce really has a row before the deletion.
        Type[] expected =
        [
            typeof(ItemEntity), typeof(ItemUploadEntity), typeof(ItemDraftEntity), typeof(LookEntity), typeof(PlanDayEntity), typeof(WearLogEntity),
            typeof(TripEntity), typeof(TripItemEntity), typeof(TripDayEntity), typeof(StylistFeedbackEntity), typeof(PaletteResultEntity), typeof(JobEntity),
            typeof(MutationReceiptEntity), typeof(LookRatingSummaryEntity), typeof(FollowingEntity), typeof(FollowerEntity), typeof(RatingGivenEntity),
            typeof(SavedLookEntity), typeof(BlockEntity), typeof(CartLineEntity), typeof(WatchItemEntity), typeof(DeviceEntity), typeof(AffiliateConversionEntity),
        ];
        var partitions = DeletionPlan.TenantScopedEntityTypes.Zip(DeletionPlan.TenantPartitionKeys(leaving.TenantId)).ToDictionary(p => p.First, p => p.Second);
        foreach (var type in expected)
            Assert.True((await factory.Repository.GetKeysAsync(partitions[type])).Count > 0, $"{type.Name} has no row before the deletion — the test would prove nothing for it.");

        var deleted = await leaving.Client.DeleteAsync("v1/auth/me");

        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
        // Nothing anywhere still names the deleted tenant (refresh tokens are unusable and expire by TTL — foundation behaviour).
        var leftovers = factory.Repository.Keys
            .Where(k => k.Pk != RefreshTokenEntity.GetPk())
            .Where(k => k.Pk.Contains(leaving.TenantId) || k.Sk.Contains(leaving.TenantId) || factory.Repository.Raw(k.Pk, k.Sk).Contains(leaving.TenantId))
            .Select(k => $"{k.Pk} | {k.Sk}").ToList();
        Assert.True(leftovers.Count == 0, "Still references the deleted tenant:\n" + string.Join("\n", leftovers));
        foreach (var pk in DeletionPlan.TenantPartitionKeys(leaving.TenantId))
            Assert.Empty(await factory.Repository.GetKeysAsync(pk));

        // The friend's world is consistent: no edge, the average no longer contains the deleted rating, the handle is free.
        var friendProfile = await (await friend.Client.GetAsync($"v1/tenant/people/{friend.Handle}")).JsonAsync();
        var rating = (await (await friend.Client.GetAsync($"v1/tenant/people/{friend.Handle}/look")).JsonAsync())[0].GetProperty("rating");
        Assert.Equal((0, 0), (friendProfile.GetProperty("followerCount").GetInt32(), friendProfile.GetProperty("followingCount").GetInt32()));
        Assert.Equal((5.0, 1L), (rating.GetProperty("average").GetDouble(), rating.GetProperty("count").GetInt64()));
        Assert.Equal(0, (await (await friend.Client.GetAsync("v1/tenant/saved-look")).JsonAsync()).GetArrayLength());
        Assert.Equal(HttpStatusCode.NotFound, (await friend.Client.GetAsync($"v1/tenant/people/{leaving.Handle}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await factory.CreateClient().GetAsync($"v1/invite/{code}")).StatusCode);
        Assert.Null((await factory.Repository.GetAsync<InviteEntity>(InviteEntity.GetPk(inviteeAuth.TenantId), InviteEntity.GetSk()))!.InvitedByTenantId);

        // Moderation: the report she filed stays without her; the report about her is gone.
        var open = (await (await admin.GetAsync("v1/admin/moderation/report")).JsonAsync()).GetProperty("items").EnumerateArray().ToList();
        Assert.Contains(open, r => r.GetProperty("targetHandle").GetString() == blocked.Handle && r.GetProperty("reporterTenantId").ValueKind == JsonValueKind.Null);

        // Revenue survives without the person; a late postback for her click still lands.
        var report = await (await admin.GetAsync("v1/admin/report/revenue")).JsonAsync();
        Assert.Contains(report.GetProperty("byBrand").EnumerateArray(), b => b.GetProperty("key").GetString() == brand && b.GetProperty("gmvMinor").GetInt64() == 250_000);
        var late = await factory.CreateClient().SendAsync(StoreSocialApiFactory.SignedPostback("network",
            new { clickId, orderId = "ORD-DEL-2", amountMinor = 100_000, status = "pending" }, StoreSocialApiFactory.NetworkSecret));
        Assert.Equal("recorded", (await late.JsonAsync()).GetProperty("outcome").GetString());
    }
}
