using System.Net;
using System.Net.Http.Json;
using Domain.Domain;
using Domain.Entity;
using Domain.Enum;
using Domain.Events;
using Domain.Extensions;
using Domain.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;

namespace ApiTests;

/// <summary>The dev configuration: women and men open (Segments:Available).</summary>
public class MenOpenApiFactory : ApiFactory
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.UseSetting("Segments:Available:0", "women");
        builder.UseSetting("Segments:Available:1", "men");
    }
}

public class SegmentEndpointTests(MenOpenApiFactory factory) : IClassFixture<MenOpenApiFactory>
{
    private static readonly string[] MenTags = ["minimal", "smartCasual", "tailored"];

    private async Task<HttpClient> ManAsync() => (await ManWithTenantAsync()).Client;

    private async Task<(HttpClient Client, string TenantId)> ManWithTenantAsync()
    {
        var (client, auth) = await factory.RegisterAsync();
        (await client.PutJsonAsync("v1/tenant/style-profile", new { segment = "men", styleTags = MenTags, budget = "mixed", baseVersion = 0 })).EnsureSuccessStatusCode();
        return (client, auth.TenantId);
    }

    [Fact]
    public async Task Config_IsAnonymous_ListsTheOpenSegments_AndThePerSegmentChoices()
    {
        var response = await factory.CreateClient().GetAsync("v1/config");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var json = await response.JsonAsync();
        Assert.Equal(["women", "men"], json.GetProperty("segments").GetProperty("available").EnumerateArray().Select(e => e.GetString()));
        Assert.Equal(["women", "men", "teen"], json.GetProperty("segments").GetProperty("all").EnumerateArray().Select(e => e.GetString()));
        var menBody = json.GetProperty("bodyTypes").GetProperty("men").EnumerateArray().Select(e => e.GetProperty("id").GetString()).ToList();
        Assert.Equal(["rectangle", "invertedTriangle", "triangle", "oval", "trapezoid", "unsure"], menBody);
        var womenBody = json.GetProperty("bodyTypes").GetProperty("women").EnumerateArray().Select(e => e.GetProperty("id").GetString()).ToList();
        Assert.Equal(["hourglass", "pear", "apple", "rectangle", "invertedTriangle", "unsure"], womenBody);
        var menSubtypes = json.GetProperty("subcategories").GetProperty("men").EnumerateArray().Select(e => e.GetProperty("id").GetString()).ToList();
        Assert.Contains("suit-jacket", menSubtypes);
        Assert.DoesNotContain("dress", menSubtypes);
        Assert.Contains(json.GetProperty("styleTags").GetProperty("men").EnumerateArray(), e => e.GetProperty("id").GetString() == "smartCasual");
    }

