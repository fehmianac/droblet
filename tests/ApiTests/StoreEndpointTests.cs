using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Domain.Entity;
using Domain.Enum;
using Domain.Services;

namespace ApiTests;

public class AdminAndCatalogEndpointTests(StoreSocialApiFactory factory) : IClassFixture<StoreSocialApiFactory>
{
    [Fact]
    public async Task Admin_Anonymous401_NonAdmin403_Admin200()
    {
        var (user, _) = await factory.RegisterAsync();
        var admin = await factory.AdminAsync();

        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().GetAsync("v1/admin/brand")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await user.GetAsync("v1/admin/brand")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await user.PutJsonAsync("v1/admin/brand/x-brand", new { name = "X", source = "network" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await user.GetAsync("v1/admin/report/revenue")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await user.GetAsync("v1/admin/moderation/report")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync("v1/admin/brand")).StatusCode);
    }

    [Fact]
    public async Task Catalog_RequiresSignIn() =>
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().GetAsync("v1/catalog/product")).StatusCode);

    [Fact]
    public async Task AdminBrandAndProduct_Validation_UnknownBrand_Retire()
    {
        var admin = await factory.AdminAsync();
        var brand = await factory.SeedBrandAsync(admin);

        var invalid = await admin.PutJsonAsync("v1/admin/product/prod-invalid", new { brandId = brand, name = new { en = "No Turkish" }, category = "shirt", priceMinor = 0, priceBand = "highStreet" });
        var unknownBrand = await admin.PutJsonAsync("v1/admin/product/prod-orphan", new { brandId = "no-such-brand", name = StoreSocialApiFactory.Text("A"), category = "shirt", priceMinor = 100, priceBand = "highStreet" });
        var productId = await factory.SeedProductAsync(admin, brand);
        var retired = await admin.DeleteAsync($"v1/admin/product/{productId}");
        var (user, _) = await factory.RegisterAsync();
        var detail = await user.GetAsync($"v1/catalog/product/{productId}");
        var listed = await user.GetAsync($"v1/catalog/product?brand={brand}");

        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        var errors = (await invalid.JsonAsync()).GetProperty("errors");
        Assert.Equal("name_invalid", errors.GetProperty("name")[0].GetString());
        Assert.Equal("price_invalid", errors.GetProperty("priceMinor")[0].GetString());
        Assert.Equal(HttpStatusCode.UnprocessableEntity, unknownBrand.StatusCode);
        Assert.Equal("brand_not_found", await unknownBrand.CodeAsync());
        Assert.Equal(HttpStatusCode.NoContent, retired.StatusCode);
        Assert.False((await detail.JsonAsync()).GetProperty("available").GetBoolean());   // still resolves for carts / looks
        Assert.Equal(0, (await listed.JsonAsync()).GetProperty("count").GetInt64());      // but is no longer listed
        Assert.Equal(HttpStatusCode.NotFound, (await admin.DeleteAsync("v1/admin/product/prod-missing")).StatusCode);
    }

    [Fact]
    public async Task ProductList_Filters_Search_Sort_CursorPaging()
    {
        var admin = await factory.AdminAsync();
        var brand = await factory.SeedBrandAsync(admin);
        var shirt = await factory.SeedProductAsync(admin, brand, 100_000, ProductCategory.Shirt, ["white"], ["S", "M"], tr: "Keten Gömlek", en: "Linen Shirt");
        var dress = await factory.SeedProductAsync(admin, brand, 900_000, ProductCategory.Dress, ["red"], ["M"], PriceBand.LuxuryTouch, tr: "İpek Elbise", en: "Silk Dress");
        var jeans = await factory.SeedProductAsync(admin, brand, 300_000, ProductCategory.Jeans, ["denim"], ["L"], tr: "Kot Pantolon", en: "Jeans");
        var (user, _) = await factory.RegisterAsync();

        async Task<string[]> Ids(string query) =>
            (await (await user.GetAsync($"v1/catalog/product?brand={brand}&{query}")).JsonAsync()).GetProperty("items").EnumerateArray().Select(i => i.GetProperty("id").GetString()!).ToArray();

        Assert.Equal([jeans, dress, shirt], await Ids(""));                           // newest first
        Assert.Equal([dress], await Ids("category=dress"));
        Assert.Equal([dress], await Ids("priceBand=luxuryTouch"));
        Assert.Equal([shirt], await Ids("color=white&size=s"));
        Assert.Equal([shirt], await Ids("q=gomlek"));
        Assert.Equal([dress], await Ids("q=silk"));
        Assert.Equal([shirt, jeans, dress], await Ids("sort=priceAsc"));
        Assert.Equal(HttpStatusCode.BadRequest, (await user.GetAsync("v1/catalog/product?category=spaceship")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await user.GetAsync("v1/catalog/product?sort=cheapest")).StatusCode);

        var first = await (await user.GetAsync($"v1/catalog/product?brand={brand}&limit=2")).JsonAsync();
        var second = await (await user.GetAsync($"v1/catalog/product?brand={brand}&limit=2&pageToken={first.GetProperty("pageToken").GetString()}")).JsonAsync();
        Assert.Equal(3, first.GetProperty("count").GetInt64());
        Assert.Equal(2, first.GetProperty("items").GetArrayLength());
        Assert.Equal(shirt, second.GetProperty("items")[0].GetProperty("id").GetString());
        Assert.Equal(JsonValueKind.Null, second.GetProperty("pageToken").ValueKind);
    }

    [Fact]
    public async Task ProductText_ResolvesByProfileLanguage_ThenAcceptLanguage_ThenDefault_AndNeverExposesAffiliateLink()
    {
        var admin = await factory.AdminAsync();
        var brand = await factory.SeedBrandAsync(admin);
        var product = await factory.SeedProductAsync(admin, brand, tr: "Keten Gömlek", en: "Linen Shirt");
        var trOnly = await factory.SeedProductAsync(admin, brand, tr: "Yün Kazak", en: "");
        var (user, _) = await factory.RegisterAsync(); // profile language defaults to tr

        async Task<JsonElement> Get(string id, string? acceptLanguage = null)
        {
            var request = new HttpRequestMessage(HttpMethod.Get, $"v1/catalog/product/{id}");
            if (acceptLanguage is not null) request.Headers.TryAddWithoutValidation("Accept-Language", acceptLanguage);
            return await (await user.SendAsync(request)).JsonAsync();
        }

        var turkish = await Get(product, "en-US");                   // profile language wins over the header
        (await user.PutJsonAsync("v1/tenant/profile", new { displayName = "Ayşe", language = "en", baseVersion = 1 })).EnsureSuccessStatusCode();
        var english = await Get(product);
        var fallback = await Get(trOnly);
        var unsupported = await user.PutJsonAsync("v1/tenant/profile", new { displayName = "Ayşe", language = "de", baseVersion = 2 });
        var adminView = await (await admin.GetAsync($"v1/admin/product/{product}")).JsonAsync();

        Assert.Equal("Keten Gömlek", turkish.GetProperty("name").GetString());
        Assert.Equal("Linen Shirt", english.GetProperty("name").GetString());
        Assert.Equal("Yün Kazak", fallback.GetProperty("name").GetString());           // no English text → default language
        Assert.Equal(HttpStatusCode.BadRequest, unsupported.StatusCode);              // not in Localization:SupportedLanguages
        Assert.False(english.TryGetProperty("affiliateUrl", out _));
        Assert.Equal("shirt", english.GetProperty("category").GetString());            // codes, never translated prose
        Assert.Equal("top", english.GetProperty("slot").GetString());
        Assert.Equal("Linen Shirt", adminView.GetProperty("name").GetProperty("en").GetString());
        Assert.Equal("https://shop.example/p?utm=x", adminView.GetProperty("affiliateUrl").GetString());
    }

    [Fact]
    public async Task BulkUpsert_WritesValidRows_ReportsInvalidOnes()
    {
        var admin = await factory.AdminAsync();
        var brand = await factory.SeedBrandAsync(admin);
        var existing = await factory.SeedProductAsync(admin, brand, 200_000);
        var fresh = StoreSocialApiFactory.Unique("prod-");
        object Row(string id, string brandId, long price) => new { id, brandId, name = StoreSocialApiFactory.Text("Ürün", "Product"), category = "shirt", priceMinor = price, priceBand = "highStreet", sizes = new[] { "M" } };

        var response = await admin.PostJsonAsync("v1/admin/product/bulk", new
        {
            products = new[] { Row(fresh, brand, 150_000), Row(existing, brand, 180_000), Row("bad id", brand, 100), Row(StoreSocialApiFactory.Unique("prod-"), "no-such-brand", 100), Row(fresh, brand, 1) },
        });
        var body = await response.JsonAsync();
        var rows = body.GetProperty("rows").EnumerateArray().Select(r => r.GetProperty("outcome").GetString()!).ToArray();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal((1, 1, 3), (body.GetProperty("created").GetInt32(), body.GetProperty("updated").GetInt32(), body.GetProperty("failed").GetInt32()));
        Assert.Equal(["created", "updated", "invalid", "brand_not_found", "duplicate_id"], rows);
        Assert.Equal(180_000, (await (await admin.GetAsync($"v1/admin/product/{existing}")).JsonAsync()).GetProperty("priceMinor").GetInt64());
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostJsonAsync("v1/admin/product/bulk", new { products = Array.Empty<object>() })).StatusCode);
    }

    [Fact]
    public async Task ContentCollections_EmptyByDefault_ThenDataDriven()
    {
        var admin = await factory.AdminAsync();
        var (user, _) = await factory.RegisterAsync();
        var brand = await factory.SeedBrandAsync(admin);
        var product = await factory.SeedProductAsync(admin, brand, 250_000);
        var collection = StoreSocialApiFactory.Unique("creator-");

        var emptySeries = await (await user.GetAsync("v1/content/series-outfit")).JsonAsync();
        (await admin.PutJsonAsync($"v1/admin/collection/creator/{collection}", new { title = StoreSocialApiFactory.Text("Editör 1", "Editor 1"), sortOrder = 1 })).EnsureSuccessStatusCode();
        var missingProduct = await admin.PutJsonAsync($"v1/admin/collection/creator/{collection}/look/look-1", new { title = StoreSocialApiFactory.Text("Hafta sonu"), productIds = new[] { "prod-unknown" } });
        (await admin.PutJsonAsync($"v1/admin/collection/creator/{collection}/look/look-1", new { title = StoreSocialApiFactory.Text("Hafta sonu", "Weekend"), productIds = new[] { product } })).EnsureSuccessStatusCode();

        var creators = await (await user.GetAsync("v1/content/creator")).JsonAsync();
        var looks = await (await user.GetAsync($"v1/content/creator/{collection}/look")).JsonAsync();

        Assert.Equal(0, emptySeries.GetArrayLength());
        Assert.Equal(HttpStatusCode.UnprocessableEntity, missingProduct.StatusCode);
        Assert.Equal("prod-unknown", (await missingProduct.JsonAsync()).GetProperty("productIds")[0].GetString());
        Assert.Contains(creators.EnumerateArray(), c => c.GetProperty("id").GetString() == collection && c.GetProperty("title").GetString() == "Editör 1");
        Assert.Equal("Hafta sonu", looks[0].GetProperty("title").GetString());
        Assert.Equal(250_000, looks[0].GetProperty("totalMinor").GetInt64());
        Assert.Equal(HttpStatusCode.NotFound, (await user.GetAsync("v1/content/creator/creator-missing/look")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await user.GetAsync($"v1/content/series-outfit/{collection}/look")).StatusCode); // other kind
    }
}

