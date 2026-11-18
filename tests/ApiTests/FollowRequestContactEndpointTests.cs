using System.Net;
using System.Text.Json;
using Domain.Entity;
using Domain.Enum;
using Domain.Services;
using Microsoft.Extensions.DependencyInjection;

namespace ApiTests;

/// <summary>Decision 8 (follow approval), 7 (default visibility), 9 (notification defaults) and 13 (contact matching).</summary>
public class FollowRequestEndpointTests(StoreSocialApiFactory factory) : IClassFixture<StoreSocialApiFactory>
{
    private static async Task<string?> State(HttpResponseMessage response) => (await response.JsonAsync()).GetProperty("state").GetString();

    private static async Task<string[]> Handles(HttpClient client, string url) =>
        (await (await client.GetAsync(url)).JsonAsync()).EnumerateArray().Select(r => r.GetProperty("person").GetProperty("handle").GetString()!).ToArray();

    [Fact]
    public async Task NewAccount_IsFollowersOnly_AndItsCardIsSearchable()
    {
        var (client, auth) = await factory.RegisterAsync();
        var handle = StoreSocialApiFactory.Unique();
        (await client.PutJsonAsync("v1/tenant/profile/handle", new { handle })).EnsureSuccessStatusCode();
        var viewer = await factory.UserAsync();

        var profile = await (await client.GetAsync("v1/tenant/profile")).JsonAsync();
        var found = await (await viewer.Client.GetAsync($"v1/tenant/people?q={handle}")).JsonAsync();

        Assert.Equal("followersOnly", profile.GetProperty("closetVisibility").GetString());
        var card = Assert.Single(found.EnumerateArray());
        Assert.Equal("none", card.GetProperty("followState").GetString());
        Assert.Null(await factory.Repository.GetAsync<PublicProfileIndexEntity>(PublicProfileIndexEntity.GetPk(Segment.Women), PublicProfileIndexEntity.GetSk(auth.TenantId)));
    }

    [Fact]
    public async Task PublicAccount_IsFollowedAtOnce_NoRequest()
    {
        var owner = await factory.UserAsync(ClosetVisibility.Public);
        var viewer = await factory.UserAsync();

        var follow = await viewer.Client.PostAsync($"v1/tenant/follow/{owner.Handle}", null);

        Assert.Equal("following", await State(follow));
        Assert.Empty(await Handles(owner.Client, "v1/tenant/follow-request/incoming"));
        Assert.Empty(await Handles(viewer.Client, "v1/tenant/follow-request/outgoing"));
    }

