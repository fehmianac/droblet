using System.Net;
using Domain.Entity;
using Domain.Enum;
using Domain.Extensions;
using Domain.Services;

namespace ApiTests;

/// <summary>End-to-end checks of the seams between the wardrobe endpoints and the store / social endpoints.</summary>
public class IntegrationEndpointTests(StoreSocialApiFactory factory) : IClassFixture<StoreSocialApiFactory>
{
    private async Task<string> CreateLookAsync(TestUser owner, string? productId = null)
    {
        var top = Ulid.New();
        var shoes = Ulid.New();
        factory.Closet.AddItem(owner.TenantId, top, ItemCategory.Top, "white");
        factory.Closet.AddItem(owner.TenantId, shoes, ItemCategory.Shoes, "black");
        var slots = new List<object> { new { slot = "top", itemId = top }, new { slot = "shoes", itemId = shoes } };
        if (productId is not null)
            slots.Add(new { slot = "bagAccessory", productId });
        var id = Ulid.New();
        var created = await owner.Client.PostJsonAsync("v1/tenant/look", new { id, name = "Cuma ofis", occasion = "office", slots });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        return id;
    }

    [Fact]
    public async Task ALookCreatedThroughTheLookApi_ReachesFollowersFeed_AndItsRatingComesBackToTheOwner()
    {
        var admin = await factory.AdminAsync();
        var bag = await factory.SeedProductAsync(admin, await factory.SeedBrandAsync(admin), category: ProductCategory.Bag);
        var owner = await factory.UserAsync(ClosetVisibility.FollowersOnly);
        var friend = await factory.UserAsync();
        var stranger = await factory.UserAsync();
        var lookId = await CreateLookAsync(owner, bag);
        (await friend.Client.PostAsync($"v1/tenant/follow/{owner.Handle}", null)).EnsureSuccessStatusCode();
        (await owner.Client.PostAsync($"v1/tenant/follow-request/{friend.Handle}/approve", null)).EnsureSuccessStatusCode();   // decision 8

        var feed = await (await friend.Client.GetAsync("v1/tenant/feed")).JsonAsync();
        var rated = await friend.Client.PutJsonAsync($"v1/tenant/people/{owner.Handle}/look/{lookId}/rating", new { score = 4 });
        var strangerRating = await stranger.Client.PutJsonAsync($"v1/tenant/people/{owner.Handle}/look/{lookId}/rating", new { score = 1 });
        var mine = await (await owner.Client.GetAsync("v1/tenant/look")).JsonAsync();
        var single = await (await owner.Client.GetAsync($"v1/tenant/look/{lookId}")).JsonAsync();

        var entry = Assert.Single(feed.GetProperty("items").EnumerateArray());
        Assert.Equal((lookId, "Cuma ofis", "office"), (entry.GetProperty("id").GetString(), entry.GetProperty("name").GetString(), entry.GetProperty("occasion").GetString()));
        var pieces = entry.GetProperty("pieces").EnumerateArray().ToList();
        Assert.Equal(["top", "shoes", "bagAccessory"], pieces.Select(p => p.GetProperty("slot").GetString()!).ToArray());
        Assert.Contains("clean.webp", pieces[0].GetProperty("imageUrl").GetString());            // cleaned image only
        Assert.DoesNotContain(pieces, p => p.GetProperty("imageUrl").GetString()?.Contains("original") == true);
        Assert.Equal(bag, pieces[2].GetProperty("product").GetProperty("id").GetString());       // "Parçaları gör" → shop
        Assert.Equal(HttpStatusCode.OK, rated.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, strangerRating.StatusCode);                        // followers-only closet
        Assert.Equal((4.0, 1), (mine[0].GetProperty("rating").GetProperty("average").GetDouble(), mine[0].GetProperty("rating").GetProperty("count").GetInt64()));
        Assert.Equal(4.0, single.GetProperty("rating").GetProperty("average").GetDouble());

        // Deleting the look removes it from the feed and drops its rating summary.
        Assert.Equal(HttpStatusCode.NoContent, (await owner.Client.DeleteAsync($"v1/tenant/look/{lookId}")).StatusCode);
        Assert.Equal(0, (await (await friend.Client.GetAsync("v1/tenant/feed")).JsonAsync()).GetProperty("items").GetArrayLength());
        Assert.Empty(await factory.Repository.GetAllAsync<LookRatingSummaryEntity>(LookRatingSummaryEntity.GetPk(owner.TenantId)));
    }