public class WeeklyEditEndpointTests(StoreSocialApiFactory factory) : IClassFixture<StoreSocialApiFactory>
{
    [Fact]
    public async Task WeeklyEdit_PublishRules_CurrentEdit_Variants_SponsoredFlag()
    {
        var admin = await factory.AdminAsync();
        var (user, _) = await factory.RegisterAsync();
        var brand = await factory.SeedBrandAsync(admin);
        var high = await factory.SeedProductAsync(admin, brand, 100_000);
        var luxury = await factory.SeedProductAsync(admin, brand, 800_000, priceBand: PriceBand.LuxuryTouch);
        var weekStart = WeeklyEditRules.Format(WeeklyEditRules.WeekStartOf(DateOnly.FromDateTime(DateTime.UtcNow)));

        object Edit(int looks, bool published, string highStreetProduct) => new
        {
            segment = "women", weekStart, title = StoreSocialApiFactory.Text("Sonbahar katmanları", "Autumn layers"), published,
            sponsorName = StoreSocialApiFactory.Text("Örnek Marka", "Sample Brand"),
            looks = Enumerable.Range(1, looks).Select(day => new
            {
                day, title = StoreSocialApiFactory.Text($"Gün {day}", $"Day {day}"), styleNote = StoreSocialApiFactory.Text("Katmanlı giyin."),
                variants = new object[] { new { priceBand = "highStreet", productIds = new[] { highStreetProduct, high } }, new { priceBand = "luxuryTouch", productIds = new[] { luxury } } },
            }),
        };

        var none = await user.GetAsync("v1/content/edit/current");
        var incomplete = await admin.PutJsonAsync("v1/admin/edit/edit-test-week", Edit(5, true, high));
        var missingProduct = await admin.PutJsonAsync("v1/admin/edit/edit-test-week", Edit(7, true, "prod-unknown"));
        var draft = await admin.PutJsonAsync("v1/admin/edit/edit-test-week", Edit(5, false, high));
        var stillNone = await user.GetAsync("v1/content/edit/current");
        var published = await admin.PutJsonAsync("v1/admin/edit/edit-test-week", Edit(7, true, high));
        var current = await (await user.GetAsync("v1/content/edit/current")).JsonAsync();
        var byId = await user.GetAsync("v1/content/edit/edit-test-week");
        var retired = await admin.DeleteAsync("v1/admin/edit/edit-test-week");

        Assert.Equal(HttpStatusCode.NotFound, none.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, incomplete.StatusCode);
        Assert.Equal("looks_must_be_seven", (await incomplete.JsonAsync()).GetProperty("errors").GetProperty("looks")[0].GetString());
        Assert.Equal("product_not_found", await missingProduct.CodeAsync());
        Assert.Equal(HttpStatusCode.OK, draft.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, stillNone.StatusCode);                   // drafts are never served
        Assert.Equal(HttpStatusCode.OK, published.StatusCode);

        Assert.Equal("edit-test-week", current.GetProperty("id").GetString());
        Assert.Equal("Sonbahar katmanları", current.GetProperty("title").GetString());
        Assert.True(current.GetProperty("sponsored").GetBoolean());
        Assert.Equal("Örnek Marka", current.GetProperty("sponsorName").GetString());
        Assert.Equal(7, current.GetProperty("looks").GetArrayLength());
        var firstLook = current.GetProperty("looks")[0];
        Assert.Equal(1, firstLook.GetProperty("day").GetInt32());
        Assert.Equal("highStreet", firstLook.GetProperty("variants")[0].GetProperty("priceBand").GetString());
        Assert.Equal(200_000, firstLook.GetProperty("variants")[0].GetProperty("totalMinor").GetInt64());
        Assert.Equal(800_000, firstLook.GetProperty("variants")[1].GetProperty("totalMinor").GetInt64());
        Assert.Equal("TRY", firstLook.GetProperty("variants")[1].GetProperty("currency").GetString());
        Assert.Equal(HttpStatusCode.OK, byId.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, retired.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await user.GetAsync("v1/content/edit/edit-test-week")).StatusCode);
    }
}