    [Fact]
    public async Task Request_IsListedBothSides_Declined_Cancelled_AndPendingNeverOpensTheCloset()
    {
        var owner = await factory.UserAsync(ClosetVisibility.FollowersOnly);
        var alice = await factory.UserAsync(ClosetVisibility.Private);   // a private requester is still shown to the owner
        var bob = await factory.UserAsync();
        factory.Closet.AddLook(owner.TenantId);

        Assert.Equal("requested", await State(await alice.Client.PostAsync($"v1/tenant/follow/{owner.Handle}", null)));
        Assert.Equal("requested", await State(await bob.Client.PostAsync($"v1/tenant/follow/{owner.Handle}", null)));

        var incoming = await Handles(owner.Client, "v1/tenant/follow-request/incoming");
        var outgoing = await Handles(alice.Client, "v1/tenant/follow-request/outgoing");
        var aliceSeenByOwner = await (await owner.Client.GetAsync($"v1/tenant/people/{alice.Handle}")).JsonAsync();
        var feed = await (await alice.Client.GetAsync("v1/tenant/feed")).JsonAsync();

        Assert.Equal(new[] { alice.Handle, bob.Handle }.Order(StringComparer.Ordinal), incoming.Order(StringComparer.Ordinal));
        Assert.Equal([owner.Handle], outgoing);
        Assert.True(aliceSeenByOwner.GetProperty("requestedYou").GetBoolean());   // approve from her profile
        Assert.True(aliceSeenByOwner.GetProperty("closetLocked").GetBoolean());   // her private closet stays closed
        Assert.Equal(0, feed.GetProperty("items").GetArrayLength());               // pending = not following
        Assert.Equal(HttpStatusCode.NotFound, (await alice.Client.GetAsync($"v1/tenant/people/{owner.Handle}/look")).StatusCode);

        // Decline Alice, Bob withdraws: nothing pending, nobody follows.
        Assert.Equal(HttpStatusCode.NoContent, (await owner.Client.PostAsync($"v1/tenant/follow-request/{alice.Handle}/decline", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await bob.Client.DeleteAsync($"v1/tenant/follow-request/{owner.Handle}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await bob.Client.DeleteAsync($"v1/tenant/follow-request/{owner.Handle}")).StatusCode);   // idempotent
        Assert.Equal(HttpStatusCode.NotFound, (await owner.Client.PostAsync($"v1/tenant/follow-request/{bob.Handle}/approve", null)).StatusCode);
        Assert.Empty(await Handles(owner.Client, "v1/tenant/follow-request/incoming"));
        Assert.Equal("none", (await (await alice.Client.GetAsync($"v1/tenant/people/{owner.Handle}")).JsonAsync()).GetProperty("followState").GetString());
        Assert.Empty(await factory.Repository.GetAllAsync<NotificationQueueEntity>(NotificationQueueEntity.GetPk(NotificationType.FollowRequest), $"{owner.TenantId}#", Domain.Manager.SkOperator.BeginsWith));
    }

    [Fact]
    public async Task Approve_MakesAFollower_RemoveFollower_ClosesAgain_UnfollowCancelsRequest()
    {
        var owner = await factory.UserAsync(ClosetVisibility.FollowersOnly);
        var viewer = await factory.UserAsync();
        factory.Closet.AddLook(owner.TenantId);

        await viewer.Client.PostAsync($"v1/tenant/follow/{owner.Handle}", null);
        Assert.NotNull(await factory.Repository.GetAsync<NotificationQueueEntity>(
            NotificationQueueEntity.GetPk(NotificationType.FollowRequest), NotificationQueueEntity.GetSk(owner.TenantId, viewer.TenantId)));   // push outbox
        Assert.Equal(HttpStatusCode.NoContent, (await owner.Client.PostAsync($"v1/tenant/follow-request/{viewer.Handle}/approve", null)).StatusCode);
        var followers = await (await owner.Client.GetAsync("v1/tenant/follower")).JsonAsync();
        var looks = await viewer.Client.GetAsync($"v1/tenant/people/{owner.Handle}/look");

        Assert.Equal(viewer.Handle, Assert.Single(followers.EnumerateArray()).GetProperty("handle").GetString());
        Assert.Equal(HttpStatusCode.OK, looks.StatusCode);
        Assert.Equal("following", await State(await viewer.Client.PostAsync($"v1/tenant/follow/{owner.Handle}", null)));

        Assert.Equal(HttpStatusCode.NoContent, (await owner.Client.DeleteAsync($"v1/tenant/follower/{viewer.Handle}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await viewer.Client.GetAsync($"v1/tenant/people/{owner.Handle}/look")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await owner.Client.DeleteAsync($"v1/tenant/follower/{viewer.Handle}")).StatusCode);   // idempotent

        // Ask again, then unfollow: the pending request goes too.
        Assert.Equal("requested", await State(await viewer.Client.PostAsync($"v1/tenant/follow/{owner.Handle}", null)));
        Assert.Equal(HttpStatusCode.NoContent, (await viewer.Client.DeleteAsync($"v1/tenant/follow/{owner.Handle}")).StatusCode);
        Assert.Empty(await Handles(owner.Client, "v1/tenant/follow-request/incoming"));
    }

    [Fact]
    public async Task PrivateAccount_HiddenFromStrangers_ButReachableInsideARelationship()
    {
        var owner = await factory.UserAsync(ClosetVisibility.Private);
        var stranger = await factory.UserAsync();
        var friend = await factory.UserAsync(ClosetVisibility.Public);
        await owner.Client.PostAsync($"v1/tenant/follow/{friend.Handle}", null);   // owner follows friend (public → immediate)

        Assert.Equal(HttpStatusCode.NotFound, (await stranger.Client.GetAsync($"v1/tenant/people/{owner.Handle}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.Client.PostAsync($"v1/tenant/follow/{owner.Handle}", null)).StatusCode);
        var asFriend = await (await friend.Client.GetAsync($"v1/tenant/people/{owner.Handle}")).JsonAsync();
        Assert.True(asFriend.GetProperty("followsYou").GetBoolean());
        Assert.Equal("requested", await State(await friend.Client.PostAsync($"v1/tenant/follow/{owner.Handle}", null)));
        await owner.Client.PostAsync($"v1/tenant/follow-request/{friend.Handle}/approve", null);
        // A private closet stays closed even to an approved follower; only the card is shared.
        Assert.Equal(HttpStatusCode.NotFound, (await friend.Client.GetAsync($"v1/tenant/people/{owner.Handle}/look")).StatusCode);
        Assert.Equal("following", (await (await friend.Client.GetAsync($"v1/tenant/people/{owner.Handle}")).JsonAsync()).GetProperty("followState").GetString());
    }

    [Fact]
    public async Task Block_RemovesPendingRequestsBothWays_AndBlocksNewOnes()
    {
        var owner = await factory.UserAsync(ClosetVisibility.FollowersOnly);
        var pest = await factory.UserAsync(ClosetVisibility.FollowersOnly);
        await pest.Client.PostAsync($"v1/tenant/follow/{owner.Handle}", null);
        await owner.Client.PostAsync($"v1/tenant/follow/{pest.Handle}", null);

        (await owner.Client.PutAsync($"v1/tenant/block/{pest.Handle}", null)).EnsureSuccessStatusCode();

        Assert.Empty(await Handles(owner.Client, "v1/tenant/follow-request/incoming"));
        Assert.Empty(await Handles(owner.Client, "v1/tenant/follow-request/outgoing"));
        Assert.Empty(await Handles(pest.Client, "v1/tenant/follow-request/outgoing"));
        Assert.Equal(HttpStatusCode.NotFound, (await pest.Client.PostAsync($"v1/tenant/follow/{owner.Handle}", null)).StatusCode);
        Assert.Empty(await factory.Repository.GetKeysAsync(FollowRequestReceivedEntity.GetPk(owner.TenantId)));
        Assert.Empty(await factory.Repository.GetKeysAsync(FollowRequestReceivedEntity.GetPk(pest.TenantId)));
    }

    [Fact]
    public async Task HandleAvailability_InvalidReservedTakenFreeAndOwn()
    {
        var me = await factory.UserAsync();
        var other = await factory.UserAsync();

        async Task<(bool, string?)> Check(string handle)
        {
            var body = await (await me.Client.GetAsync($"v1/tenant/profile/handle/availability?handle={Uri.EscapeDataString(handle)}")).JsonAsync();
            return (body.GetProperty("available").GetBoolean(), body.GetProperty("code").ValueKind == JsonValueKind.Null ? null : body.GetProperty("code").GetString());
        }

        Assert.Equal((false, "handle_invalid"), await Check("a!"));
        Assert.Equal((false, "handle_reserved"), await Check("@Admin"));
        Assert.Equal((false, "handle_taken"), await Check(other.Handle));
        Assert.Equal((true, (string?)null), await Check(me.Handle));
        Assert.Equal((true, (string?)null), await Check(StoreSocialApiFactory.Unique("free")));
    }

    [Fact]
    public async Task NotificationPrefs_NewTypes_DefaultOff_KeptWhenOmitted_DriveTheSendLists()
    {
        var (client, auth) = await factory.RegisterAsync();
        Task<bool> Subscribed(NotificationType type) => Task.FromResult(factory.Repository.Keys.Contains((NotificationSubscriberEntity.GetPk(type), NotificationSubscriberEntity.GetSk(auth.TenantId))));

        var on = await client.PutJsonAsync("v1/tenant/user/me/notifications", new
        {
            morningOutfit = false, morningOutfitLocalTime = "07:30", weeklyEdit = false, friendRatings = false, timeZone = "Europe/Istanbul",
            priceDrop = true, followRequests = true, baseVersion = 0,
        });
        var subscribedAfterOn = (await Subscribed(NotificationType.PriceDrop), await Subscribed(NotificationType.FollowRequest));
        var omitted = await client.PutJsonAsync("v1/tenant/user/me/notifications", new
        {
            morningOutfit = true, morningOutfitLocalTime = "07:30", weeklyEdit = false, friendRatings = false, timeZone = "Europe/Istanbul", baseVersion = 1,
        });
        var off = await client.PutJsonAsync("v1/tenant/user/me/notifications", new
        {
            morningOutfit = true, morningOutfitLocalTime = "07:30", weeklyEdit = false, friendRatings = false, timeZone = "Europe/Istanbul",
            priceDrop = false, followRequests = false, baseVersion = 2,
        });

        Assert.Equal((true, true), ((await on.JsonAsync()).GetProperty("priceDrop").GetBoolean(), (await on.JsonAsync()).GetProperty("followRequests").GetBoolean()));
        Assert.Equal((true, true), subscribedAfterOn);
        Assert.Equal((true, true), ((await omitted.JsonAsync()).GetProperty("priceDrop").GetBoolean(), (await omitted.JsonAsync()).GetProperty("followRequests").GetBoolean()));
        Assert.Equal((false, false), ((await off.JsonAsync()).GetProperty("priceDrop").GetBoolean(), (await off.JsonAsync()).GetProperty("followRequests").GetBoolean()));
        Assert.Equal((false, false), (await Subscribed(NotificationType.PriceDrop), await Subscribed(NotificationType.FollowRequest)));
    }
}

public class ContactMatchEndpointTests(StoreSocialApiFactory factory) : IClassFixture<StoreSocialApiFactory>
{
    private static object Hash(string salt, string email)
    {
        var h0 = ContactHashRules.BaseHash(ContactHashRules.NormalizeEmail(email));
        return new { p = ContactHashRules.Prefix(h0), h = ContactHashRules.Salted(salt, ContactHashRules.EmailKind, h0) };
    }

    private async Task<(string SaltId, string Salt)> SaltAsync(HttpClient client)
    {
        var body = await (await client.PostAsync("v1/tenant/contacts/salt", null)).JsonAsync();
        return (body.GetProperty("saltId").GetString()!, body.GetProperty("salt").GetString()!);
    }

    private async Task<TestUser> MemberAsync(string email, ClosetVisibility visibility = ClosetVisibility.FollowersOnly)
    {
        var user = await factory.UserAsync(visibility);
        await factory.Services.GetRequiredService<IContactDirectory>().ListVerifiedEmailAsync(user.TenantId, email, CancellationToken.None);
        return user;
    }

    [Fact]
    public async Task Match_FindsVisibleMembers_SkipsPrivateBlockedSelfAndUnknown_StoresNothing()
    {
        var tag = StoreSocialApiFactory.Unique("c");
        var me = await MemberAsync($"me-{tag}@example.com");
        var friend = await MemberAsync($"Friend-{tag}@Example.com");
        var hidden = await MemberAsync($"hidden-{tag}@example.com", ClosetVisibility.Private);
        var blocker = await MemberAsync($"blocker-{tag}@example.com");
        (await blocker.Client.PutAsync($"v1/tenant/block/{me.Handle}", null)).EnsureSuccessStatusCode();
        var rowsBefore = factory.Repository.Keys.ToHashSet();

        var (saltId, salt) = await SaltAsync(me.Client);
        object[] hashes =
        [
            Hash(salt, $"  friend-{tag}@example.com "), Hash(salt, $"hidden-{tag}@example.com"), Hash(salt, $"blocker-{tag}@example.com"),
            Hash(salt, $"me-{tag}@example.com"), Hash(salt, $"nobody-{tag}@example.com"),
        ];
        var response = await me.Client.PostJsonAsync("v1/tenant/contacts/match", new { saltId, hashes });
        var reused = await me.Client.PostJsonAsync("v1/tenant/contacts/match", new { saltId, hashes });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var match = Assert.Single((await response.JsonAsync()).GetProperty("matches").EnumerateArray());
        Assert.Equal(friend.Handle, match.GetProperty("handle").GetString());
        Assert.Equal("contact_salt_not_found", await reused.CodeAsync());                 // single use

        // Nothing of the upload was kept: no new row at all (the salt is consumed; rate-limit counters are not rows in this fake).
        Assert.DoesNotContain(factory.Repository.Keys, k => !rowsBefore.Contains(k));
        var uploaded = hashes.Select(h => JsonSerializer.Serialize(h)).ToList();
        Assert.DoesNotContain(factory.Repository.Keys, k => uploaded.Any(u => factory.Repository.Raw(k.Pk, k.Sk).Contains(JsonDocument.Parse(u).RootElement.GetProperty("h").GetString()!)));
    }

    [Fact]
    public async Task Match_ValidatesInput_AndExpiredOrForeignSaltsAreRejected()
    {
        var me = await factory.UserAsync();
        var other = await factory.UserAsync();
        var (saltId, salt) = await SaltAsync(other.Client);

        Assert.Equal(HttpStatusCode.NotFound, (await me.Client.PostJsonAsync("v1/tenant/contacts/match", new { saltId, hashes = new[] { Hash(salt, "x@example.com") } })).StatusCode);
        var (mine, mySalt) = await SaltAsync(me.Client);
        Assert.Equal(HttpStatusCode.BadRequest, (await me.Client.PostJsonAsync("v1/tenant/contacts/match", new { saltId = mine, hashes = Array.Empty<object>() })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await me.Client.PostJsonAsync("v1/tenant/contacts/match", new { saltId = mine, hashes = new[] { new { p = "zz", h = "abc" } } })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await me.Client.PostJsonAsync("v1/tenant/contacts/match",
            new { saltId = mine, hashes = Enumerable.Range(0, 1001).Select(i => Hash(mySalt, $"{i}@example.com")).ToArray() })).StatusCode);
    }

    [Fact]
    public async Task Match_IsRateLimitedPerAccount()
    {
        var me = await factory.UserAsync();
        var codes = new List<HttpStatusCode>();
        for (var i = 0; i < 11; i++)
        {
            var (saltId, salt) = await SaltAsync(me.Client);
            codes.Add((await me.Client.PostJsonAsync("v1/tenant/contacts/match", new { saltId, hashes = new[] { Hash(salt, "x@example.com") } })).StatusCode);
        }
        Assert.Equal(10, codes.Count(c => c == HttpStatusCode.OK));
        Assert.Equal(HttpStatusCode.TooManyRequests, codes[^1]);
    }
}
