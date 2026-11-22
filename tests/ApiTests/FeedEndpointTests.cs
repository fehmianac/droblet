using System.Net;
using System.Text.Json;
using Domain.Entity;
using Domain.Enum;
using Domain.Extensions;

namespace ApiTests;

/// <summary>Akış F1: editor posts / stories (admin CRUD), the feed and story reads, likes, saves, account deletion.</summary>
public class FeedEndpointTests(StoreSocialApiFactory factory) : IClassFixture<StoreSocialApiFactory>
{
    private static readonly DateTime Now = DateTime.UtcNow;

    /// <summary>Posts and stories are global: each test starts from empty partitions.</summary>
    private async Task ClearAsync()
    {
        foreach (var pk in new[] { FeedPostEntity.GetPk(), FeedStoryEntity.GetPk(), FeedPostStatsEntity.GetPk() })
            await factory.Repository.BatchDeleteKeysAsync(await factory.Repository.GetKeysAsync(pk));
    }

    private static object Post(DateTime publishAt, string occasion = "office", string? segment = null, bool published = true, bool retired = false,
        string[]? productIds = null, int sortOrder = 0, string title = "Ofiste lacivert", object? author = null, string[]? images = null) => new
    {
        segment,
        author = author ?? new { kind = "edit", name = StoreSocialApiFactory.Text("Droblet Edit", "Droblet Edit") },
        occasion,
        title = StoreSocialApiFactory.Text(title, "Navy at the office"),
        note = StoreSocialApiFactory.Text("Not", "Note"),
        imageUrls = images ?? ["https://img.example/feed-1.jpg"],
        productIds = productIds ?? [],
        publishAt,
        sortOrder,
        published,
        retired,
    };

    private async Task<string> PutPostAsync(HttpClient admin, object body, string? id = null)
    {
        id ??= Ulid.New();
        var response = await admin.PutJsonAsync($"v1/admin/feed-post/{id}", body);
        Assert.True(response.IsSuccessStatusCode, $"{response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        return id;
    }

    private static async Task<string[]> IdsAsync(HttpClient client, string url) =>
        (await (await client.GetAsync(url)).JsonAsync()).GetProperty("items").EnumerateArray().Select(i => i.GetProperty("id").GetString()!).ToArray();

    private async Task SetSegmentAsync(string tenantId, Segment segment)
    {
        var tenant = (await factory.Repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(tenantId)))!;
        tenant.Segment = segment;
        await factory.Repository.SaveAsync(tenant);
    }

