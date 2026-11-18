using System.Net;
using System.Net.Http.Headers;
using Domain.Entity;
using Domain.Enum;
using Domain.Options;
using Domain.Services;
using Domain.Services.Ai;
using Infrastructure.Services.Integration;
using Microsoft.Extensions.Logging.Abstractions;
using Tests.Shared;

namespace InfrastructureTests;

/// <summary>The seams between the wardrobe side (items, looks, trips, try-on) and the store / social side (catalog, content).</summary>
public class IntegrationSeamTests
{
    private const string Tenant = "tenant-a";
    private static readonly DateTime Now = WorkerTestHost.Now;

    private static async Task<ItemEntity> ItemAsync(WorkerTestHost host, string id, ItemCategory category, string? imageKey = null, string? global = null)
    {
        var item = new ItemEntity
        {
            Id = id, TenantId = Tenant, Name = id, Category = category, ColorIds = ["white"], Seasons = [Season.Spring],
            ImageKey = imageKey, OriginalImageKey = $"{StorageKeys.TenantRoot(Tenant)}items/{id}/original.jpg", GlobalImageKey = global,
            CreatedAt = Now, UpdatedAt = Now, Version = 1,
        };
        await host.Repository.SaveAsync(item);
        return item;
    }

    private static async Task ProductAsync(WorkerTestHost host, string id, ProductCategory category, bool retired = false, string? image = "https://cdn.example.com/p.webp")
    {
        await host.Repository.SaveAsync(new BrandEntity { Id = "brand-a", Name = "Marka A", CreatedAt = Now, UpdatedAt = Now });
        await host.Repository.SaveAsync(new CatalogProductEntity
        {
            Id = id, BrandId = "brand-a", Name = new() { ["tr"] = "Keten gömlek", ["en"] = "Linen shirt" }, Category = category,
            Colors = ["white", "not-a-colour"], Images = image is null ? [] : [image], PriceMinor = 1000, Retired = retired, CreatedAt = Now, UpdatedAt = Now,
        });
        host.Get<ICatalogService>().InvalidateCache();
    }

    // ── IClosetReader on real entities ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ClosetReader_Items_NeverExposeTheOriginalPhoto()
    {
        var host = new WorkerTestHost();
        var cleanKey = $"{StorageKeys.TenantRoot(Tenant)}items/a/clean.webp";
        await ItemAsync(host, "a", ItemCategory.Top, imageKey: cleanKey);
        await ItemAsync(host, "b", ItemCategory.Shoes);                                   // only an original photo
        await ItemAsync(host, "c", ItemCategory.Bag, global: "https://cdn.example.com/bag.webp");
        await ItemAsync(host, "d", ItemCategory.Top, imageKey: "tenants/other-tenant/items/x/clean.webp"); // foreign key: never signed

        var items = (await host.Get<IClosetReader>().GetItemsAsync(Tenant, default)).ToDictionary(i => i.Id);

        Assert.Contains("clean.webp", items["a"].ImageUrl);
        Assert.Null(items["b"].ImageUrl);
        Assert.Equal("https://cdn.example.com/bag.webp", items["c"].ImageUrl);
        Assert.Null(items["d"].ImageUrl);
        Assert.DoesNotContain(items.Values, i => i.ImageUrl?.Contains("original") == true);
        Assert.Equal(ItemCategory.Shoes, items["b"].Category);
        Assert.Empty(await host.Get<IClosetReader>().GetItemsAsync("tenant-b", default));
    }

