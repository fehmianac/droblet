using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Domain.Entity;
using Domain.Enum;
using Domain.Extensions;
using Domain.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;

namespace ApiTests;

/// <summary>
/// Akış F2 (owner decision 21): sharing an own look to the home feed — the share guards, the 1-in-3 mix and its order,
/// exclusions (own, blocked, hidden, reported, teen, cover not ready), likes / saves / similar products on user posts,
/// reports with the automatic hide and the admin restore / remove, deletion, the weekly-edit fallback and ownedItemId.
/// No AI anywhere: covers are seeded as ready rows.
/// </summary>
public class FeedShareEndpointTests(StoreSocialApiFactory factory) : IClassFixture<StoreSocialApiFactory>
{
    private static readonly DateTime Now = DateTime.UtcNow;

    /// <summary>Posts (editor and user) and edits are global: each test starts from empty partitions.</summary>
    private async Task ClearAsync()
    {
        foreach (var pk in new[] { FeedPostEntity.GetPk(), FeedStoryEntity.GetPk(), FeedPostStatsEntity.GetPk(), FeedUserPostEntity.GetPk(), WeeklyEditEntity.GetPk() })
            await factory.Repository.BatchDeleteKeysAsync(await factory.Repository.GetKeysAsync(pk));
    }

    private async Task<string> EditorPostAsync(HttpClient admin, DateTime publishAt, string occasion = "office", string[]? productIds = null)
    {
        var id = Ulid.New();
        var response = await admin.PutJsonAsync($"v1/admin/feed-post/{id}", new
        {
            author = new { kind = "edit", name = StoreSocialApiFactory.Text("Droblet Edit", "Droblet Edit") },
            occasion,
            title = StoreSocialApiFactory.Text("Ofiste lacivert", "Navy at the office"),
            imageUrls = new[] { "https://img.example/feed-1.jpg" },
            productIds = productIds ?? [],
            publishAt,
            published = true,
        });
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        return id;
    }

    private async Task VerifyEmailAsync(string userId)
    {
        var user = (await factory.Repository.GetAsync<UserEntity>(UserEntity.GetPk(), UserEntity.GetSk(userId)))!;
        user.EmailVerifiedAt = DateTime.UtcNow;
        await factory.Repository.SaveAsync(user);
    }

    /// <summary>An adult with a handle and a verified e-mail: somebody who may share.</summary>
    private async Task<TestUser> SharerAsync(StyleTag[]? tags = null)
    {
        var user = await factory.UserAsync(tags: tags);
        await VerifyEmailAsync(user.UserId);
        return user;
    }

    /// <summary>A look (one white top) with the AI cover of its pieces ready, as the TryOn worker leaves it.</summary>
    private async Task<string> LookAsync(string tenantId, Occasion? occasion = Occasion.Office, bool coverReady = true)
    {
        var id = factory.Closet.AddLook(tenantId);
        var look = (await factory.Repository.GetAsync<LookEntity>(LookEntity.GetPk(tenantId), LookEntity.GetSk(id)))!;
        look.Occasion = occasion;
        await factory.Repository.SaveAsync(look);
        var hash = LookCoverRules.SlotsHash(look.Slots);
        await factory.Repository.SaveAsync(new LookCoverEntity
        {
            TenantId = tenantId, LookId = id, SlotsHash = hash, Attempts = 1, RequestedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow, Version = 1,
            Status = coverReady ? LookCoverStatus.Ready : LookCoverStatus.Pending,
            ImageKey = coverReady ? StorageKeys.LookCover(tenantId, id, hash) : null,
            ImageHash = coverReady ? hash : null,
        });
        return id;
    }