public class CartAndAffiliateEndpointTests(StoreSocialApiFactory factory) : IClassFixture<StoreSocialApiFactory>
{
    [Fact]
    public async Task Cart_GroupedByBrand_Totals_IdempotentAdd_Validation_Delete()
    {
        var admin = await factory.AdminAsync();
        var brandA = await factory.SeedBrandAsync(admin);
        var brandB = await factory.SeedBrandAsync(admin);
        var shirt = await factory.SeedProductAsync(admin, brandA, 100_000);
        var skirt = await factory.SeedProductAsync(admin, brandA, 250_000, ProductCategory.Skirt);
        var bag = await factory.SeedProductAsync(admin, brandB, 400_000, ProductCategory.Bag, sizes: []);
        var (user, _) = await factory.RegisterAsync();

        var added = await user.PostJsonAsync("v1/tenant/cart/line", new
        {
            lines = new object[]
            {
                new { productId = shirt, size = "m", look = new { kind = "edit", id = "edit-1" } },
                new { productId = skirt, size = "S" },
                new { productId = bag },
            },
        });
        var again = await user.PostJsonAsync("v1/tenant/cart/line", new { lines = new[] { new { productId = shirt, size = "M" } } });
        var badSize = await user.PostJsonAsync("v1/tenant/cart/line", new { lines = new[] { new { productId = shirt, size = "XXL" } } });
        var unknown = await user.PostJsonAsync("v1/tenant/cart/line", new { lines = new[] { new { productId = "prod-unknown", size = "M" } } });
        var empty = await user.PostJsonAsync("v1/tenant/cart/line", new { lines = Array.Empty<object>() });
        var cart = await again.JsonAsync();

        Assert.Equal(HttpStatusCode.OK, added.StatusCode);
        Assert.Equal(3, cart.GetProperty("lineCount").GetInt32());                     // re-adding kept one line
        Assert.Equal(750_000, cart.GetProperty("totalMinor").GetInt64());
        Assert.Equal("TRY", cart.GetProperty("currency").GetString());
        var groups = cart.GetProperty("groups").EnumerateArray().ToDictionary(g => g.GetProperty("brandId").GetString()!);
        Assert.Equal(350_000, groups[brandA].GetProperty("subtotalMinor").GetInt64());
        Assert.Equal(400_000, groups[brandB].GetProperty("subtotalMinor").GetInt64());
        Assert.Equal("ONE", groups[brandB].GetProperty("lines")[0].GetProperty("size").GetString());
        var shirtLine = groups[brandA].GetProperty("lines").EnumerateArray().Single(l => l.GetProperty("product").GetProperty("id").GetString() == shirt);
        Assert.Equal("edit", shirtLine.GetProperty("look").GetProperty("kind").GetString());
        Assert.Equal("size_not_available", await badSize.CodeAsync());
        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, empty.StatusCode);