    [Fact]
    public async Task ClosetReader_Looks_NewestFirst_DropDeletedPieces_KeepCatalogPieces()
    {
        var host = new WorkerTestHost();
        await ItemAsync(host, "top", ItemCategory.Top);
        async Task Look(string id, DateTime createdAt, params LookSlotValue[] slots) => await host.Repository.SaveAsync(new LookEntity
        {
            Id = id, TenantId = Tenant, Name = id, Occasion = Occasion.Office, Slots = slots.ToList(), CreatedAt = createdAt, UpdatedAt = createdAt, Version = 1,
        });
        await Look("old", Now.AddDays(-2), new LookSlotValue { Slot = OutfitSlot.Top, ItemId = "top" }, new LookSlotValue { Slot = OutfitSlot.Shoes, ItemId = "deleted" });
        await Look("new", Now, new LookSlotValue { Slot = OutfitSlot.BagAccessory, ProductId = "p1" }, new LookSlotValue { Slot = OutfitSlot.Top, ItemId = "top" });
        var reader = host.Get<IClosetReader>();

        var looks = await reader.GetLooksAsync(Tenant, default);
        var single = await reader.GetLookAsync(Tenant, "old", default);

        Assert.Equal(["new", "old"], looks.Select(l => l.Id).ToArray());
        Assert.Equal("office", looks[0].Occasion);
        Assert.Equal([(OutfitSlot.Top, "top", null), (OutfitSlot.BagAccessory, null, "p1")], looks[0].Pieces.Select(p => (p.Slot, p.ItemId, p.ProductId)).ToArray());
        Assert.Equal("top", Assert.Single(single!.Pieces).ItemId);
        Assert.Null(await reader.GetLookAsync(Tenant, "nope", default));
        Assert.Null(await reader.GetLookAsync("tenant-b", "old", default)); // an id only resolves inside its own tenant
    }

    [Fact]
    public async Task ClosetReader_Trips_OnlyFinishedOnes_CityAndMonthOnly()
    {
        var host = new WorkerTestHost(); // clock: 2026-11-18
        async Task Trip(string id, string start, string end, string? cityName) => await host.Repository.SaveAsync(new TripEntity
        {
            Id = id, TenantId = Tenant, CityId = "2988507", CityName = cityName, StartDate = start, EndDate = end, CreatedAt = Now, UpdatedAt = Now, Version = 1,
        });
        await Trip("past", "2026-10-29", "2026-11-02", "Paris");
        await Trip("ongoing", "2026-11-16", "2026-11-18", "Roma");
        await Trip("future", "2026-12-01", "2026-12-05", "Londra");
        await Trip("unnamed", "2026-09-01", "2026-09-03", null);

        var trips = await host.Get<IClosetReader>().GetCompletedTripsAsync(Tenant, default);

        Assert.Equal([new ClosetTrip("past", "Paris", "2026-10"), new ClosetTrip("unnamed", "2988507", "2026-09")], trips);
    }

    [Fact]
    public async Task WardrobeMatcher_UsesRealItems()
    {
        var host = new WorkerTestHost();
        await ItemAsync(host, "white-top", ItemCategory.Top);
        await ItemAsync(host, "white-skirt", ItemCategory.Bottom);
        var skirt = new CatalogProductEntity { Id = "p", BrandId = "b", Category = ProductCategory.Skirt, Colors = ["red"], CreatedAt = Now };
        var shoes = new CatalogProductEntity { Id = "s", BrandId = "b", Category = ProductCategory.Shoes, Colors = ["black"], CreatedAt = Now };
        var matcher = host.Get<IWardrobeMatcher>();

        var match = await matcher.MatchProductAsync(Tenant, skirt, default);
        var complete = await matcher.CompleteAsync(Tenant, ["white-top"], [skirt, shoes], null, null, 3, default);

        Assert.Equal("white-top", Assert.Single(match.CompatibleItems).Id);   // the skirt it already owns fills the same slot
        Assert.Equal([ProductSlot.Bottom, ProductSlot.Shoes], complete.Select(c => c.Slot).ToArray());
    }

    // ── ICatalogProductLookup / IEditLookLookup on the real catalog ─────────────────────────────────────────────