    /// <summary>Shares a look; returns the post id. sharedAt lets a test fix the "newest first" order.</summary>
    private async Task<string> ShareAsync(TestUser user, string lookId, DateTime? sharedAt = null)
    {
        var response = await user.Client.PutAsync($"v1/tenant/look/{lookId}/feed-share", null);
        Assert.True(response.StatusCode == HttpStatusCode.NoContent, $"{response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        var postId = FeedRules.UserPostId(user.TenantId, lookId);
        if (sharedAt is { } at)
        {
            var post = (await factory.Repository.GetAsync<FeedUserPostEntity>(FeedUserPostEntity.GetPk(), FeedUserPostEntity.GetSk(postId)))!;
            post.SharedAt = at;
            await factory.Repository.SaveAsync(post);
        }
        return postId;
    }

    private async Task<string> SharedLookAsync(TestUser user, DateTime? sharedAt = null, Occasion? occasion = Occasion.Office) =>
        await ShareAsync(user, await LookAsync(user.TenantId, occasion), sharedAt);

    private static async Task<JsonElement[]> FeedAsync(HttpClient client, string query = "") =>
        (await (await client.GetAsync("v1/content/feed" + query)).JsonAsync()).GetProperty("items").EnumerateArray().ToArray();

    private static string Id(JsonElement post) => post.GetProperty("id").GetString()!;
    private static string Kind(JsonElement post) => post.GetProperty("kind").GetString()!;

    private static Task<HttpResponseMessage> ReportAsync(HttpClient client, string postId, string reason = "inappropriate", string? note = null) =>
        client.PostJsonAsync($"v1/tenant/feed-post/{postId}/report", new { reason, note });

    // ── Sharing ─────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Share_Guards_Idempotent_LookDtoCarriesSharedAndStats_Unshare()
    {
        await ClearAsync();
        var (unverified, unverifiedAuth) = await factory.RegisterAsync();                 // no handle, e-mail not verified
        var draftLook = await LookAsync(unverifiedAuth.TenantId);
        var notVerified = await unverified.PutAsync($"v1/tenant/look/{draftLook}/feed-share", null);
        await VerifyEmailAsync(unverifiedAuth.UserId);
        var noHandle = await unverified.PutAsync($"v1/tenant/look/{draftLook}/feed-share", null);

        var user = await SharerAsync();
        var look = await LookAsync(user.TenantId);
        var imported = factory.Closet.AddLook(user.TenantId);
        var importedLook = (await factory.Repository.GetAsync<LookEntity>(LookEntity.GetPk(user.TenantId), LookEntity.GetSk(imported)))!;
        importedLook.Source = LookSource.Import;
        importedLook.CoverImageKey = $"{StorageKeys.TenantRoot(user.TenantId)}import/outfit.jpg";
        await factory.Repository.SaveAsync(importedLook);

        var before = await (await user.Client.GetAsync($"v1/tenant/look/{look}")).JsonAsync();
        var first = await user.Client.PutAsync($"v1/tenant/look/{look}/feed-share", null);
        var again = await user.Client.PutAsync($"v1/tenant/look/{look}/feed-share", null);
        var notShareable = await user.Client.PutAsync($"v1/tenant/look/{imported}/feed-share", null);
        var unknown = await user.Client.PutAsync($"v1/tenant/look/{Ulid.New()}/feed-share", null);
        var someoneElses = await unverified.PutAsync($"v1/tenant/look/{look}/feed-share", null);
        var anonymous = await factory.CreateClient().PutAsync($"v1/tenant/look/{look}/feed-share", null);
        var detail = await (await user.Client.GetAsync($"v1/tenant/look/{look}")).JsonAsync();
        var list = (await (await user.Client.GetAsync("v1/tenant/look")).JsonAsync()).EnumerateArray().ToDictionary(l => l.GetProperty("id").GetString()!);
        var importedDto = list[imported];

        Assert.Equal((HttpStatusCode.UnprocessableEntity, "email_not_verified"), (notVerified.StatusCode, await notVerified.CodeAsync()));
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "handle_required"), (noHandle.StatusCode, await noHandle.CodeAsync()));
        Assert.False(before.GetProperty("sharedToFeed").GetBoolean());
        Assert.Equal(JsonValueKind.Null, before.GetProperty("feedStats").ValueKind);
        Assert.Equal(HttpStatusCode.NoContent, first.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, again.StatusCode);                          // idempotent
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "look_not_shareable"), (notShareable.StatusCode, await notShareable.CodeAsync()));
        Assert.Equal("import", importedDto.GetProperty("source").GetString());              // how the app knows not to offer it
        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, someoneElses.StatusCode);                    // only my own look
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        Assert.True(detail.GetProperty("sharedToFeed").GetBoolean());
        Assert.Equal((0, 0), (detail.GetProperty("feedStats").GetProperty("likeCount").GetInt64(), detail.GetProperty("feedStats").GetProperty("saveCount").GetInt64()));
        Assert.True(list[look].GetProperty("sharedToFeed").GetBoolean());
        Assert.False(importedDto.GetProperty("sharedToFeed").GetBoolean());
        Assert.Single(await factory.Repository.GetKeysAsync(FeedUserPostEntity.GetPk()));   // one post, however often it was shared

        Assert.Equal(HttpStatusCode.NoContent, (await user.Client.DeleteAsync($"v1/tenant/look/{look}/feed-share")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await user.Client.DeleteAsync($"v1/tenant/look/{look}/feed-share")).StatusCode);   // idempotent
        Assert.False((await (await user.Client.GetAsync($"v1/tenant/look/{look}")).JsonAsync()).GetProperty("sharedToFeed").GetBoolean());
        Assert.Empty(await factory.Repository.GetKeysAsync(FeedUserPostEntity.GetPk()));
    }

    [Fact]
    public async Task Share_TeenIsRestricted_AndSeesEditorPostsOnly()
    {
        await ClearAsync();
        var admin = await factory.AdminAsync();
        var editor = await EditorPostAsync(admin, Now.AddHours(-1));
        var second = await EditorPostAsync(admin, Now.AddHours(-2));
        var third = await EditorPostAsync(admin, Now.AddHours(-3));
        var sharer = await SharerAsync();
        var userPost = await SharedLookAsync(sharer);
        var adult = await factory.UserAsync();

        var teen = factory.WithWebHostBuilder(b => b.UseSetting("Teen:Enabled", "true")).CreateClient();   // teen sign-up is switched off by default
        var registered = await teen.PostJsonAsync("v1/auth/register", new { name = "Elif Kaya", email = $"{Guid.NewGuid():N}@example.com", password = StoreSocialApiFactory.Password, birthYear = DateTime.UtcNow.Year - 17 });
        Assert.True(registered.IsSuccessStatusCode, await registered.Content.ReadAsStringAsync());
        teen.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", (await registered.JsonAsync()).GetProperty("accessToken").GetString());

        var share = await teen.PutAsync($"v1/tenant/look/{Ulid.New()}/feed-share", null);
        var teenFeed = await FeedAsync(teen);
        var adultFeed = await FeedAsync(adult.Client);

        Assert.Equal((HttpStatusCode.Forbidden, "teen_restricted"), (share.StatusCode, await share.CodeAsync()));
        Assert.Equal("social", (await share.JsonAsync()).GetProperty("feature").GetString());
        Assert.Equal([editor, second, third], teenFeed.Select(Id));                         // editor content only (decision 17)
        Assert.Equal([editor, second, userPost, third], adultFeed.Select(Id));
        Assert.Equal(HttpStatusCode.NotFound, (await teen.PutAsync($"v1/tenant/feed-post/{userPost}/like", null)).StatusCode);   // a user post does not exist for a teen
        Assert.Equal(HttpStatusCode.OK, (await teen.PutAsync($"v1/tenant/feed-post/{editor}/like", null)).StatusCode);
    }

    [Fact]
    public async Task Share_DailyLimit_WhenConfigured_429()
    {
        await ClearAsync();
        var user = await SharerAsync();
        var looks = new[] { await LookAsync(user.TenantId), await LookAsync(user.TenantId), await LookAsync(user.TenantId) };
        var limited = factory.WithWebHostBuilder(b => b.UseSetting("ContentFeed:MaxSharesPerDay", "2")).CreateClient();
        limited.DefaultRequestHeaders.Authorization = user.Client.DefaultRequestHeaders.Authorization;

        var first = await limited.PutAsync($"v1/tenant/look/{looks[0]}/feed-share", null);
        var repeat = await limited.PutAsync($"v1/tenant/look/{looks[0]}/feed-share", null);   // already shared: not counted again
        var second = await limited.PutAsync($"v1/tenant/look/{looks[1]}/feed-share", null);
        var third = await limited.PutAsync($"v1/tenant/look/{looks[2]}/feed-share", null);
        var unlimited = await user.Client.PutAsync($"v1/tenant/look/{looks[2]}/feed-share", null);   // default 0 = no limit

        Assert.All(new[] { first, repeat, second }, r => Assert.Equal(HttpStatusCode.NoContent, r.StatusCode));
        Assert.Equal((HttpStatusCode.TooManyRequests, "too_many_attempts"), (third.StatusCode, await third.CodeAsync()));
        Assert.Equal(HttpStatusCode.NoContent, unlimited.StatusCode);
    }

    // ── The mix ─────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Feed_OneInThree_FollowedThenStyleMatchThenNewest_NeverOwnBlockedHiddenOrCoverless()
    {
        await ClearAsync();
        var admin = await factory.AdminAsync();
        var editors = new List<string>();
        for (var i = 0; i < 8; i++)
            editors.Add(await EditorPostAsync(admin, Now.AddMinutes(-10 - i)));

        StyleTag[] tags = [StyleTag.Minimal, StyleTag.Classic, StyleTag.Street];
        var viewer = await SharerAsync(tags);
        var followed = await SharerAsync();                                            // followed, no style in common
        var twin = await SharerAsync(tags);                                            // 100 % style match
        var strangerNew = await SharerAsync();
        var strangerOld = await SharerAsync();
        var blocked = await SharerAsync(tags);
        var blocker = await SharerAsync(tags);
        var pending = await SharerAsync(tags);
        (await viewer.Client.PostAsync($"v1/tenant/follow/{followed.Handle}", null)).EnsureSuccessStatusCode();

        var own = await SharedLookAsync(viewer, Now.AddMinutes(-1));
        var fromFollowed = await SharedLookAsync(followed, Now.AddHours(-9));          // the oldest share, still first
        var fromTwin = await SharedLookAsync(twin, Now.AddHours(-5));
        var newer = await SharedLookAsync(strangerNew, Now.AddHours(-1));
        var older = await SharedLookAsync(strangerOld, Now.AddHours(-2));
        var hiddenForMe = await SharedLookAsync(strangerOld, Now.AddMinutes(-30));
        var fromBlocked = await SharedLookAsync(blocked, Now.AddMinutes(-2));
        var fromBlocker = await SharedLookAsync(blocker, Now.AddMinutes(-3));
        var coverless = await ShareAsync(pending, await LookAsync(pending.TenantId, coverReady: false));
        (await viewer.Client.PutAsync($"v1/tenant/block/{blocked.Handle}", null)).EnsureSuccessStatusCode();
        (await blocker.Client.PutAsync($"v1/tenant/block/{viewer.Handle}", null)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.NoContent, (await viewer.Client.PutAsync($"v1/tenant/feed-post/{hiddenForMe}/hide", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await viewer.Client.PutAsync($"v1/tenant/feed-post/{hiddenForMe}/hide", null)).StatusCode);   // idempotent

        var feed = await FeedAsync(viewer.Client);
        var ids = feed.Select(Id).ToArray();

        // Two editor posts, then one user look; the four user looks in rank order; editor posts carry on after them.
        Assert.Equal(
            [editors[0], editors[1], fromFollowed, editors[2], editors[3], fromTwin, editors[4], editors[5], newer, editors[6]],
            ids);
        Assert.Equal(["editor", "editor", "user", "editor", "editor", "user", "editor", "editor", "user", "editor"], feed.Select(Kind));
        var page2 = await (await viewer.Client.GetAsync("v1/content/feed?pageToken=" + (await (await viewer.Client.GetAsync("v1/content/feed")).JsonAsync()).GetProperty("pageToken").GetString())).JsonAsync();
        Assert.Equal([editors[7], older], page2.GetProperty("items").EnumerateArray().Select(Id));
        Assert.Equal(JsonValueKind.Null, page2.GetProperty("pageToken").ValueKind);
        var everything = ids.Concat(page2.GetProperty("items").EnumerateArray().Select(Id)).ToArray();
        Assert.DoesNotContain(own, everything);                                         // never the viewer's own look
        Assert.DoesNotContain(fromBlocked, everything);                                 // blocked pairs, both directions
        Assert.DoesNotContain(fromBlocker, everything);
        Assert.DoesNotContain(hiddenForMe, everything);                                 // "Bunu gösterme"
        Assert.DoesNotContain(coverless, everything);                                   // its cover is not ready yet

        // The cover comes: the look is listed. A hide of an editor post works the same way.
        var pendingLook = (await factory.Repository.GetAllAsync<LookEntity>(LookEntity.GetPk(pending.TenantId))).Single();
        var hash = LookCoverRules.SlotsHash(pendingLook.Slots);
        var cover = (await factory.Repository.GetAsync<LookCoverEntity>(LookCoverEntity.GetPk(pending.TenantId), LookCoverEntity.GetSk(pendingLook.Id)))!;
        cover.Status = LookCoverStatus.Ready;
        cover.ImageKey = StorageKeys.LookCover(pending.TenantId, pendingLook.Id, hash);
        cover.ImageHash = hash;
        await factory.Repository.SaveAsync(cover);
        Assert.Equal(HttpStatusCode.NoContent, (await viewer.Client.PutAsync($"v1/tenant/feed-post/{editors[0]}/hide", null)).StatusCode);
        var later = (await FeedAsync(viewer.Client)).Select(Id).ToArray();
        Assert.Equal(editors[1], later[0]);
        Assert.Equal([fromFollowed, coverless, fromTwin], later.Where(FeedRules.IsUserPostId));   // followed, then the two 100 % matches, newest first

        // The blocked user does not get the viewer's look either; a like on it answers 404 for both.
        Assert.DoesNotContain(own, (await FeedAsync(blocked.Client)).Select(Id));
        Assert.Equal(HttpStatusCode.NotFound, (await blocked.Client.PutAsync($"v1/tenant/feed-post/{own}/like", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await viewer.Client.PutAsync($"v1/tenant/feed-post/{fromBlocker}/like", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await viewer.Client.PutAsync($"v1/tenant/feed-post/{own}/like", null)).StatusCode);   // nobody likes their own look
    }

    [Fact]
    public async Task Feed_PagingStaysStableWithTheMix_OccasionFilterAppliesToUserLooks_NoEditorPostsNoUserLooks()
    {
        await ClearAsync();
        var admin = await factory.AdminAsync();
        var viewer = await factory.UserAsync();
        var sharers = new List<TestUser>();
        for (var i = 0; i < 3; i++)
            sharers.Add(await SharerAsync());
        var userPosts = new List<string>();
        for (var i = 0; i < 7; i++)
            userPosts.Add(await SharedLookAsync(sharers[i % 3], Now.AddMinutes(-i), i == 0 ? Occasion.Weekend : Occasion.Office));
        var noOccasion = await SharedLookAsync(sharers[0], Now.AddDays(-1), occasion: null);

        // Without a single editor post there is nothing to mix into: at most one in three means none.
        Assert.Empty(await FeedAsync(viewer.Client));

        var editors = new List<string>();
        for (var i = 0; i < 14; i++)
            editors.Add(await EditorPostAsync(admin, Now.AddMinutes(-10 - i), i == 13 ? "weekend" : "office"));
        var weekendEditor2 = await EditorPostAsync(admin, Now.AddDays(-2), "weekend");

        var all = new List<string>();
        string? token = null;
        var pages = 0;
        do
        {
            var page = await (await viewer.Client.GetAsync("v1/content/feed" + (token is null ? "" : $"?pageToken={token}"))).JsonAsync();
            var pageIds = page.GetProperty("items").EnumerateArray().Select(Id).ToArray();
            // A post un-shared between two pages (one not served yet) never shifts or repeats the rest.
            if (pages == 0)
                Assert.Equal(HttpStatusCode.NoContent, (await sharers[0].Client.DeleteAsync($"v1/tenant/look/{LookIdOf(sharers[0], userPosts[6])}/feed-share")).StatusCode);
            all.AddRange(pageIds);
            token = page.GetProperty("pageToken").GetString();
            pages++;
        } while (token is not null && pages < 10);

        Assert.Equal(3, pages);                                                         // 15 editor posts + 7 user looks, 10 a page
        Assert.Equal(all.Count, all.Distinct().Count());                                // nothing twice
        Assert.Equal([.. editors, weekendEditor2], all.Where(id => !FeedRules.IsUserPostId(id)));      // every editor post, in order
        Assert.Equal([.. userPosts.Take(6), noOccasion], all.Where(FeedRules.IsUserPostId));           // newest first; the un-shared one is gone
        for (var i = 0; i + 3 <= all.Count; i++)
            Assert.True(all.Skip(i).Take(3).Count(FeedRules.IsUserPostId) <= 1, $"more than one user look in the window at {i}");
        Assert.True(FeedRules.IsUserPostId(all[2]) && FeedRules.IsUserPostId(all[5]) && FeedRules.IsUserPostId(all[11]));

        // The occasion filter applies to both kinds; a look without an occasion matches no tab.
        var weekend = (await FeedAsync(viewer.Client, "?occasion=weekend")).Select(Id).ToArray();
        Assert.Equal([editors[13], weekendEditor2, userPosts[0]], weekend);
        Assert.DoesNotContain(noOccasion, (await FeedAsync(viewer.Client, "?occasion=office")).Select(Id));
    }

    private string LookIdOf(TestUser owner, string postId) =>
        factory.Repository.GetAllAsync<FeedShareEntity>(FeedShareEntity.GetPk(owner.TenantId)).GetAwaiter().GetResult().Single(s => s.PostId == postId).LookId;

    // ── The user post ───────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task UserPost_Shape_Pieces_SimilarProducts_LikeSaveSavedList_OwnerStats_NoTryOn()
    {
        await ClearAsync();
        var admin = await factory.AdminAsync();
        var brand = await factory.SeedBrandAsync(admin);
        var bag = await factory.SeedProductAsync(admin, brand, category: ProductCategory.Bag, colors: ["black"]);
        var whiteShirt = await factory.SeedProductAsync(admin, brand, category: ProductCategory.Shirt, colors: ["white", "blue"]);
        var whiteTee = await factory.SeedProductAsync(admin, brand, category: ProductCategory.Tshirt, colors: ["white"]);
        var redShirt = await factory.SeedProductAsync(admin, brand, category: ProductCategory.Shirt, colors: ["red"]);
        var whiteSkirt = await factory.SeedProductAsync(admin, brand, category: ProductCategory.Skirt, colors: ["white"]);
        var retired = await factory.SeedProductAsync(admin, brand, category: ProductCategory.Shirt, colors: ["white"]);
        await admin.DeleteAsync($"v1/admin/product/{retired}");
        var e1 = await EditorPostAsync(admin, Now.AddHours(-1));
        var e2 = await EditorPostAsync(admin, Now.AddHours(-2));

        var owner = await SharerAsync();
        var lookId = factory.Closet.AddLook(owner.TenantId, productId: bag);              // a white top of her own + a catalog bag
        var item = (await factory.Repository.GetAsync<ItemEntity>(ItemEntity.GetPk(owner.TenantId), ItemEntity.GetSk(ClosetSeeder.SharedItemId)))!;
        item.Subcategory = "shirt";
        await factory.Repository.SaveAsync(item);
        var look = (await factory.Repository.GetAsync<LookEntity>(LookEntity.GetPk(owner.TenantId), LookEntity.GetSk(lookId)))!;
        look.Name = "Hafta sonu";
        look.Occasion = Occasion.Weekend;
        await factory.Repository.SaveAsync(look);
        var hash = LookCoverRules.SlotsHash(look.Slots);
        var coverKey = StorageKeys.LookCover(owner.TenantId, lookId, hash);
        await factory.Repository.SaveAsync(new LookCoverEntity
        {
            TenantId = owner.TenantId, LookId = lookId, SlotsHash = hash, Status = LookCoverStatus.Ready, ImageKey = coverKey, ImageHash = hash, Attempts = 1, Version = 1,
        });
        var postId = await ShareAsync(owner, lookId);
        var viewer = await factory.UserAsync();
        var other = await factory.UserAsync();

        var post = (await FeedAsync(viewer.Client)).Single(p => Id(p) == postId);
        var author = post.GetProperty("author");
        var pieces = post.GetProperty("pieces").EnumerateArray().ToArray();
        var editorPost = (await FeedAsync(viewer.Client)).First(p => Id(p) == e1);

        Assert.Equal("user", post.GetProperty("kind").GetString());
        Assert.StartsWith("u_", postId);
        Assert.Equal(("user", "@" + owner.Handle, owner.Handle, false),
            (author.GetProperty("kind").GetString(), author.GetProperty("name").GetString(), author.GetProperty("handle").GetString(), author.GetProperty("verified").GetBoolean()));
        Assert.Equal(JsonValueKind.Null, author.GetProperty("imageUrl").ValueKind);      // no avatar uploaded
        Assert.Equal("weekend", post.GetProperty("occasion").GetString());
        Assert.Equal("Hafta sonu", post.GetProperty("title").GetString());
        Assert.Equal(JsonValueKind.Null, post.GetProperty("note").ValueKind);
        var image = Assert.Single(post.GetProperty("images").EnumerateArray()).GetString()!;
        Assert.Contains(coverKey, image);                                                 // the AI cover, presigned for the viewer
        Assert.Contains("X-Amz-Expires", image);
        Assert.True(post.GetProperty("imagesExpireAt").GetDateTime() > DateTime.UtcNow);
        Assert.Empty(post.GetProperty("products").EnumerateArray());
        Assert.Equal(0, post.GetProperty("buyableCount").GetInt32());
        Assert.False(post.GetProperty("canTryOn").GetBoolean());
        Assert.True(post.GetProperty("hasSimilar").GetBoolean());
        Assert.Equal((0, false, false), (post.GetProperty("likeCount").GetInt64(), post.GetProperty("liked").GetBoolean(), post.GetProperty("saved").GetBoolean()));
        // Pieces: kind + cleaned image only — never the original, no item id, no name.
        Assert.Equal(["top", "bag"], pieces.Select(p => p.GetProperty("category").GetString()!));
        Assert.Equal("shirt", pieces[0].GetProperty("subcategory").GetString());
        Assert.Equal(JsonValueKind.Null, pieces[1].GetProperty("subcategory").ValueKind);
        Assert.Contains("clean.webp", pieces[0].GetProperty("imageUrl").GetString());
        Assert.DoesNotContain("original", pieces[0].GetProperty("imageUrl").GetString());
        Assert.Equal("https://img.example/1.jpg", pieces[1].GetProperty("imageUrl").GetString());
        Assert.Equal(["category", "imageUrl", "subcategory"], pieces[0].EnumerateObject().Select(p => p.Name).Order());
        // Editor posts keep their shape, with the new fields at their defaults.
        Assert.Equal(("editor", true, false), (editorPost.GetProperty("kind").GetString(), editorPost.GetProperty("canTryOn").GetBoolean(), editorPost.GetProperty("hasSimilar").GetBoolean()));
        Assert.Empty(editorPost.GetProperty("pieces").EnumerateArray());

        // Similar products: same category + the piece's main colour; the look's own catalog piece first; no retired one.
        var similarResponse = await viewer.Client.GetAsync($"v1/tenant/feed-post/{postId}/similar");
        var similar = (await similarResponse.JsonAsync()).EnumerateArray().Select(p => p.GetProperty("id").GetString()!).ToArray();
        Assert.Equal(HttpStatusCode.OK, similarResponse.StatusCode);
        Assert.Equal(bag, similar[1]);                                                    // piece after piece: a top, then the look's own catalog bag
        Assert.Contains(whiteShirt, similar);
        Assert.Contains(whiteTee, similar);
        Assert.True(similar.Length <= 12);
        Assert.DoesNotContain(redShirt, similar);
        Assert.DoesNotContain(whiteSkirt, similar);
        Assert.DoesNotContain(retired, similar);
        Assert.Equal(HttpStatusCode.NotFound, (await viewer.Client.GetAsync($"v1/tenant/feed-post/{e1}/similar")).StatusCode);        // editor post
        Assert.Equal(HttpStatusCode.NotFound, (await owner.Client.GetAsync($"v1/tenant/feed-post/{postId}/similar")).StatusCode);    // own post is not in my feed

        // Like / save with the same endpoints and the same id.
        var liked = await (await viewer.Client.PutAsync($"v1/tenant/feed-post/{postId}/like", null)).JsonAsync();
        await viewer.Client.PutAsync($"v1/tenant/feed-post/{postId}/like", null);
        await other.Client.PutAsync($"v1/tenant/feed-post/{postId}/like", null);
        Assert.Equal(HttpStatusCode.NoContent, (await viewer.Client.PutAsync($"v1/tenant/feed-post/{postId}/save", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await viewer.Client.PutAsync($"v1/tenant/feed-post/{postId}/save", null)).StatusCode);
        await viewer.Client.PutAsync($"v1/tenant/feed-post/{e2}/save", null);
        var after = (await FeedAsync(viewer.Client)).Single(p => Id(p) == postId);
        var saved = (await (await viewer.Client.GetAsync("v1/tenant/feed-post/saved")).JsonAsync()).EnumerateArray().ToArray();
        var ownerLook = await (await owner.Client.GetAsync($"v1/tenant/look/{lookId}")).JsonAsync();

        Assert.Equal((true, 1L), (liked.GetProperty("liked").GetBoolean(), liked.GetProperty("likeCount").GetInt64()));
        Assert.Equal((2L, true, true), (after.GetProperty("likeCount").GetInt64(), after.GetProperty("liked").GetBoolean(), after.GetProperty("saved").GetBoolean()));
        Assert.Equal([e2, postId], saved.Select(Id));
        Assert.Equal("user", saved[1].GetProperty("kind").GetString());
        Assert.Equal((2L, 1L), (ownerLook.GetProperty("feedStats").GetProperty("likeCount").GetInt64(), ownerLook.GetProperty("feedStats").GetProperty("saveCount").GetInt64()));
        // The digest marker of the day: one per liker; an un-like of the same day takes it back.
        var day = WeeklyEditRules.Format(DateOnly.FromDateTime(DateTime.UtcNow));
        var markers = async () => (await factory.Repository.GetAllAsync<FeedLikeDigestEntity>(FeedLikeDigestEntity.GetPk(day))).Where(m => m.OwnerTenantId == owner.TenantId).Select(m => m.LikerTenantId).Order().ToArray();
        Assert.Equal(new[] { viewer.TenantId, other.TenantId }.Order(), await markers());

        var unliked = await (await other.Client.DeleteAsync($"v1/tenant/feed-post/{postId}/like")).JsonAsync();
        Assert.Equal(HttpStatusCode.NoContent, (await viewer.Client.DeleteAsync($"v1/tenant/feed-post/{postId}/save")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await viewer.Client.DeleteAsync($"v1/tenant/feed-post/{postId}/save")).StatusCode);
        ownerLook = await (await owner.Client.GetAsync($"v1/tenant/look/{lookId}")).JsonAsync();
        Assert.Equal((false, 1L), (unliked.GetProperty("liked").GetBoolean(), unliked.GetProperty("likeCount").GetInt64()));
        Assert.Equal((1L, 0L), (ownerLook.GetProperty("feedStats").GetProperty("likeCount").GetInt64(), ownerLook.GetProperty("feedStats").GetProperty("saveCount").GetInt64()));
        Assert.Equal([viewer.TenantId], await markers());

        // Nobody tries on somebody else's look: the feedPost try-on target does not resolve a user post.
        var lookup = factory.Services.GetRequiredService<IFeedPostLookup>();
        Assert.Null(await lookup.GetProductIdsAsync(postId, default));
        Assert.NotNull(await lookup.GetProductIdsAsync(e1, default));
    }

    [Fact]
    public async Task EditorPost_Products_CarryOwnedItemId_TheProductsOwnItemFirst_ElseTheNewestMatch()
    {
        await ClearAsync();
        var admin = await factory.AdminAsync();
        var brand = await factory.SeedBrandAsync(admin);
        var shirt = await factory.SeedProductAsync(admin, brand, category: ProductCategory.Shirt, colors: ["white"]);
        var skirt = await factory.SeedProductAsync(admin, brand, category: ProductCategory.Skirt, colors: ["camel"]);
        var coat = await factory.SeedProductAsync(admin, brand, category: ProductCategory.Coat, colors: ["black"]);
        await EditorPostAsync(admin, Now.AddMinutes(-1), productIds: [shirt, skirt, coat]);
        var (user, auth) = await factory.RegisterAsync();
        async Task Item(string id, ItemCategory category, string color, DateTime createdAt, string? productId = null) => await factory.Repository.SaveAsync(new ItemEntity
        {
            Id = id, TenantId = auth.TenantId, Name = id, Category = category, ColorIds = [color], ProductId = productId, CreatedAt = createdAt, UpdatedAt = createdAt, Version = 1,
        });
        await Item("white-top-old", ItemCategory.Top, "white", Now.AddDays(-9));
        await Item("white-top-new", ItemCategory.Top, "white", Now.AddDays(-1));
        await Item("red-top", ItemCategory.Top, "red", Now);
        await Item("the-skirt-itself", ItemCategory.Bottom, "navy", Now.AddDays(-30), productId: skirt);   // added from that product, another colour
        await Item("camel-skirt", ItemCategory.Bottom, "camel", Now);

        var products = (await FeedAsync(user)).Single().GetProperty("products").EnumerateArray().ToDictionary(p => p.GetProperty("id").GetString()!);

        Assert.Equal((true, "white-top-new"), (products[shirt].GetProperty("ownedSimilar").GetBoolean(), products[shirt].GetProperty("ownedItemId").GetString()));   // newest category + colour match
        Assert.Equal((true, "the-skirt-itself"), (products[skirt].GetProperty("ownedSimilar").GetBoolean(), products[skirt].GetProperty("ownedItemId").GetString()));   // the product's own item wins
        Assert.False(products[coat].GetProperty("ownedSimilar").GetBoolean());
        Assert.Equal(JsonValueKind.Null, products[coat].GetProperty("ownedItemId").ValueKind);
    }

    // ── Reports and moderation ──────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Report_OnePerUser_ThreeDistinctReportersHide_AdminRestores_ThenRemoves()
    {
        await ClearAsync();
        var admin = await factory.AdminAsync();
        await EditorPostAsync(admin, Now.AddHours(-1));
        await EditorPostAsync(admin, Now.AddHours(-2));
        var editor = await EditorPostAsync(admin, Now.AddHours(-3));
        var owner = await SharerAsync();
        var lookId = await LookAsync(owner.TenantId);
        var postId = await ShareAsync(owner, lookId);
        var reporters = new List<TestUser>();
        for (var i = 0; i < 6; i++)
            reporters.Add(await factory.UserAsync());
        var bystander = await factory.UserAsync();
        await bystander.Client.PutAsync($"v1/tenant/feed-post/{postId}/like", null);

        var first = await ReportAsync(reporters[0].Client, postId, "minorSafety", "  Uygunsuz  ");
        var firstId = (await first.JsonAsync()).GetProperty("reportId").GetString()!;
        var repeat = await ReportAsync(reporters[0].Client, postId, "spam");
        var own = await ReportAsync(owner.Client, postId);
        var editorPost = await ReportAsync(reporters[0].Client, editor);
        var unknown = await ReportAsync(reporters[0].Client, FeedRules.UserPostId("nobody", "nothing"));
        var invalid = await reporters[0].Client.PostJsonAsync($"v1/tenant/feed-post/{postId}/report", new { reason = "boring", note = new string('x', 501) });
        var second = await ReportAsync(reporters[1].Client, postId, "spam");

        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        Assert.Equal((HttpStatusCode.OK, firstId), (repeat.StatusCode, (await repeat.JsonAsync()).GetProperty("reportId").GetString()));   // one per user per post
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "cannot_target_self"), (own.StatusCode, await own.CodeAsync()));
        Assert.Equal(HttpStatusCode.NotFound, editorPost.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        Assert.Equal(HttpStatusCode.Created, second.StatusCode);
        // Two reporters: still in the feed for everybody else, gone for the ones who reported it.
        Assert.Contains(postId, (await FeedAsync(bystander.Client)).Select(Id));
        Assert.DoesNotContain(postId, (await FeedAsync(reporters[0].Client)).Select(Id));
        var listed = (await (await admin.GetAsync("v1/admin/feed-user-post")).JsonAsync()).EnumerateArray().Single();
        Assert.Equal((postId, "reported", 2), (listed.GetProperty("id").GetString(), listed.GetProperty("status").GetString(), listed.GetProperty("reporterCount").GetInt32()));

        // The third distinct reporter takes it off the feed, automatically.
        Assert.Equal(HttpStatusCode.Created, (await ReportAsync(reporters[2].Client, postId, "spam")).StatusCode);
        Assert.DoesNotContain(postId, (await FeedAsync(bystander.Client)).Select(Id));
        Assert.Equal(HttpStatusCode.NotFound, (await bystander.Client.PutAsync($"v1/tenant/feed-post/{postId}/like", null)).StatusCode);
        listed = (await (await admin.GetAsync("v1/admin/feed-user-post")).JsonAsync()).EnumerateArray().Single();
        Assert.Equal(("autoHidden", 3, owner.Handle, lookId), (listed.GetProperty("status").GetString(), listed.GetProperty("reporterCount").GetInt32(),
            listed.GetProperty("ownerHandle").GetString(), listed.GetProperty("lookId").GetString()));
        Assert.Equal([("spam", 2), ("minorSafety", 1)], listed.GetProperty("reasons").EnumerateArray().Select(r => (r.GetProperty("reason").GetString()!, r.GetProperty("count").GetInt32())));
        Assert.Equal("Uygunsuz", listed.GetProperty("reports").EnumerateArray().Single(r => r.GetProperty("id").GetString() == firstId).GetProperty("note").GetString());
        Assert.Contains("look-cover", listed.GetProperty("imageUrl").GetString());
        Assert.Equal(1, listed.GetProperty("likeCount").GetInt64());
        // The owner still sees her look as shared; nothing was removed from her.
        Assert.True((await (await owner.Client.GetAsync($"v1/tenant/look/{lookId}")).JsonAsync()).GetProperty("sharedToFeed").GetBoolean());

        // Permission: moderation.manage (a content editor is refused); a user is not an admin.
        var contentEditor = await factory.AdminAsync(AdminRole.ContentEditor);
        Assert.Equal(HttpStatusCode.Forbidden, (await contentEditor.GetAsync("v1/admin/feed-user-post")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await contentEditor.PostAsync($"v1/admin/feed-user-post/{postId}/restore", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await bystander.Client.GetAsync("v1/admin/feed-user-post")).StatusCode);

        // Restore (a moderator): back in the feed, the reports dismissed, the count starts again.
        var moderator = await factory.AdminAsync(AdminRole.Moderator);
        Assert.Equal(HttpStatusCode.NoContent, (await moderator.PostJsonAsync($"v1/admin/feed-user-post/{postId}/restore", new { note = "Kurallara uygun" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await moderator.PostAsync($"v1/admin/feed-user-post/{FeedRules.UserPostId("a", "b")}/restore", null)).StatusCode);
        Assert.Contains(postId, (await FeedAsync(bystander.Client)).Select(Id));
        Assert.Empty((await (await admin.GetAsync("v1/admin/feed-user-post")).JsonAsync()).EnumerateArray());
        var resolved = await (await admin.GetAsync("v1/admin/moderation/report?status=resolved")).JsonAsync();
        var dismissed = resolved.GetProperty("items").EnumerateArray().Where(r => r.GetProperty("targetId").GetString() == lookId).ToArray();
        Assert.Equal(3, dismissed.Length);
        Assert.All(dismissed, r => Assert.Equal("dismissed", r.GetProperty("resolution").GetString()));
        Assert.Equal(HttpStatusCode.Conflict, (await moderator.PostAsync($"v1/admin/feed-user-post/{postId}/remove", null)).StatusCode);   // nothing open to remove it by
        Assert.Equal(HttpStatusCode.Created, (await ReportAsync(reporters[3].Client, postId)).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await ReportAsync(reporters[4].Client, postId)).StatusCode);
        Assert.Contains(postId, (await FeedAsync(bystander.Client)).Select(Id));          // two new reporters: not yet
        Assert.Equal(HttpStatusCode.Created, (await ReportAsync(reporters[5].Client, postId)).StatusCode);
        Assert.DoesNotContain(postId, (await FeedAsync(bystander.Client)).Select(Id));    // three new ones: hidden again

        // Remove = the existing look moderation: the owner keeps the look with moderation { hidden } and gets the inbox row.
        var remove = await moderator.PostJsonAsync($"v1/admin/feed-user-post/{postId}/remove", new { note = "Topluluk kuralları" });
        var removalReport = (await remove.JsonAsync()).GetProperty("reportId").GetString()!;
        var ownerLook = await (await owner.Client.GetAsync($"v1/tenant/look/{lookId}")).JsonAsync();
        var inbox = await (await owner.Client.GetAsync("v1/tenant/notification")).JsonAsync();

        Assert.Equal(HttpStatusCode.OK, remove.StatusCode);
        Assert.True(ownerLook.GetProperty("moderation").GetProperty("hidden").GetBoolean());
        Assert.Contains("content_removed", inbox.GetRawText());
        Assert.DoesNotContain(postId, (await FeedAsync(bystander.Client)).Select(Id));
        Assert.Empty((await (await admin.GetAsync("v1/admin/feed-user-post")).JsonAsync()).EnumerateArray());
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await owner.Client.PutAsync($"v1/tenant/look/{await RemovedCopyAsync(owner, lookId)}/feed-share", null)).StatusCode);
        var audit = await (await admin.GetAsync("v1/admin/audit")).JsonAsync();
        Assert.Contains("feed_user_post.restore", audit.GetRawText());
        Assert.Contains("feed_user_post.remove", audit.GetRawText());

        // The report's own restore (existing moderation undo) brings the look back to the feed.
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsync($"v1/admin/moderation/report/{removalReport}/restore", null)).StatusCode);
        Assert.Contains(postId, (await FeedAsync(bystander.Client)).Select(Id));
    }

    /// <summary>A second look of the owner, flagged like a removed one: sharing it is refused (look_not_shareable).</summary>
    private async Task<string> RemovedCopyAsync(TestUser owner, string removedLookId)
    {
        var removed = (await factory.Repository.GetAsync<LookEntity>(LookEntity.GetPk(owner.TenantId), LookEntity.GetSk(removedLookId)))!;
        var id = factory.Closet.AddLook(owner.TenantId);
        var copy = (await factory.Repository.GetAsync<LookEntity>(LookEntity.GetPk(owner.TenantId), LookEntity.GetSk(id)))!;
        copy.ModerationHiddenAt = removed.ModerationHiddenAt;
        copy.ModerationReportId = removed.ModerationReportId;
        copy.ModerationReason = removed.ModerationReason;
        await factory.Repository.SaveAsync(copy);
        return id;
    }

    [Fact]
    public async Task Report_UnshareDoesNotEscapeOpenReports_ReshareIsBornHidden()
    {
        await ClearAsync();
        var owner = await SharerAsync();
        var lookId = await LookAsync(owner.TenantId);
        var postId = await ShareAsync(owner, lookId);
        for (var i = 0; i < 3; i++)
            Assert.Equal(HttpStatusCode.Created, (await ReportAsync((await factory.UserAsync()).Client, postId)).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await owner.Client.DeleteAsync($"v1/tenant/look/{lookId}/feed-share")).StatusCode);
        Assert.Equal(postId, await ShareAsync(owner, lookId));                            // the id is stable for owner + look

        var post = (await factory.Repository.GetAsync<FeedUserPostEntity>(FeedUserPostEntity.GetPk(), FeedUserPostEntity.GetSk(postId)))!;
        Assert.NotNull(post.HiddenAt);
        Assert.Equal(3, post.ReportCount);
    }

    // ── Deletion ────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Unshare_LookDeletion_AccountDeletion_RemoveThePostAndWhatOthersLeftOnIt()
    {
        await ClearAsync();
        var admin = await factory.AdminAsync();
        await EditorPostAsync(admin, Now.AddHours(-1));
        await EditorPostAsync(admin, Now.AddHours(-2));
        var owner = await SharerAsync();
        var looks = new[] { await LookAsync(owner.TenantId), await LookAsync(owner.TenantId), await LookAsync(owner.TenantId) };
        var posts = new List<string>();
        foreach (var look in looks)
            posts.Add(await ShareAsync(owner, look));
        var fan = await factory.UserAsync();
        var hider = await factory.UserAsync();
        var leaving = await factory.UserAsync();
        foreach (var post in posts)
        {
            await fan.Client.PutAsync($"v1/tenant/feed-post/{post}/like", null);
            await fan.Client.PutAsync($"v1/tenant/feed-post/{post}/save", null);
            await leaving.Client.PutAsync($"v1/tenant/feed-post/{post}/like", null);
            await leaving.Client.PutAsync($"v1/tenant/feed-post/{post}/save", null);
            await hider.Client.PutAsync($"v1/tenant/feed-post/{post}/hide", null);
            (await ReportAsync(hider.Client, post)).EnsureSuccessStatusCode();
        }
        async Task<int> RowsAsync(string tenantId) =>
            (await factory.Repository.GetKeysAsync(FeedLikeEntity.GetPk(tenantId))).Count + (await factory.Repository.GetKeysAsync(FeedSaveEntity.GetPk(tenantId))).Count
            + (await factory.Repository.GetKeysAsync(FeedHideEntity.GetPk(tenantId))).Count + (await factory.Repository.GetKeysAsync(FeedReportEntity.GetPk(tenantId))).Count;
        async Task AssertGoneAsync(string postId)
        {
            Assert.Null(await factory.Repository.GetAsync<FeedUserPostEntity>(FeedUserPostEntity.GetPk(), FeedUserPostEntity.GetSk(postId)));
            Assert.Null(await factory.Repository.GetAsync<FeedPostStatsEntity>(FeedPostStatsEntity.GetPk(), FeedPostStatsEntity.GetSk(postId)));
            Assert.Empty(await factory.Repository.GetKeysAsync(FeedPostReactionEntity.GetPk(postId)));
        }
        Assert.Equal((6, 6), (await RowsAsync(fan.TenantId), await RowsAsync(hider.TenantId)));

        // A liker leaves: her likes and saves come off the counters, the posts stay.
        Assert.Equal(HttpStatusCode.NoContent, (await leaving.Client.DeleteAsync("v1/auth/me")).StatusCode);
        var stats = (await (await owner.Client.GetAsync($"v1/tenant/look/{looks[0]}")).JsonAsync()).GetProperty("feedStats");
        Assert.Equal((1L, 1L), (stats.GetProperty("likeCount").GetInt64(), stats.GetProperty("saveCount").GetInt64()));
        Assert.DoesNotContain(await factory.Repository.GetKeysAsync(FeedPostReactionEntity.GetPk(posts[0])), k => k.Sk.EndsWith(leaving.TenantId, StringComparison.Ordinal));

        // Un-share.
        Assert.Equal(HttpStatusCode.NoContent, (await owner.Client.DeleteAsync($"v1/tenant/look/{looks[0]}/feed-share")).StatusCode);
        await AssertGoneAsync(posts[0]);
        Assert.Equal((4, 4), (await RowsAsync(fan.TenantId), await RowsAsync(hider.TenantId)));
        Assert.DoesNotContain(posts[0], (await (await fan.Client.GetAsync("v1/tenant/feed-post/saved")).JsonAsync()).EnumerateArray().Select(Id));
        Assert.Equal(HttpStatusCode.NotFound, (await fan.Client.PutAsync($"v1/tenant/feed-post/{posts[0]}/like", null)).StatusCode);

        // Look deletion.
        Assert.Equal(HttpStatusCode.NoContent, (await owner.Client.DeleteAsync($"v1/tenant/look/{looks[1]}")).StatusCode);
        await AssertGoneAsync(posts[1]);
        Assert.DoesNotContain(await factory.Repository.GetKeysAsync(FeedShareEntity.GetPk(owner.TenantId)), k => k.Sk == looks[1]);
        Assert.Equal((2, 2), (await RowsAsync(fan.TenantId), await RowsAsync(hider.TenantId)));

        // Account deletion of the owner.
        Assert.Equal(HttpStatusCode.NoContent, (await owner.Client.DeleteAsync("v1/auth/me")).StatusCode);
        await AssertGoneAsync(posts[2]);
        Assert.Equal((0, 0), (await RowsAsync(fan.TenantId), await RowsAsync(hider.TenantId)));
        Assert.Empty(await factory.Repository.GetKeysAsync(FeedShareEntity.GetPk(owner.TenantId)));
        Assert.Empty(await factory.Repository.GetKeysAsync(FeedUserPostEntity.GetPk()));
        var day = WeeklyEditRules.Format(DateOnly.FromDateTime(DateTime.UtcNow));
        Assert.DoesNotContain(await factory.Repository.GetKeysAsync(FeedLikeDigestEntity.GetPk(day)), k => k.Sk.StartsWith(owner.TenantId, StringComparison.Ordinal));
        Assert.All((await FeedAsync(fan.Client)).Select(Kind), kind => Assert.Equal("editor", kind));
    }

    // ── Weekly-edit fallback ────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Feed_WithoutLiveEditorPosts_FallsBackToTheCurrentWeeklyEdit_LikeSaveTryOnWork_UserLooksMixIn()
    {
        await ClearAsync();
        var admin = await factory.AdminAsync();
        var brand = await factory.SeedBrandAsync(admin);
        var cheap = await factory.SeedProductAsync(admin, brand, category: ProductCategory.Shirt, colors: ["white"]);
        var luxury = await factory.SeedProductAsync(admin, brand, category: ProductCategory.Coat, colors: ["camel"], priceBand: PriceBand.LuxuryTouch);
        var monday = WeeklyEditRules.WeekStartOf(DateOnly.FromDateTime(DateTime.UtcNow));
        WeeklyEditEntity Edit(string id, Segment segment, DateOnly weekStart, bool published = true) => new()
        {
            Id = id, Segment = segment, WeekStart = WeeklyEditRules.Format(weekStart), Title = new() { ["tr"] = "Sonbahar" }, Published = published,
            CreatedAt = Now, UpdatedAt = Now,
            Looks = Enumerable.Range(1, 3).Select(day => new EditLook
            {
                Id = $"{id}-look-{day}", Day = day, Title = new() { ["tr"] = $"Gün {day}", ["en"] = $"Day {day}" }, StyleNote = new() { ["tr"] = "Katmanlı giyin." },
                ImageUrl = day == 3 ? null : $"https://img.example/{id}-{day}.jpg",        // a look without an image is left out
                Variants =
                [
                    new EditLookVariant { PriceBand = PriceBand.LuxuryTouch, ProductIds = [luxury] },
                    new EditLookVariant { PriceBand = PriceBand.HighStreet, ProductIds = [cheap] },
                ],
            }).ToList(),
        };
        await factory.Repository.SaveAsync(Edit("edit-now", Segment.Women, monday));
        await factory.Repository.SaveAsync(Edit("edit-old", Segment.Women, monday.AddDays(-7)));
        await factory.Repository.SaveAsync(Edit("edit-men", Segment.Men, monday));
        await factory.Repository.SaveAsync(Edit("edit-draft", Segment.Women, monday.AddDays(7), published: false));
        var viewer = await factory.UserAsync();
        var sharer = await SharerAsync();
        var userPost = await SharedLookAsync(sharer);

        var feed = await FeedAsync(viewer.Client);
        var first = feed[0];

        Assert.Equal(["e_edit-now-look-1", "e_edit-now-look-2", userPost], feed.Select(Id));   // Monday first; user looks mix in as with editor posts
        Assert.Equal(("editor", "edit", "Droblet Edit", true), (first.GetProperty("kind").GetString(), first.GetProperty("author").GetProperty("kind").GetString(),
            first.GetProperty("author").GetProperty("name").GetString(), first.GetProperty("author").GetProperty("verified").GetBoolean()));
        Assert.Equal("Gün 1", first.GetProperty("title").GetString());
        Assert.Equal("Katmanlı giyin.", first.GetProperty("note").GetString());
        Assert.Equal(["https://img.example/edit-now-1.jpg"], first.GetProperty("images").EnumerateArray().Select(i => i.GetString()!));
        Assert.Equal([cheap], first.GetProperty("products").EnumerateArray().Select(p => p.GetProperty("id").GetString()!));   // the first variant by price band
        Assert.Equal(JsonValueKind.Null, first.GetProperty("occasion").ValueKind);
        Assert.True(first.GetProperty("canTryOn").GetBoolean());
        Assert.Empty(await FeedAsync(viewer.Client, "?occasion=office"));                  // edit looks carry no occasion

        // Like, save and try-on work with the prefixed id.
        var liked = await (await viewer.Client.PutAsync("v1/tenant/feed-post/e_edit-now-look-1/like", null)).JsonAsync();
        Assert.Equal(HttpStatusCode.NoContent, (await viewer.Client.PutAsync("v1/tenant/feed-post/e_edit-now-look-2/save", null)).StatusCode);
        Assert.Equal((true, 1L), (liked.GetProperty("liked").GetBoolean(), liked.GetProperty("likeCount").GetInt64()));
        Assert.Equal(["e_edit-now-look-2"], (await (await viewer.Client.GetAsync("v1/tenant/feed-post/saved")).JsonAsync()).EnumerateArray().Select(Id));
        Assert.True((await FeedAsync(viewer.Client))[0].GetProperty("liked").GetBoolean());
        Assert.Equal(HttpStatusCode.NotFound, (await viewer.Client.PutAsync("v1/tenant/feed-post/e_edit-draft-look-1/like", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await viewer.Client.PutAsync("v1/tenant/feed-post/e_edit-now-look-3/like", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await viewer.Client.PutAsync("v1/tenant/feed-post/e_nope/save", null)).StatusCode);
        var lookup = factory.Services.GetRequiredService<IFeedPostLookup>();
        Assert.Equal([cheap], await lookup.GetProductIdsAsync("e_edit-now-look-1", default));
        Assert.Null(await lookup.GetProductIdsAsync("e_edit-draft-look-1", default));

        // The first live editor post ends the fallback.
        var real = await EditorPostAsync(admin, Now.AddMinutes(-1));
        Assert.Equal([real], (await FeedAsync(viewer.Client)).Select(Id));
    }

    // ── Notification preference ─────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task FeedLikesDigest_IsOnByDefault_CanBeSwitchedOff_OlderClientsKeepIt()
    {
        var (user, _) = await factory.RegisterAsync();
        object Body(long baseVersion, bool? feedLikesDigest = null) => feedLikesDigest is null
            ? new { morningOutfit = true, morningOutfitLocalTime = "07:30", weeklyEdit = false, friendRatings = false, timeZone = "Europe/Istanbul", baseVersion }
            : new { morningOutfit = true, morningOutfitLocalTime = "07:30", weeklyEdit = false, friendRatings = false, timeZone = "Europe/Istanbul", baseVersion, feedLikesDigest };

        var initial = await (await user.GetAsync("v1/tenant/user/me/notifications")).JsonAsync();
        var untouched = await (await user.PutJsonAsync("v1/tenant/user/me/notifications", Body(initial.GetProperty("version").GetInt64()))).JsonAsync();
        var off = await (await user.PutJsonAsync("v1/tenant/user/me/notifications", Body(untouched.GetProperty("version").GetInt64(), false))).JsonAsync();
        var kept = await (await user.PutJsonAsync("v1/tenant/user/me/notifications", Body(off.GetProperty("version").GetInt64()))).JsonAsync();
        var on = await (await user.PutJsonAsync("v1/tenant/user/me/notifications", Body(kept.GetProperty("version").GetInt64(), true))).JsonAsync();

        Assert.True(initial.GetProperty("feedLikesDigest").GetBoolean());
        Assert.True(untouched.GetProperty("feedLikesDigest").GetBoolean());
        Assert.False(off.GetProperty("feedLikesDigest").GetBoolean());
        Assert.False(kept.GetProperty("feedLikesDigest").GetBoolean());                    // omitted = keeps the stored value
        Assert.True((await (await user.GetAsync("v1/tenant/user/me/notifications")).JsonAsync()).GetProperty("feedLikesDigest").GetBoolean());
        Assert.True(on.GetProperty("feedLikesDigest").GetBoolean());
    }
}