    [Fact]
    public async Task Feed_ShowsOnlyLivePostsOfTheUsersSegment_FiltersByOccasion_NewestFirst()
    {
        await ClearAsync();
        var admin = await factory.AdminAsync();
        var all = await PutPostAsync(admin, Post(Now.AddHours(-1)));
        var women = await PutPostAsync(admin, Post(Now.AddHours(-2), "weekend", segment: "women"));
        var men = await PutPostAsync(admin, Post(Now.AddHours(-3), segment: "men"));
        var dinner = await PutPostAsync(admin, Post(Now.AddHours(-4), "dinner"));
        await PutPostAsync(admin, Post(Now.AddHours(-1), published: false));            // draft
        await PutPostAsync(admin, Post(Now.AddHours(2)));                               // scheduled
        await PutPostAsync(admin, Post(Now.AddHours(-1), retired: true));               // retired
        var later = await PutPostAsync(admin, Post(Now.AddHours(-5)));
        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"v1/admin/feed-post/{later}")).StatusCode);   // retired through DELETE
        var (woman, _) = await factory.RegisterAsync();
        var man = await factory.RegisterAsync();
        await SetSegmentAsync(man.Auth.TenantId, Segment.Men);

        Assert.Equal([all, women, dinner], await IdsAsync(woman, "v1/content/feed"));
        Assert.Equal([all, men, dinner], await IdsAsync(man.Client, "v1/content/feed"));
        Assert.Equal([all], await IdsAsync(woman, "v1/content/feed?occasion=office"));
        Assert.Equal([women], await IdsAsync(woman, "v1/content/feed?occasion=weekend"));
        Assert.Equal([dinner], await IdsAsync(woman, "v1/content/feed?occasion=dinner"));   // the app's "Davet" tab
        Assert.Equal(HttpStatusCode.BadRequest, (await woman.GetAsync("v1/content/feed?occasion=party")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().GetAsync("v1/content/feed")).StatusCode);
    }

    [Fact]
    public async Task Feed_PagesOfTen_SameTimeOrderedBySortOrder_CursorSurvivesARetiredPost()
    {
        await ClearAsync();
        var admin = await factory.AdminAsync();
        var ids = new List<string>();
        for (var i = 0; i < 12; i++)
            ids.Add(await PutPostAsync(admin, Post(Now.AddMinutes(-10 - i))));
        var pinnedSecond = await PutPostAsync(admin, Post(Now.AddMinutes(-5), sortOrder: 2));
        var pinnedFirst = await PutPostAsync(admin, Post(Now.AddMinutes(-5), sortOrder: 1));
        var (user, _) = await factory.RegisterAsync();

        var first = await (await user.GetAsync("v1/content/feed")).JsonAsync();
        var firstIds = first.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("id").GetString()!).ToArray();
        var token = first.GetProperty("pageToken").GetString()!;
        await admin.DeleteAsync($"v1/admin/feed-post/{firstIds[^1]}");               // the cursor's own post goes away
        var second = await (await user.GetAsync($"v1/content/feed?pageToken={token}")).JsonAsync();

        Assert.Equal(10, firstIds.Length);
        Assert.Equal([pinnedFirst, pinnedSecond], firstIds[..2]);
        Assert.Equal(ids.Take(8), firstIds[2..]);
        Assert.Equal(ids.Skip(8), second.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("id").GetString()!));
        Assert.Equal(JsonValueKind.Null, second.GetProperty("pageToken").ValueKind);
    }

    [Fact]
    public async Task Post_Shape_LocalizedText_OwnedSimilar_BuyableCount()
    {
        await ClearAsync();
        var admin = await factory.AdminAsync();
        var brand = await factory.SeedBrandAsync(admin);
        var shirt = await factory.SeedProductAsync(admin, brand, category: ProductCategory.Shirt, colors: ["white"]);
        var skirt = await factory.SeedProductAsync(admin, brand, category: ProductCategory.Skirt, colors: ["camel"]);
        var bag = await factory.SeedProductAsync(admin, brand, category: ProductCategory.Bag, colors: ["black"]);
        await admin.DeleteAsync($"v1/admin/product/{bag}");                                 // retired → listed, not buyable
        var id = await PutPostAsync(admin, Post(Now.AddMinutes(-1), productIds: [shirt, skirt, bag],
            author: new { kind = "stylist", name = StoreSocialApiFactory.Text("Stilist 1", "Stylist 1"), handle = "Stilist1" }));
        var (user, auth) = await factory.RegisterAsync();
        factory.Closet.AddItem(auth.TenantId, "white-top", ItemCategory.Top, "white");      // similar to the shirt

        var post = (await (await user.GetAsync("v1/content/feed")).JsonAsync()).GetProperty("items")[0];
        var products = post.GetProperty("products").EnumerateArray().ToDictionary(p => p.GetProperty("id").GetString()!);

        Assert.Equal(id, post.GetProperty("id").GetString());
        Assert.Equal("stylist", post.GetProperty("author").GetProperty("kind").GetString());
        Assert.Equal("Stilist 1", post.GetProperty("author").GetProperty("name").GetString());
        Assert.Equal("stilist1", post.GetProperty("author").GetProperty("handle").GetString());
        Assert.False(post.GetProperty("author").GetProperty("verified").GetBoolean());   // only Droblet Edit is verified
        Assert.Equal("office", post.GetProperty("occasion").GetString());
        Assert.Equal("Ofiste lacivert", post.GetProperty("title").GetString());
        Assert.Equal("Not", post.GetProperty("note").GetString());
        Assert.Equal(["https://img.example/feed-1.jpg"], post.GetProperty("images").EnumerateArray().Select(i => i.GetString()!));
        Assert.True(post.TryGetProperty("publishedAt", out _));
        Assert.True(products[shirt].GetProperty("ownedSimilar").GetBoolean());
        Assert.False(products[skirt].GetProperty("ownedSimilar").GetBoolean());
        Assert.False(products[bag].GetProperty("available").GetBoolean());
        Assert.Equal("Marka " + brand[^4..], products[skirt].GetProperty("brandName").GetString());    // the ProductDto fields are all there
        Assert.Equal(1, post.GetProperty("buyableCount").GetInt32());                     // only the skirt
        Assert.Equal((0, false, false), (post.GetProperty("likeCount").GetInt64(), post.GetProperty("liked").GetBoolean(), post.GetProperty("saved").GetBoolean()));
        (await user.PutJsonAsync("v1/tenant/profile", new { displayName = "Ayşe", language = "en", baseVersion = 1 })).EnsureSuccessStatusCode();
        var inEnglish = (await (await user.GetAsync("v1/content/feed")).JsonAsync()).GetProperty("items")[0];
        Assert.Equal("Navy at the office", inEnglish.GetProperty("title").GetString());
        Assert.Equal("Stylist 1", inEnglish.GetProperty("author").GetProperty("name").GetString());
    }

    [Fact]
    public async Task Like_IsIdempotent_CountsEveryUserOnce_EvenConcurrently_UnknownOrDraft404()
    {
        await ClearAsync();
        var admin = await factory.AdminAsync();
        var id = await PutPostAsync(admin, Post(Now.AddMinutes(-1)));
        var draft = await PutPostAsync(admin, Post(Now.AddMinutes(-1), published: false));
        var (user, _) = await factory.RegisterAsync();

        var once = await (await user.PutAsync($"v1/tenant/feed-post/{id}/like", null)).JsonAsync();
        var twice = await (await user.PutAsync($"v1/tenant/feed-post/{id}/like", null)).JsonAsync();
        var others = await Task.WhenAll(Enumerable.Range(0, 6).Select(async _ => (await factory.RegisterAsync()).Client));
        var concurrent = await Task.WhenAll(others.Select(c => c.PutAsync($"v1/tenant/feed-post/{id}/like", null)));
        var feed = (await (await user.GetAsync("v1/content/feed")).JsonAsync()).GetProperty("items")[0];
        var unliked = await (await user.DeleteAsync($"v1/tenant/feed-post/{id}/like")).JsonAsync();
        var unlikedAgain = await (await user.DeleteAsync($"v1/tenant/feed-post/{id}/like")).JsonAsync();
        var adminList = await (await admin.GetAsync("v1/admin/feed-post")).JsonAsync();

        Assert.Equal((true, 1L), (once.GetProperty("liked").GetBoolean(), once.GetProperty("likeCount").GetInt64()));
        Assert.Equal((true, 1L), (twice.GetProperty("liked").GetBoolean(), twice.GetProperty("likeCount").GetInt64()));
        Assert.All(concurrent, r => Assert.Equal(HttpStatusCode.OK, r.StatusCode));
        Assert.Equal((7L, true), (feed.GetProperty("likeCount").GetInt64(), feed.GetProperty("liked").GetBoolean()));
        Assert.Equal((false, 6L), (unliked.GetProperty("liked").GetBoolean(), unliked.GetProperty("likeCount").GetInt64()));
        Assert.Equal(6L, unlikedAgain.GetProperty("likeCount").GetInt64());
        Assert.Equal(6L, adminList.EnumerateArray().Single(p => p.GetProperty("id").GetString() == id).GetProperty("likeCount").GetInt64());
        Assert.Equal(HttpStatusCode.NotFound, (await user.PutAsync($"v1/tenant/feed-post/{draft}/like", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await user.PutAsync($"v1/tenant/feed-post/{Ulid.New()}/like", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await user.DeleteAsync("v1/tenant/feed-post/nope/like")).StatusCode);
    }

    [Fact]
    public async Task Save_IsIdempotent_SavedListNewestFirst_SkipsRetired()
    {
        await ClearAsync();
        var admin = await factory.AdminAsync();
        var a = await PutPostAsync(admin, Post(Now.AddHours(-2)));
        var b = await PutPostAsync(admin, Post(Now.AddHours(-1)));
        var c = await PutPostAsync(admin, Post(Now.AddHours(-3)));
        var draft = await PutPostAsync(admin, Post(Now.AddHours(-1), published: false));
        var (user, _) = await factory.RegisterAsync();

        Assert.Equal(HttpStatusCode.NoContent, (await user.PutAsync($"v1/tenant/feed-post/{a}/save", null)).StatusCode);
        await Task.Delay(5);
        Assert.Equal(HttpStatusCode.NoContent, (await user.PutAsync($"v1/tenant/feed-post/{b}/save", null)).StatusCode);
        await Task.Delay(5);
        Assert.Equal(HttpStatusCode.NoContent, (await user.PutAsync($"v1/tenant/feed-post/{c}/save", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await user.PutAsync($"v1/tenant/feed-post/{a}/save", null)).StatusCode);   // again: keeps its place
        var saved = (await (await user.GetAsync("v1/tenant/feed-post/saved")).JsonAsync()).EnumerateArray().ToArray();
        var flags = (await (await user.GetAsync("v1/content/feed")).JsonAsync()).GetProperty("items").EnumerateArray()
            .ToDictionary(p => p.GetProperty("id").GetString()!, p => p.GetProperty("saved").GetBoolean());
        await admin.DeleteAsync($"v1/admin/feed-post/{b}");
        Assert.Equal(HttpStatusCode.NoContent, (await user.DeleteAsync($"v1/tenant/feed-post/{c}/save")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await user.DeleteAsync($"v1/tenant/feed-post/{c}/save")).StatusCode);   // idempotent
        var after = (await (await user.GetAsync("v1/tenant/feed-post/saved")).JsonAsync()).EnumerateArray().Select(p => p.GetProperty("id").GetString()!).ToArray();

        Assert.Equal([c, b, a], saved.Select(p => p.GetProperty("id").GetString()!));
        Assert.All(saved, p => Assert.True(p.GetProperty("saved").GetBoolean()));
        Assert.True(flags[a] && flags[b] && flags[c]);
        Assert.Equal([a], after);
        Assert.Equal(HttpStatusCode.NotFound, (await user.PutAsync($"v1/tenant/feed-post/{draft}/save", null)).StatusCode);
    }

    [Fact]
    public async Task Stories_ActiveWindow_Segment_Product_Order()
    {
        await ClearAsync();
        var admin = await factory.AdminAsync();
        var brand = await factory.SeedBrandAsync(admin);
        var coat = await factory.SeedProductAsync(admin, brand, category: ProductCategory.Coat, colors: ["camel"]);
        object Story(DateTime publishAt, DateTime? expiresAt = null, string? segment = null, bool published = true, int sortOrder = 0, string? productId = null) => new
        {
            segment, author = new { name = StoreSocialApiFactory.Text("Droblet Edit") }, imageUrl = "https://img.example/story.jpg",
            headline = StoreSocialApiFactory.Text("Bu hafta camel", "Camel this week"), productId, publishAt, expiresAt, sortOrder, published,
        };
        async Task<string> Put(object body)
        {
            var id = Ulid.New();
            var response = await admin.PutJsonAsync($"v1/admin/feed-story/{id}", body);
            Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
            return id;
        }
        var second = await Put(Story(Now.AddHours(-1), Now.AddDays(1), sortOrder: 1));
        var first = await Put(Story(Now.AddHours(-2), productId: coat));
        await Put(Story(Now.AddDays(-3), Now.AddDays(-1)));                 // expired
        await Put(Story(Now.AddHours(1)));                                  // not yet
        await Put(Story(Now.AddHours(-1), published: false));               // draft
        await Put(Story(Now.AddHours(-1), segment: "men"));                 // other segment
        var retired = await Put(Story(Now.AddHours(-1)));
        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"v1/admin/feed-story/{retired}")).StatusCode);
        var (user, _) = await factory.RegisterAsync();

        var stories = (await (await user.GetAsync("v1/content/feed/story")).JsonAsync()).EnumerateArray().ToArray();

        Assert.Equal([first, second], stories.Select(s => s.GetProperty("id").GetString()!));
        Assert.Equal(coat, stories[0].GetProperty("product").GetProperty("id").GetString());
        Assert.Equal(JsonValueKind.Null, stories[1].GetProperty("product").ValueKind);
        Assert.Equal("Bu hafta camel", stories[0].GetProperty("headline").GetString());
        Assert.Equal("Droblet Edit", stories[0].GetProperty("author").GetProperty("name").GetString());
        Assert.Equal("https://img.example/story.jpg", stories[0].GetProperty("imageUrl").GetString());
        Assert.True(stories[0].TryGetProperty("publishedAt", out _));
    }

    [Fact]
    public async Task Admin_Validation_MissingProducts_Auth_KeepsLikesOnEdit()
    {
        await ClearAsync();
        var admin = await factory.AdminAsync();
        var (user, _) = await factory.RegisterAsync();

        var invalid = await admin.PutJsonAsync("v1/admin/feed-post/Bad Id!", new
        {
            segment = "teen", occasion = "office", title = new { en = "No Turkish" }, imageUrls = new[] { "http://insecure.example/x.jpg" },
            productIds = Enumerable.Range(0, 9).Select(i => $"p-{i}").ToArray(), publishAt = Now, published = true,
        });
        var tooManyImages = await admin.PutJsonAsync($"v1/admin/feed-post/{Ulid.New()}", Post(Now, images: ["https://a.example/1.jpg", "https://a.example/2.jpg", "https://a.example/3.jpg", "https://a.example/4.jpg", "https://a.example/5.jpg"]));
        var badAuthor = await admin.PutJsonAsync($"v1/admin/feed-post/{Ulid.New()}", Post(Now, author: new { kind = "edit", name = new { en = "x" } }));
        var missing = await admin.PutJsonAsync($"v1/admin/feed-post/{Ulid.New()}", Post(Now, productIds: ["no-such-product"]));
        var badStory = await admin.PutJsonAsync($"v1/admin/feed-story/{Ulid.New()}", new
        {
            author = new { name = StoreSocialApiFactory.Text("Droblet Edit") }, imageUrl = (string?)null, headline = StoreSocialApiFactory.Text("Başlık"),
            publishAt = Now, expiresAt = Now.AddHours(-1), published = true,
        });

        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        var errors = (await invalid.JsonAsync()).GetProperty("errors");
        Assert.Equal("id_invalid", errors.GetProperty("id")[0].GetString());
        Assert.Equal("segment_invalid", errors.GetProperty("segment")[0].GetString());
        Assert.Equal("author_required", errors.GetProperty("author")[0].GetString());
        Assert.Equal("title_invalid", errors.GetProperty("title")[0].GetString());
        Assert.Equal("image_urls_invalid", errors.GetProperty("imageUrls")[0].GetString());
        Assert.Equal("product_ids_invalid", errors.GetProperty("productIds")[0].GetString());
        Assert.Equal("image_urls_invalid", (await tooManyImages.JsonAsync()).GetProperty("errors").GetProperty("imageUrls")[0].GetString());
        Assert.Equal("author_name_invalid", (await badAuthor.JsonAsync()).GetProperty("errors").GetProperty("author.name")[0].GetString());
        Assert.Equal(HttpStatusCode.UnprocessableEntity, missing.StatusCode);
        Assert.Equal("product_not_found", await missing.CodeAsync());
        var storyErrors = (await badStory.JsonAsync()).GetProperty("errors");
        Assert.Equal("image_url_invalid", storyErrors.GetProperty("imageUrl")[0].GetString());
        Assert.Equal("expires_at_invalid", storyErrors.GetProperty("expiresAt")[0].GetString());
        Assert.Equal(HttpStatusCode.NotFound, (await admin.DeleteAsync("v1/admin/feed-post/feed-missing")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.DeleteAsync("v1/admin/feed-story/story-missing")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await user.GetAsync("v1/admin/feed-post")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await user.PutJsonAsync("v1/admin/feed-story/x-story", new { })).StatusCode);

        // A slug id works too; an edit after likes keeps the like count; the list shows drafts with their status.
        var id = await PutPostAsync(admin, Post(Now.AddMinutes(-1)), "feed-office-1");
        await user.PutAsync($"v1/tenant/feed-post/{id}/like", null);
        var edited = await (await admin.PutJsonAsync($"v1/admin/feed-post/{id}", Post(Now.AddMinutes(-1), title: "Yeni başlık"))).JsonAsync();
        var list = await (await admin.GetAsync("v1/admin/feed-post")).JsonAsync();
        Assert.Equal(1, edited.GetProperty("likeCount").GetInt64());
        Assert.Equal("Yeni başlık", edited.GetProperty("title").GetProperty("tr").GetString());
        Assert.Equal("edit", edited.GetProperty("author").GetProperty("kind").GetString());
        Assert.True(list.EnumerateArray().Single(p => p.GetProperty("id").GetString() == id).GetProperty("published").GetBoolean());
    }

    [Fact]
    public async Task AccountDeletion_TakesTheLikeBack_AndRemovesLikesAndSaves()
    {
        await ClearAsync();
        var admin = await factory.AdminAsync();
        var id = await PutPostAsync(admin, Post(Now.AddMinutes(-1)));
        var (staying, _) = await factory.RegisterAsync();
        var (leaving, auth) = await factory.RegisterAsync();
        await staying.PutAsync($"v1/tenant/feed-post/{id}/like", null);
        await leaving.PutAsync($"v1/tenant/feed-post/{id}/like", null);
        await leaving.PutAsync($"v1/tenant/feed-post/{id}/save", null);

        Assert.Equal(HttpStatusCode.NoContent, (await leaving.DeleteAsync("v1/auth/me")).StatusCode);

        var post = (await (await staying.GetAsync("v1/content/feed")).JsonAsync()).GetProperty("items")[0];
        Assert.Equal(1, post.GetProperty("likeCount").GetInt64());
        Assert.Empty(await factory.Repository.GetKeysAsync(FeedLikeEntity.GetPk(auth.TenantId)));
        Assert.Empty(await factory.Repository.GetKeysAsync(FeedSaveEntity.GetPk(auth.TenantId)));
    }
}