    [Theory]
    [InlineData(ProductCategory.Shirt, ItemCategory.Top)]
    [InlineData(ProductCategory.Activewear, ItemCategory.Top)]
    [InlineData(ProductCategory.Jeans, ItemCategory.Bottom)]
    [InlineData(ProductCategory.Coat, ItemCategory.Outerwear)]
    [InlineData(ProductCategory.Dress, ItemCategory.Dress)]
    [InlineData(ProductCategory.Swimwear, ItemCategory.Beachwear)]
    [InlineData(ProductCategory.Skiwear, ItemCategory.Skiwear)]
    [InlineData(ProductCategory.Bag, ItemCategory.Bag)]
    [InlineData(ProductCategory.Accessory, ItemCategory.Accessory)]
    public void ProductCategory_MapsToWardrobeCategory(ProductCategory product, ItemCategory expected) =>
        Assert.Equal(expected, CatalogRules.ItemCategoryOf(product));

    [Fact]
    public void EveryProductCategory_FitsItsDefaultOutfitSlot()
    {
        foreach (var category in Enum.GetValues<ProductCategory>())
        {
            var item = CatalogRules.ItemCategoryOf(category);
            Assert.True(OutfitSlotRules.Accepts(OutfitSlotRules.DefaultSlot(item), item), category.ToString());
        }
    }

    [Fact]
    public async Task ProductLookup_ReadsTheRealCatalog()
    {
        var host = new WorkerTestHost();
        await ProductAsync(host, "p1", ProductCategory.Shirt);
        await ProductAsync(host, "gone", ProductCategory.Bag, retired: true);
        var lookup = host.Get<ICatalogProductLookup>();

        var product = await lookup.GetAsync("p1", default);

        Assert.Equal(("Keten gömlek", "brand-a", "Marka A", ItemCategory.Top, "https://cdn.example.com/p.webp", false),
            (product!.Name, product.BrandId, product.BrandName, product.Category, product.ImageKey, product.Retired));
        Assert.True((await lookup.GetAsync("gone", default))!.Retired);
        Assert.Null(await lookup.GetAsync("unknown", default));
        Assert.Null(await lookup.GetAsync("", default));
    }

    private static (CatalogProductLookup Lookup, StubHandler Handler) Lookup(WorkerTestHost host, Func<HttpRequestMessage, HttpResponseMessage> respond, CatalogOptions? options = null)
    {
        var handler = new StubHandler(respond);
        return (new CatalogProductLookup(host.Get<ICatalogService>(), new FixedLanguage("en"), new HttpClient(handler),
            Fixtures.Monitor(options ?? new CatalogOptions()), NullLogger<CatalogProductLookup>.Instance), handler);
    }

    private static HttpResponseMessage Image(byte[] data, string contentType = "image/webp") =>
        new(HttpStatusCode.OK) { Content = new ByteArrayContent(data) { Headers = { ContentType = new MediaTypeHeaderValue(contentType) } } };

    [Fact]
    public async Task ProductLookup_ReadImage_DownloadsTheFirstImage_ForTryOn()
    {
        var host = new WorkerTestHost();
        await ProductAsync(host, "p1", ProductCategory.Shirt);
        var (lookup, handler) = Lookup(host, _ => Image([1, 2, 3]));

        var product = await lookup.GetAsync("p1", default);
        var image = await lookup.ReadImageAsync(product!, default);

        Assert.Equal("Linen shirt", product!.Name); // request language
        Assert.Equal(("image/webp", 3), (image!.ContentType, image.Data.Length));
        Assert.Equal("https://cdn.example.com/p.webp", Assert.Single(handler.Requests).Uri.ToString());
    }

    [Fact]
    public async Task ProductLookup_ReadImage_RefusesAnythingThatIsNotASmallImage()
    {
        var host = new WorkerTestHost();
        await ProductAsync(host, "p1", ProductCategory.Shirt);
        await ProductAsync(host, "no-image", ProductCategory.Shirt, image: null);
        var small = new CatalogOptions { MaxImageBytes = 2 };

        async Task<ImageInput?> Read(Func<HttpRequestMessage, HttpResponseMessage> respond, CatalogOptions? options = null, string id = "p1")
        {
            var (lookup, _) = Lookup(host, respond, options);
            return await lookup.ReadImageAsync((await lookup.GetAsync(id, default))!, default);
        }

        Assert.Null(await Read(_ => Image([1, 2, 3], "text/html")));
        Assert.Null(await Read(_ => new HttpResponseMessage(HttpStatusCode.NotFound)));
        Assert.Null(await Read(_ => Image([1, 2, 3]), small));
        Assert.Null(await Read(_ => Image([])));
        Assert.Null(await Read(_ => throw new HttpRequestException("down")));
        Assert.Null(await Read(_ => Image([1]), id: "no-image"));
        Assert.Null(await Read(_ => Image([1]), new CatalogOptions { ImageHosts = ["images.brand.com"] }));
        Assert.NotNull(await Read(_ => Image([1]), new CatalogOptions { ImageHosts = ["example.com"] })); // sub-domain of an allowed host
    }