    [Fact]
    public async Task UnratedLook_HasNoRating_AndBlockHidesRealLooks()
    {
        var owner = await factory.UserAsync();
        var viewer = await factory.UserAsync();
        var lookId = await CreateLookAsync(owner);

        var mine = await (await owner.Client.GetAsync($"v1/tenant/look/{lookId}")).JsonAsync();
        var before = await viewer.Client.GetAsync($"v1/tenant/people/{owner.Handle}/look");
        (await owner.Client.PutAsync($"v1/tenant/block/{viewer.Handle}", null)).EnsureSuccessStatusCode();
        var after = await viewer.Client.GetAsync($"v1/tenant/people/{owner.Handle}/look");

        Assert.Equal(System.Text.Json.JsonValueKind.Null, mine.GetProperty("rating").ValueKind);
        Assert.Equal(HttpStatusCode.OK, before.StatusCode);
        Assert.Equal(lookId, (await before.JsonAsync())[0].GetProperty("id").GetString());
        Assert.Equal(HttpStatusCode.NotFound, after.StatusCode);
    }

    [Fact]
    public async Task ProfileStats_CountTheCallersOwnRows()
    {
        var me = await factory.UserAsync();
        var fan = await factory.UserAsync();
        var idol = await factory.UserAsync();
        await CreateLookAsync(me);
        factory.Closet.AddTrip(me.TenantId, Ulid.New());
        (await fan.Client.PostAsync($"v1/tenant/follow/{me.Handle}", null)).EnsureSuccessStatusCode();
        (await me.Client.PostAsync($"v1/tenant/follow/{idol.Handle}", null)).EnsureSuccessStatusCode();
        await CreateLookAsync(idol); // somebody else's rows never count

        var stats = await (await me.Client.GetAsync("v1/tenant/profile/stats")).JsonAsync();
        var anonymous = await factory.CreateClient().GetAsync("v1/tenant/profile/stats");

        Assert.Equal((2, 1, 1, 1, 1), (stats.GetProperty("itemCount").GetInt32(), stats.GetProperty("lookCount").GetInt32(), stats.GetProperty("tripCount").GetInt32(),
            stats.GetProperty("followerCount").GetInt32(), stats.GetProperty("followingCount").GetInt32()));
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
    }