        var lineId = shirtLine.GetProperty("lineId").GetString();
        Assert.Equal(HttpStatusCode.NoContent, (await user.DeleteAsync($"v1/tenant/cart/line/{lineId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await user.DeleteAsync($"v1/tenant/cart/line/{lineId}")).StatusCode);
        Assert.Equal(650_000, (await (await user.GetAsync("v1/tenant/cart")).JsonAsync()).GetProperty("totalMinor").GetInt64());

        // Prices are read from the current catalog, never stored on the line.
        (await admin.PutJsonAsync($"v1/admin/product/{skirt}", new { brandId = brandA, name = StoreSocialApiFactory.Text("Etek"), category = "skirt", sizes = new[] { "S" }, priceMinor = 200_000, priceBand = "highStreet" })).EnsureSuccessStatusCode();
        Assert.Equal(600_000, (await (await user.GetAsync("v1/tenant/cart")).JsonAsync()).GetProperty("totalMinor").GetInt64());
    }

    [Fact]
    public async Task WatchList_PriceDropIsFlaggedWhenTheProductPriceIsUpdated()
    {
        var admin = await factory.AdminAsync();
        var brand = await factory.SeedBrandAsync(admin);
        var product = await factory.SeedProductAsync(admin, brand, 300_000);
        var (user, auth) = await factory.RegisterAsync();
        object Update(long price) => new { brandId = brand, name = StoreSocialApiFactory.Text("Gömlek"), category = "shirt", sizes = new[] { "M" }, priceMinor = price, priceBand = "highStreet" };

        var watched = await user.PutJsonAsync($"v1/tenant/watch-list/{product}", new { size = "M" });
        var before = await (await user.GetAsync("v1/tenant/watch-list")).JsonAsync();
        var raised = await (await admin.PutJsonAsync($"v1/admin/product/{product}", Update(320_000))).JsonAsync();
        var dropped = await (await admin.PutJsonAsync($"v1/admin/product/{product}", Update(240_000))).JsonAsync();
        var after = await (await user.GetAsync("v1/tenant/watch-list")).JsonAsync();
        var stored = await factory.Repository.GetAsync<WatchItemEntity>(WatchItemEntity.GetPk(auth.TenantId), WatchItemEntity.GetSk(product));

        Assert.Equal(HttpStatusCode.OK, watched.StatusCode);
        Assert.False(before[0].GetProperty("priceDropped").GetBoolean());
        Assert.False(raised.GetProperty("priceDropped").GetBoolean());
        Assert.True(dropped.GetProperty("priceDropped").GetBoolean());
        Assert.Equal(1, dropped.GetProperty("watchersFlagged").GetInt32());
        Assert.True(after[0].GetProperty("priceDropped").GetBoolean());
        Assert.Equal(60_000, after[0].GetProperty("dropMinor").GetInt64());
        Assert.Equal(240_000, after[0].GetProperty("currentPriceMinor").GetInt64());
        Assert.True(stored!.PriceDropped && stored.NotifyPending);
        Assert.Equal(240_000, stored.DroppedToMinor);

        Assert.Equal(HttpStatusCode.NotFound, (await user.PutJsonAsync("v1/tenant/watch-list/prod-unknown", new { })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await user.DeleteAsync($"v1/tenant/watch-list/{product}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await user.DeleteAsync($"v1/tenant/watch-list/{product}")).StatusCode);
        Assert.Empty(await factory.Repository.GetKeysAsync(ProductWatcherEntity.GetPk(product)));
    }

    [Fact]
    public async Task Checkout_Postback_RevenueReport_PurchasePrompt_Funnel()
    {
        var admin = await factory.AdminAsync();
        var brand = await factory.SeedBrandAsync(admin);
        var product = await factory.SeedProductAsync(admin, brand, 250_000);
        var (user, auth) = await factory.RegisterAsync();
        var anonymous = factory.CreateClient();

        var emptyCart = await user.PostAsync($"v1/tenant/cart/checkout/{brand}", null);
        (await user.PostJsonAsync("v1/tenant/cart/line", new { lines = new[] { new { productId = product, size = "M", look = new { kind = "edit", id = "edit-9" } } } })).EnsureSuccessStatusCode();
        var checkout = await (await user.PostAsync($"v1/tenant/cart/checkout/{brand}", null)).JsonAsync();
        var clickId = checkout.GetProperty("clickId").GetString()!;
        var order = StoreSocialApiFactory.Unique("ORD-");
        object Body(string status, long amount = 250_000) => new { clickId, orderId = order, amountMinor = amount, currency = "TRY", status };

        var recorded = await anonymous.SendAsync(StoreSocialApiFactory.SignedPostback("network", Body("pending"), StoreSocialApiFactory.NetworkSecret));
        var duplicate = await anonymous.SendAsync(StoreSocialApiFactory.SignedPostback("network", Body("pending"), StoreSocialApiFactory.NetworkSecret));
        var updated = await anonymous.SendAsync(StoreSocialApiFactory.SignedPostback("network", Body("approved"), StoreSocialApiFactory.NetworkSecret));
        var badSignature = await anonymous.SendAsync(StoreSocialApiFactory.SignedPostback("network", Body("approved"), "wrong-secret"));
        var unsigned = await anonymous.PostJsonAsync("v1/affiliate/postback/network", Body("approved"));
        var unknownClick = await anonymous.SendAsync(StoreSocialApiFactory.SignedPostback("network",
            new { clickId = Domain.Extensions.Ulid.New(), orderId = "ORD-X", amountMinor = 1, status = "pending" }, StoreSocialApiFactory.NetworkSecret));
        var unknownSource = await anonymous.SendAsync(StoreSocialApiFactory.SignedPostback("partner", Body("approved"), StoreSocialApiFactory.NetworkSecret));

        Assert.Equal("cart_empty", await emptyCart.CodeAsync());
        Assert.Equal("network", checkout.GetProperty("source").GetString());
        Assert.Equal($"https://shop.example/p?utm=x&click_id={clickId}", checkout.GetProperty("url").GetString());
        Assert.Equal("recorded", (await recorded.JsonAsync()).GetProperty("outcome").GetString());
        Assert.Equal("duplicate", (await duplicate.JsonAsync()).GetProperty("outcome").GetString());
        Assert.Equal("updated", (await updated.JsonAsync()).GetProperty("outcome").GetString());
        Assert.Equal(HttpStatusCode.Unauthorized, badSignature.StatusCode);
        Assert.Equal("invalid_signature", await badSignature.CodeAsync());
        Assert.Equal(HttpStatusCode.Unauthorized, unsigned.StatusCode);
        Assert.Equal("click_not_found", await unknownClick.CodeAsync());
        Assert.Equal(HttpStatusCode.NotFound, unknownSource.StatusCode);

        // Exactly one conversion, linked to the user and the look, with commission from config (800 bps).
        var conversions = await factory.Repository.GetAllAsync<AffiliateConversionEntity>(AffiliateConversionEntity.GetPk(auth.TenantId));
        var conversion = Assert.Single(conversions);
        Assert.Equal((250_000L, 20_000L, AffiliateConversionStatus.Approved), (conversion.AmountMinor, conversion.CommissionMinor, conversion.Status));
        Assert.Equal((LookRefKind.Edit, "edit-9"), (conversion.LookKind, conversion.LookId));

        var report = await (await admin.GetAsync("v1/admin/report/revenue")).JsonAsync();
        var byBrand = report.GetProperty("byBrand").EnumerateArray().Single(b => b.GetProperty("key").GetString() == brand);
        Assert.Equal((1, 250_000L, 20_000L), (byBrand.GetProperty("conversions").GetInt32(), byBrand.GetProperty("gmvMinor").GetInt64(), byBrand.GetProperty("commissionMinor").GetInt64()));
        Assert.Contains(report.GetProperty("byLook").EnumerateArray(), b => b.GetProperty("key").GetString() == "edit:edit-9" && b.GetProperty("gmvMinor").GetInt64() == 250_000);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.GetAsync("v1/admin/report/revenue?from=2026-12-01&to=2026-11-01")).StatusCode);

        // "Gardıroba ekleyelim mi?"
        var prompts = await (await user.GetAsync("v1/tenant/purchase-prompt")).JsonAsync();
        var prompt = Assert.Single(prompts.EnumerateArray());
        Assert.Equal(product, prompt.GetProperty("products")[0].GetProperty("id").GetString());
        var promptUrl = $"v1/tenant/purchase-prompt/{prompt.GetProperty("id").GetString()}";
        var accepted = await user.PutJsonAsync(promptUrl, new { accepted = true });
        var acceptedAgain = await user.PutJsonAsync(promptUrl, new { accepted = true });
        Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);
        Assert.Equal("created", (await accepted.JsonAsync()).GetProperty("items")[0].GetProperty("outcome").GetString());
        Assert.Equal("alreadyApplied", (await acceptedAgain.JsonAsync()).GetProperty("items")[0].GetProperty("outcome").GetString());
        Assert.Equal(0, (await (await user.GetAsync("v1/tenant/purchase-prompt")).JsonAsync()).GetArrayLength());
        // The purchased piece is in the wardrobe exactly once, as a "purchase" item pointing at the product.
        var wardrobe = await (await user.GetAsync("v1/tenant/item")).JsonAsync();
        var bought = Assert.Single(wardrobe.EnumerateArray());
        Assert.Equal((product, "purchase"), (bought.GetProperty("productId").GetString(), bought.GetProperty("source").GetString()));

        // The revenue funnel is recorded by the server, not trusted from the client.
        var funnel = await (await admin.GetAsync("v1/admin/report/funnel")).JsonAsync();
        long Events(string name) => funnel.GetProperty("steps").EnumerateArray().Single(s => s.GetProperty("name").GetString() == name).GetProperty("events").GetInt64();
        Assert.True(Events("add_to_cart") >= 1 && Events("brand_site_opened") >= 1 && Events("conversion") >= 1);
    }

    [Fact]
    public async Task DirectBrand_ProductCheckout_UsesBrandParameter_AndDirectSecret_GetVariantUsesSharedKey()
    {
        var admin = await factory.AdminAsync();
        var direct = await factory.SeedBrandAsync(admin, AffiliateSource.Direct, clickIdParameter: "subid", commissionRateBps: 1200);
        var network = await factory.SeedBrandAsync(admin);
        var directProduct = await factory.SeedProductAsync(admin, direct, 500_000, affiliateUrl: "https://direct.example/p/1");
        var networkProduct = await factory.SeedProductAsync(admin, network, 100_000);
        var noLink = await factory.SeedProductAsync(admin, network, 100_000, affiliateUrl: null);
        var (user, auth) = await factory.RegisterAsync();
        var anonymous = factory.CreateClient();

        var directCheckout = await (await user.PostJsonAsync($"v1/tenant/catalog/product/{directProduct}/checkout", new { look = new { kind = "user", id = "LOOK1" } })).JsonAsync();
        var networkCheckout = await (await user.PostAsync($"v1/tenant/catalog/product/{networkProduct}/checkout", null)).JsonAsync();
        var missingLink = await user.PostAsync($"v1/tenant/catalog/product/{noLink}/checkout", null);
        var directClick = directCheckout.GetProperty("clickId").GetString()!;
        var networkClick = networkCheckout.GetProperty("clickId").GetString()!;

        var wrongSecret = await anonymous.SendAsync(StoreSocialApiFactory.SignedPostback("direct", new { clickId = directClick, orderId = "D-1", amountMinor = 500_000, status = "approved" }, StoreSocialApiFactory.NetworkSecret));
        var directOk = await anonymous.SendAsync(StoreSocialApiFactory.SignedPostback("direct", new { clickId = directClick, orderId = "D-1", amountMinor = 500_000, status = "approved" }, StoreSocialApiFactory.DirectSecret));
        var getBadKey = await anonymous.GetAsync($"v1/affiliate/postback/network?clickId={networkClick}&orderId=N-1&amountMinor=100000&status=approved&key=nope");
        var getOk = await anonymous.GetAsync($"v1/affiliate/postback/network?clickId={networkClick}&orderId=N-1&amountMinor=100000&status=approved&key={StoreSocialApiFactory.NetworkSecret}");
        var getAgain = await anonymous.GetAsync($"v1/affiliate/postback/network?clickId={networkClick}&orderId=N-1&amountMinor=100000&status=approved&key={StoreSocialApiFactory.NetworkSecret}");

        Assert.Equal("direct", directCheckout.GetProperty("source").GetString());
        Assert.Equal($"https://direct.example/p/1?subid={directClick}", directCheckout.GetProperty("url").GetString());
        Assert.Equal("affiliate_link_missing", await missingLink.CodeAsync());
        Assert.Equal(HttpStatusCode.Unauthorized, wrongSecret.StatusCode);
        Assert.Equal("recorded", (await directOk.JsonAsync()).GetProperty("outcome").GetString());
        Assert.Equal(HttpStatusCode.Unauthorized, getBadKey.StatusCode);
        Assert.Equal("recorded", (await getOk.JsonAsync()).GetProperty("outcome").GetString());
        Assert.Equal("duplicate", (await getAgain.JsonAsync()).GetProperty("outcome").GetString());

        var conversions = await factory.Repository.GetAllAsync<AffiliateConversionEntity>(AffiliateConversionEntity.GetPk(auth.TenantId));
        var directConversion = conversions.Single(c => c.Source == AffiliateSource.Direct);
        Assert.Equal(60_000, directConversion.CommissionMinor);                      // brand override: 1200 bps
        Assert.Equal((LookRefKind.User, "LOOK1"), (directConversion.LookKind, directConversion.LookId));
        Assert.Equal(8_000, conversions.Single(c => c.Source == AffiliateSource.Network).CommissionMinor);
    }

    [Fact]
    public async Task WardrobeMatch_And_CompleteMyPiece_UseTheCallersWardrobe()
    {
        var admin = await factory.AdminAsync();
        var brand = await factory.SeedBrandAsync(admin);
        var redSkirt = await factory.SeedProductAsync(admin, brand, 200_000, ProductCategory.Skirt, ["red"], ["M"]);
        var shoes = await factory.SeedProductAsync(admin, brand, 300_000, ProductCategory.Shoes, ["white"], ["38"]);
        var (user, auth) = await factory.RegisterAsync();
        factory.Closet.AddItem(auth.TenantId, "white-shirt", ItemCategory.Top, "white");
        factory.Closet.AddItem(auth.TenantId, "green-top", ItemCategory.Top, "green");
        factory.Closet.AddItem(auth.TenantId, "black-jeans", ItemCategory.Bottom, "black");

        var match = await (await user.GetAsync($"v1/tenant/catalog/product/{redSkirt}/match")).JsonAsync();
        var complete = await (await user.PostJsonAsync("v1/tenant/catalog/complete", new { itemIds = new[] { "white-shirt" }, priceBand = "highStreet", size = "M" })).JsonAsync();
        var slots = complete.GetProperty("slots").EnumerateArray().ToDictionary(s => s.GetProperty("slot").GetString()!, s => s.GetProperty("products").EnumerateArray().Select(p => p.GetProperty("id").GetString()).ToArray());

        Assert.Equal(1, match.GetProperty("compatibleCount").GetInt32());
        Assert.Equal("white-shirt", match.GetProperty("items")[0].GetProperty("id").GetString());
        Assert.Contains(redSkirt, slots["bottom"]);
        Assert.Contains(shoes, slots["shoes"]);
        Assert.False(slots.ContainsKey("top"));
        Assert.Equal(HttpStatusCode.NotFound, (await user.GetAsync("v1/tenant/catalog/product/prod-unknown/match")).StatusCode);
    }

    [Fact]
    public async Task FavoriteProducts_AreIdempotent_NewestFirst_AndSeparateFromTheWatchList()
    {
        var admin = await factory.AdminAsync();
        var brand = await factory.SeedBrandAsync(admin);
        var first = await factory.SeedProductAsync(admin, brand);
        var second = await factory.SeedProductAsync(admin, brand);
        var retired = await factory.SeedProductAsync(admin, brand);
        (await admin.DeleteAsync($"v1/admin/product/{retired}")).EnsureSuccessStatusCode();
        var (user, auth) = await factory.RegisterAsync();
        var (other, _) = await factory.RegisterAsync();

        async Task<List<string>> IdsAsync(HttpClient client) =>
            (await (await client.GetAsync("v1/tenant/favorite/product")).JsonAsync()).GetProperty("productIds").EnumerateArray().Select(e => e.GetString()!).ToList();

        var empty = await IdsAsync(user);
        var put = await user.PutAsync($"v1/tenant/favorite/product/{first}", null);
        await Task.Delay(5);
        var putSecond = await user.PutAsync($"v1/tenant/favorite/product/{second}", null);
        var again = await user.PutAsync($"v1/tenant/favorite/product/{first}", null);
        var unknown = await user.PutAsync("v1/tenant/favorite/product/prod-unknown", null);
        var onRetired = await user.PutAsync($"v1/tenant/favorite/product/{retired}", null);
        var ids = await IdsAsync(user);

        Assert.Empty(empty);
        Assert.Equal(HttpStatusCode.NoContent, put.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, putSecond.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, again.StatusCode);
        Assert.Equal((HttpStatusCode.NotFound, "product_not_found"), (unknown.StatusCode, await unknown.CodeAsync()));
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "product_retired"), (onRetired.StatusCode, await onRetired.CodeAsync()));
        Assert.Equal([second, first], ids);
        Assert.Empty(await IdsAsync(other)); // another user's list is untouched
        Assert.Empty((await (await user.GetAsync("v1/tenant/watch-list")).JsonAsync()).EnumerateArray()); // not the watch list
        Assert.Equal(2, (await factory.Repository.GetKeysAsync(FavoriteProductEntity.GetPk(auth.TenantId))).Count);

        Assert.Equal(HttpStatusCode.NoContent, (await user.DeleteAsync($"v1/tenant/favorite/product/{first}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await user.DeleteAsync($"v1/tenant/favorite/product/{first}")).StatusCode); // idempotent
        Assert.Equal([second], await IdsAsync(user));
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().GetAsync("v1/tenant/favorite/product")).StatusCode);
    }

    [Fact]
    public async Task FavoriteProducts_AFavouriteStaysWhenTheProductIsRetired_AndTheListHasALimit()
    {
        var admin = await factory.AdminAsync();
        var brand = await factory.SeedBrandAsync(admin);
        var product = await factory.SeedProductAsync(admin, brand);
        var extra = await factory.SeedProductAsync(admin, brand);
        var (user, auth) = await factory.RegisterAsync();

        (await user.PutAsync($"v1/tenant/favorite/product/{product}", null)).EnsureSuccessStatusCode();
        (await admin.DeleteAsync($"v1/admin/product/{product}")).EnsureSuccessStatusCode();
        var replay = await user.PutAsync($"v1/tenant/favorite/product/{product}", null);
        var listed = (await (await user.GetAsync("v1/tenant/favorite/product")).JsonAsync()).GetProperty("productIds");

        var max = new Domain.Options.CatalogOptions().MaxFavoriteProducts;
        for (var i = 1; i < max; i++)
            await factory.Repository.SaveAsync(new FavoriteProductEntity { TenantId = auth.TenantId, ProductId = $"filler-{i}", AddedAt = DateTime.UtcNow });
        var full = await user.PutAsync($"v1/tenant/favorite/product/{extra}", null);

        Assert.Equal(HttpStatusCode.NoContent, replay.StatusCode);
        Assert.Equal(product, listed[0].GetString());
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "favorite_list_full"), (full.StatusCode, await full.CodeAsync()));
    }
}