    [Theory]
    [InlineData("https://cdn.example.com/a.webp", true)]
    [InlineData("http://cdn.example.com/a.webp", false)]
    [InlineData("https://user:pw@cdn.example.com/a.webp", false)]
    [InlineData("https://localhost/a.webp", false)]
    [InlineData("https://127.0.0.1/a.webp", false)]
    [InlineData("https://169.254.169.254/latest/meta-data", false)]
    [InlineData("catalog/bag.webp", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void ProductImageUrl_HttpsDnsHostsOnly(string? url, bool allowed) =>
        Assert.Equal(allowed, CatalogProductLookup.IsAllowedImageUrl(url, [], out _));

    [Fact]
    public async Task EditLookLookup_ResolvesWeeklyEditVariants_AndCollectionLooks()
    {
        var host = new WorkerTestHost();
        EditLook Look(string id) => new()
        {
            Id = id, Day = 1, Title = new() { ["tr"] = "Ofis" },
            Variants =
            [
                new EditLookVariant { PriceBand = PriceBand.LuxuryTouch, ProductIds = ["lx-1", "lx-2"] },
                new EditLookVariant { PriceBand = PriceBand.HighStreet, ProductIds = ["hs-1"] },
            ],
        };
        WeeklyEditEntity Edit(string id, bool published, bool retired = false) => new()
        {
            Id = id, Segment = Segment.Women, WeekStart = "2026-11-16", Title = new() { ["tr"] = "Edit" }, Looks = [Look($"{id}-d1")],
            Published = published, Retired = retired, CreatedAt = Now, UpdatedAt = Now,
        };
        await host.Repository.SaveAsync(Edit("live", published: true));
        await host.Repository.SaveAsync(Edit("draft", published: false));
        await host.Repository.SaveAsync(Edit("old", published: true, retired: true));
        await host.Repository.SaveAsync(new ContentCollectionEntity { Id = "creator-1", Kind = ContentCollectionKind.Creator, Title = new() { ["tr"] = "Koleksiyon" }, CreatedAt = Now, UpdatedAt = Now });
        await host.Repository.SaveAsync(new ContentLookEntity { Id = "look-1", CollectionId = "creator-1", Title = new() { ["tr"] = "Look" }, ProductIds = ["p1"], CreatedAt = Now, UpdatedAt = Now });
        await ProductAsync(host, "p1", ProductCategory.Shirt);
        var lookup = host.Get<IEditLookLookup>();

        Assert.Equal(["hs-1"], await lookup.GetProductIdsAsync("live-d1", default));                     // first price band
        Assert.Equal(["lx-1", "lx-2"], await lookup.GetProductIdsAsync("live-d1@luxuryTouch", default));
        Assert.Equal(["p1"], await lookup.GetProductIdsAsync("creator-1/look-1", default));
        Assert.Null(await lookup.GetProductIdsAsync("draft-d1", default));
        Assert.Null(await lookup.GetProductIdsAsync("old-d1", default));
        Assert.Null(await lookup.GetProductIdsAsync("live-d1@gold", default));
        Assert.Null(await lookup.GetProductIdsAsync("creator-1/nope", default));
        Assert.Null(await lookup.GetProductIdsAsync("nope/look-1", default));
        Assert.Null(await lookup.GetProductIdsAsync("", default));
    }
}