    [Fact]
    public async Task PaletteProducts_AreTheCatalogFilteredByMyPaletteColours()
    {
        var admin = await factory.AdminAsync();
        var brand = await factory.SeedBrandAsync(admin);
        var season = SeasonTypeCatalog.Find("cool-winter")!; // flattering: black, white, navy, …; avoid: orange, rust, camel, …
        var navyDress = await factory.SeedProductAsync(admin, brand, 300_000, ProductCategory.Dress, ["navy"]);
        var whiteShirt = await factory.SeedProductAsync(admin, brand, 100_000, ProductCategory.Shirt, ["white", "camel"]);
        var camelCoat = await factory.SeedProductAsync(admin, brand, 900_000, ProductCategory.Coat, ["camel", "black"]);   // main colour is one to avoid
        var sageTop = await factory.SeedProductAsync(admin, brand, 100_000, ProductCategory.Blouse, ["sage"]);               // neither
        var (user, auth) = await factory.RegisterAsync();

        var withoutPalette = await user.GetAsync("v1/tenant/palette/products");
        await factory.Repository.SaveAsync(new PaletteResultEntity
        {
            TenantId = auth.TenantId, SeasonTypeId = season.Id, FlatteringColorIds = season.FlatteringColorIds.ToList(), AvoidColorIds = season.AvoidColorIds.ToList(), AnalyzedAt = DateTime.UtcNow,
        });
        async Task<List<string?>> Ids(string query = "") =>
            (await (await user.GetAsync($"v1/tenant/palette/products?limit=60&{query}")).JsonAsync()).GetProperty("items").EnumerateArray().Select(p => p.GetProperty("id").GetString()).ToList();

        var all = await Ids();
        var dresses = await Ids("category=dress");
        var cheapFirst = await Ids("sort=priceAsc");

        Assert.Equal((HttpStatusCode.NotFound, "palette_not_found"), (withoutPalette.StatusCode, await withoutPalette.CodeAsync()));
        Assert.Contains(navyDress, all);
        Assert.Contains(whiteShirt, all);
        Assert.DoesNotContain(camelCoat, all);
        Assert.DoesNotContain(sageTop, all);
        Assert.Equal([navyDress], dresses.Where(id => id == navyDress || id == whiteShirt).Select(id => id!).ToArray());
        Assert.True(cheapFirst.IndexOf(whiteShirt) < cheapFirst.IndexOf(navyDress));
        Assert.Equal(HttpStatusCode.BadRequest, (await user.GetAsync("v1/tenant/palette/products?category=spaceship")).StatusCode);
    }

    [Fact]
    public async Task Today_ReturnsTheForecast_ForSharedCoordinates()
    {
        var (user, _) = await factory.RegisterAsync();

        var withLocation = await (await user.GetAsync("v1/tenant/today?date=2026-11-18&latitude=41.01&longitude=28.95")).JsonAsync();
        var withoutLocation = await (await user.GetAsync("v1/tenant/today?date=2026-11-18")).JsonAsync();

        var weather = withLocation.GetProperty("weather");
        Assert.Equal(("2026-11-18", 8, 15, "rain", 70), (weather.GetProperty("date").GetString(), weather.GetProperty("minTempC").GetInt32(),
            weather.GetProperty("maxTempC").GetInt32(), weather.GetProperty("condition").GetString(), weather.GetProperty("precipitationChance").GetInt32()));
        Assert.Equal(System.Text.Json.JsonValueKind.Null, withoutLocation.GetProperty("weather").ValueKind); // no location, no profile city
    }

    [Fact]
    public async Task FromProduct_AddsARealCatalogProduct_ToTheWardrobe_AndTheMatcherSeesIt()
    {
        var admin = await factory.AdminAsync();
        var brand = await factory.SeedBrandAsync(admin);
        var jeans = await factory.SeedProductAsync(admin, brand, category: ProductCategory.Jeans, colors: ["denim", "not-a-wardrobe-colour"], tr: "Kot pantolon", en: "Jeans");
        var shirt = await factory.SeedProductAsync(admin, brand, category: ProductCategory.Shirt, colors: ["white"]);
        var (user, _) = await factory.RegisterAsync();

        var added = await user.PostJsonAsync("v1/tenant/item/from-product", new { clientMutationId = Ulid.New(), productId = jeans, size = "M" });
        var item = (await added.JsonAsync()).GetProperty("item");
        var match = await (await user.GetAsync($"v1/tenant/catalog/product/{shirt}/match")).JsonAsync();

        Assert.Equal(HttpStatusCode.Created, added.StatusCode);
        Assert.Equal(("bottom", "purchase", "Kot pantolon", "https://img.example/1.jpg"),
            (item.GetProperty("category").GetString(), item.GetProperty("source").GetString(), item.GetProperty("name").GetString(), item.GetProperty("imageUrl").GetString()));
        Assert.Equal(["denim"], item.GetProperty("colorIds").EnumerateArray().Select(c => c.GetString()!).ToArray());
        Assert.Equal(1, match.GetProperty("compatibleCount").GetInt32());
        Assert.Equal("bottom", match.GetProperty("items")[0].GetProperty("category").GetString());
    }
}