    [Fact]
    public async Task StyleProfile_MenIsAccepted_WhenConfigured_TeenNever_AndTagsArePerSegment()
    {
        var (client, auth) = await factory.RegisterAsync();

        var teen = await client.PutJsonAsync("v1/tenant/style-profile", new { segment = "teen", styleTags = MenTags, budget = "mixed", baseVersion = 0 });
        var romantic = await client.PutJsonAsync("v1/tenant/style-profile", new { segment = "men", styleTags = new[] { "minimal", "romantic", "classic" }, budget = "mixed", baseVersion = 0 });
        var men = await client.PutJsonAsync("v1/tenant/style-profile", new { segment = "men", styleTags = MenTags, budget = "mixed", baseVersion = 0 });
        var womenWithMenTag = await client.PutJsonAsync("v1/tenant/style-profile", new { segment = "women", styleTags = new[] { "minimal", "tailored", "boho" }, budget = "mixed", baseVersion = 1 });

        Assert.Equal((HttpStatusCode.UnprocessableEntity, "segment_not_available"), (teen.StatusCode, await teen.CodeAsync()));
        Assert.Equal(HttpStatusCode.BadRequest, romantic.StatusCode);
        Assert.Contains("style_tag_not_in_segment", await romantic.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.OK, men.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, womenWithMenTag.StatusCode);
        var tenant = await factory.Repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(auth.TenantId));
        Assert.Equal(Segment.Men, tenant!.Segment);
    }

    [Fact]
    public async Task BodyProfile_BodyTypesArePerSegment()
    {
        var man = await ManAsync();
        var (woman, _) = await factory.RegisterAsync();

        var hourglass = await man.PutJsonAsync("v1/tenant/body-profile", new { heightCm = 182, size = "l", bodyType = "hourglass", baseVersion = 0 });
        var trapezoid = await man.PutJsonAsync("v1/tenant/body-profile", new { heightCm = 182, size = "l", bodyType = "trapezoid", baseVersion = 0 });
        var womanOval = await woman.PutJsonAsync("v1/tenant/body-profile", new { heightCm = 168, size = "m", bodyType = "oval", baseVersion = 0 });
        var womanPear = await woman.PutJsonAsync("v1/tenant/body-profile", new { heightCm = 168, size = "m", bodyType = "pear", baseVersion = 0 });

        Assert.Equal(HttpStatusCode.BadRequest, hourglass.StatusCode);
        Assert.Contains("body_type_not_in_segment", await hourglass.Content.ReadAsStringAsync());
        Assert.Equal(BodyType.Trapezoid, (await trapezoid.Content.ReadFromJsonAsync<BodyProfileDto>(ApiFactory.Json))!.BodyType);
        Assert.Equal(HttpStatusCode.BadRequest, womanOval.StatusCode);   // no style profile = women
        Assert.Equal(HttpStatusCode.OK, womanPear.StatusCode);
    }

    [Fact]
    public async Task SegmentChange_ClearsABodyTypeOfTheOtherSegment_KeepsASharedOne_AndNeverTouchesTheWardrobe()
    {
        var (client, auth) = await factory.RegisterAsync();
        (await client.PutJsonAsync("v1/tenant/style-profile", new { segment = "women", styleTags = new[] { "minimal", "classic", "boho" }, budget = "mixed", baseVersion = 0 })).EnsureSuccessStatusCode();
        (await client.PutJsonAsync("v1/tenant/body-profile", new { heightCm = 175, size = "m", bodyType = "pear", baseVersion = 0 })).EnsureSuccessStatusCode();
        await factory.Repository.SaveAsync(new ItemEntity { Id = "dress-1", TenantId = auth.TenantId, Name = "Elbise", Category = ItemCategory.Dress, ColorIds = ["black"] });

        (await client.PutJsonAsync("v1/tenant/style-profile", new { segment = "men", styleTags = MenTags, budget = "mixed", baseVersion = 1 })).EnsureSuccessStatusCode();

        var body = await factory.Repository.GetAsync<BodyProfileEntity>(BodyProfileEntity.GetPk(auth.TenantId), BodyProfileEntity.GetSk());
        Assert.Null(body!.BodyType);
        Assert.Equal(175, body.HeightCm);
        Assert.NotNull(await factory.Repository.GetAsync<ItemEntity>(ItemEntity.GetPk(auth.TenantId), ItemEntity.GetSk("dress-1")));

        (await client.PutJsonAsync("v1/tenant/body-profile", new { heightCm = 175, size = "m", bodyType = "rectangle", baseVersion = body.Version })).EnsureSuccessStatusCode();
        (await client.PutJsonAsync("v1/tenant/style-profile", new { segment = "women", styleTags = new[] { "minimal", "classic", "boho" }, budget = "mixed", baseVersion = 2 })).EnsureSuccessStatusCode();
        body = await factory.Repository.GetAsync<BodyProfileEntity>(BodyProfileEntity.GetPk(auth.TenantId), BodyProfileEntity.GetSk());
        Assert.Equal(BodyType.Rectangle, body!.BodyType);   // shared by both segments: kept
    }

    [Fact]
    public async Task Library_IsFilteredByTheUsersSegment_AndTheMensSetHasNoImageYet()
    {
        var man = await ManAsync();
        var (woman, _) = await factory.RegisterAsync();

        var menItems = (await (await man.GetAsync("v1/tenant/library/item")).JsonAsync()).EnumerateArray().ToList();
        var womenItems = (await (await woman.GetAsync("v1/tenant/library/item")).JsonAsync()).EnumerateArray().ToList();

        Assert.True(menItems.Count >= 25);
        Assert.All(menItems, i => Assert.StartsWith("lib-men-", i.GetProperty("id").GetString()));
        Assert.All(menItems, i => Assert.Equal("men", i.GetProperty("segment").GetString()));
        Assert.All(menItems, i => Assert.Equal(System.Text.Json.JsonValueKind.Null, i.GetProperty("imageUrl").ValueKind));
        Assert.NotEmpty(womenItems);
        Assert.DoesNotContain(womenItems, i => i.GetProperty("id").GetString()!.StartsWith("lib-men-", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Catalog_ShowsTheUsersSegmentAndUnisex()
    {
        foreach (var (id, segment) in new[] { ("p-women", CatalogSegment.Women), ("p-men", CatalogSegment.Men), ("p-unisex", CatalogSegment.Unisex) })
            await factory.Repository.SaveAsync(new CatalogProductEntity
            {
                Id = id, BrandId = "brand", Name = new() { ["tr"] = id }, Category = ProductCategory.Tshirt, Colors = ["white"], Sizes = ["M"],
                PriceMinor = 100000, PriceBand = PriceBand.HighStreet, Segment = segment, CreatedAt = DateTime.UtcNow,
            });
        factory.Services.GetRequiredService<ICatalogService>().InvalidateCache();
        var man = await ManAsync();
        var (woman, _) = await factory.RegisterAsync();

        async Task<List<string?>> Ids(HttpClient client) =>
            (await (await client.GetAsync("v1/catalog/product?limit=60")).JsonAsync()).GetProperty("items").EnumerateArray()
            .Select(p => p.GetProperty("id").GetString()).Where(i => i!.StartsWith("p-", StringComparison.Ordinal)).Order().ToList();

        Assert.Equal(["p-men", "p-unisex"], await Ids(man));
        Assert.Equal(["p-unisex", "p-women"], await Ids(woman));
    }

    [Fact]
    public async Task TryOn_FacePath_ForAMan_CarriesTheSegment_AndHasItsOwnCacheKey()
    {
        var (client, tenantId) = await ManWithTenantAsync();
        await factory.PremiumAsync(tenantId);
        var face = await factory.PhotoAsync(tenantId, PhotoKind.Face);
        (await client.PutJsonAsync("v1/tenant/body-profile", new { heightCm = 182, size = "l", bodyType = "trapezoid", baseVersion = 0 })).EnsureSuccessStatusCode();
        var top = await factory.ItemAsync(tenantId, ItemCategory.Top);
        var bottom = await factory.ItemAsync(tenantId, ItemCategory.Bottom);
        var look = await factory.LookAsync(tenantId, (OutfitSlot.Top, top.Id), (OutfitSlot.Bottom, bottom.Id));

        var start = await client.PostJsonAsync("v1/tenant/tryon", new { requestId = Ulid.New(), target = new { kind = "look", id = look.Id } });

        Assert.Equal(HttpStatusCode.Accepted, start.StatusCode);
        var message = Assert.Single(factory.Events.Of<TryOnRequestedEvent>(tenantId));
        Assert.Equal((TryOnSource.Face, Segment.Men, BodyType.Trapezoid), (message.Source, message.Segment!.Value, message.BodyType!.Value));
        Assert.Equal(TryOnRules.FaceSubjectKey(face.Id, BodyType.Trapezoid, 182, ClothingSize.L, Segment.Men), message.BodyPhotoId);
        Assert.EndsWith("-men", message.BodyPhotoId);
    }
}
