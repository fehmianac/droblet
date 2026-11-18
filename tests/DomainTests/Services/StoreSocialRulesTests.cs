using System.Text;
using Domain.Entity;
using Domain.Enum;
using Domain.Options;
using Domain.Services;
using Domain.Validation;
using Microsoft.Extensions.Options;

namespace DomainTests.Services;

internal static class Sample
{
    public static readonly DateTime Now = new(2026, 11, 18, 9, 0, 0, DateTimeKind.Utc);

    public static Dictionary<string, string> Text(string tr, string? en = null) =>
        en is null ? new() { ["tr"] = tr } : new() { ["tr"] = tr, ["en"] = en };

    public static CatalogProductEntity Product(string id, ProductCategory category = ProductCategory.Shirt, string brand = "brand-a",
        long price = 1000, PriceBand band = PriceBand.HighStreet, string[]? colors = null, string[]? sizes = null, int ageDays = 0, bool retired = false,
        string? tr = null, string? en = null) => new()
    {
        Id = id, BrandId = brand, Name = Text(tr ?? id, en), Category = category, PriceMinor = price, PriceBand = band,
        Colors = (colors ?? ["black"]).ToList(), Sizes = (sizes ?? ["S", "M"]).ToList(), CreatedAt = Now.AddDays(-ageDays), Retired = retired,
    };

    public static IOptions<LocalizationOptions> Localization => Options.Create(new LocalizationOptions());
}

public class CatalogRulesTests
{
    private static readonly CatalogProductEntity[] Products =
    [
        Sample.Product("p-old", ProductCategory.Shirt, "brand-a", 3000, ageDays: 5, tr: "Keten Gömlek", en: "Linen Shirt"),
        Sample.Product("p-new", ProductCategory.Dress, "brand-b", 9000, PriceBand.LuxuryTouch, ["red"], ["M"], ageDays: 1, tr: "İpek Elbise", en: "Silk Dress"),
        Sample.Product("p-mid", ProductCategory.Shirt, "brand-b", 2000, colors: ["white", "navy"], sizes: ["L"], ageDays: 3, tr: "Çizgili Gömlek"),
        Sample.Product("p-gone", ProductCategory.Shirt, "brand-a", 1, retired: true),
    ];

    private static string[] Ids(CatalogQuery query) => CatalogRules.Query(Products, query, null, 50).Items.Select(p => p.Id).ToArray();

    [Fact]
    public void Query_DefaultSortIsNewestFirst_AndRetiredNeverListed() =>
        Assert.Equal(["p-new", "p-mid", "p-old"], Ids(new CatalogQuery()));

    [Fact]
    public void Query_Filters_CategoryBrandColorSizeBand()
    {
        Assert.Equal(["p-mid", "p-old"], Ids(new CatalogQuery(Category: ProductCategory.Shirt)));
        Assert.Equal(["p-new", "p-mid"], Ids(new CatalogQuery(BrandId: "brand-b")));
        Assert.Equal(["p-mid"], Ids(new CatalogQuery(Color: "NAVY")));
        Assert.Equal(["p-mid"], Ids(new CatalogQuery(Size: "l")));
        Assert.Equal(["p-new"], Ids(new CatalogQuery(PriceBand: PriceBand.LuxuryTouch)));
        Assert.Empty(Ids(new CatalogQuery(Category: ProductCategory.Shirt, Color: "red")));
    }

    [Theory]
    [InlineData("gömlek", new[] { "p-mid", "p-old" })]
    [InlineData("GOMLEK", new[] { "p-mid", "p-old" })]   // Turkish letters folded
    [InlineData("ipek elbise", new[] { "p-new" })]
    [InlineData("silk", new[] { "p-new" })]               // every stored language is searched
    [InlineData("beymen", new[] { "p-new", "p-mid" })]    // brand name
    [InlineData("kaşmir", new string[0])]
    public void Query_TextSearch(string text, string[] expected)
    {
        var brands = new Dictionary<string, string> { ["brand-a"] = "Vakko", ["brand-b"] = "Beymen" };
        Assert.Equal(expected, CatalogRules.Query(Products, new CatalogQuery(Text: text), null, 50, brands).Items.Select(p => p.Id).ToArray());
    }

    [Fact]
    public void Query_PriceSorts()
    {
        Assert.Equal(["p-mid", "p-old", "p-new"], Ids(new CatalogQuery(Sort: ProductSort.PriceAsc)));
        Assert.Equal(["p-new", "p-old", "p-mid"], Ids(new CatalogQuery(Sort: ProductSort.PriceDesc)));
    }

    [Fact]
    public void Page_CursorWalksTheWholeListOnce_AndGarbageTokenRestarts()
    {
        var sorted = CatalogRules.Sort(Enumerable.Range(0, 7).Select(i => Sample.Product($"p{i}", ageDays: i)), ProductSort.Newest);
        var seen = new List<string>();
        string? token = null;
        do
        {
            var page = CatalogRules.Page(sorted, token, 3);
            Assert.Equal(7, page.Total);
            seen.AddRange(page.Items.Select(p => p.Id));
            token = page.PageToken;
        } while (token is not null);

        Assert.Equal(sorted.Select(p => p.Id), seen);
        Assert.Equal("p0", CatalogRules.Page(sorted, "%%%not-base64", 3).Items[0].Id);
        Assert.Equal("p0", CatalogRules.Page(sorted, CatalogRules.EncodeToken("deleted-product"), 3).Items[0].Id);
    }

    [Theory]
    [InlineData(1000, 900, true)]
    [InlineData(1000, 1000, false)]
    [InlineData(1000, 1100, false)]
    [InlineData(1000, 0, false)]
    public void IsPriceDrop(long previous, long current, bool expected) => Assert.Equal(expected, CatalogRules.IsPriceDrop(previous, current));

    [Fact]
    public void SlotOf_CoversEveryCategory()
    {
        Assert.All(Enum.GetValues<ProductCategory>(), c => Assert.True(Enum.IsDefined(CatalogRules.SlotOf(c))));
        Assert.Equal(ProductSlot.OnePiece, CatalogRules.SlotOf(ProductCategory.Dress));
        Assert.Equal(ProductSlot.Outerwear, CatalogRules.SlotOf(ProductCategory.Coat));
        Assert.Equal(ProductSlot.Bottom, CatalogRules.SlotOf(ProductCategory.Jeans));
    }
}

public class WeeklyEditRulesTests
{
    private static WeeklyEditEntity Edit(string id, string weekStart, bool published = true, bool retired = false, Segment segment = Segment.Women) =>
        new() { Id = id, WeekStart = weekStart, Published = published, Retired = retired, Segment = segment, Title = Sample.Text(id) };

    [Fact]
    public void WeekStartOf_IsMonday()
    {
        Assert.Equal(new DateOnly(2026, 11, 16), WeeklyEditRules.WeekStartOf(new DateOnly(2026, 11, 18))); // Wednesday
        Assert.Equal(new DateOnly(2026, 11, 16), WeeklyEditRules.WeekStartOf(new DateOnly(2026, 11, 16))); // Monday
        Assert.Equal(new DateOnly(2026, 11, 16), WeeklyEditRules.WeekStartOf(new DateOnly(2026, 11, 22))); // Sunday
        Assert.True(WeeklyEditRules.IsWeekStart("2026-11-16"));
        Assert.False(WeeklyEditRules.IsWeekStart("2026-11-17"));
        Assert.False(WeeklyEditRules.IsWeekStart("16.11.2026"));
    }

    [Fact]
    public void PickCurrent_LatestPublishedStartedEditOfTheSegment()
    {
        var edits = new[]
        {
            Edit("last-week", "2026-11-09"), Edit("this-week", "2026-11-16"), Edit("next-week", "2026-11-23"),
            Edit("draft", "2026-11-16", published: false), Edit("retired", "2026-11-16", retired: true), Edit("men", "2026-11-16", segment: Segment.Men),
        };

        Assert.Equal("this-week", WeeklyEditRules.PickCurrent(edits, new DateOnly(2026, 11, 18), Segment.Women)!.Id);
        Assert.Equal("last-week", WeeklyEditRules.PickCurrent(edits, new DateOnly(2026, 11, 15), Segment.Women)!.Id);
        Assert.Null(WeeklyEditRules.PickCurrent(edits, new DateOnly(2026, 11, 1), Segment.Women));
    }

    [Fact]
    public void IsSponsored_ByBrandOrName()
    {
        Assert.False(WeeklyEditRules.IsSponsored(Edit("a", "2026-11-16")));
        var withBrand = Edit("b", "2026-11-16"); withBrand.SponsorBrandId = "brand-a";
        var withName = Edit("c", "2026-11-16"); withName.SponsorName = Sample.Text("Marka");
        Assert.True(WeeklyEditRules.IsSponsored(withBrand));
        Assert.True(WeeklyEditRules.IsSponsored(withName));
    }
}

public class WardrobeMatchRulesTests
{
    private static ClosetItem Item(string id, ProductCategory category, params string[] colors) => new(id, id, CatalogRules.ItemCategoryOf(category), colors);

    [Fact]
    public void Compatible_NeedsDifferentSlotAndHarmonisingColours()
    {
        var redSkirt = Sample.Product("skirt", ProductCategory.Skirt, colors: ["red"]);

        Assert.True(WardrobeMatchRules.IsCompatible(redSkirt, Item("white-shirt", ProductCategory.Shirt, "white")));   // neutral
        Assert.True(WardrobeMatchRules.IsCompatible(redSkirt, Item("red-top", ProductCategory.Blouse, "red")));         // shared colour
        Assert.False(WardrobeMatchRules.IsCompatible(redSkirt, Item("green-top", ProductCategory.Blouse, "green")));    // clash
        Assert.False(WardrobeMatchRules.IsCompatible(redSkirt, Item("black-jeans", ProductCategory.Jeans, "black")));   // same slot
        Assert.True(WardrobeMatchRules.IsCompatible(redSkirt, Item("unknown", ProductCategory.Shoes)));                 // unknown colour never blocks
    }

    [Fact]
    public void OnePiece_NeverCombinesWithTopOrBottom()
    {
        var dress = Sample.Product("dress", ProductCategory.Dress, colors: ["black"]);

        Assert.False(WardrobeMatchRules.IsCompatible(dress, Item("shirt", ProductCategory.Shirt, "white")));
        Assert.False(WardrobeMatchRules.IsCompatible(dress, Item("jeans", ProductCategory.Jeans, "denim")));
        Assert.True(WardrobeMatchRules.IsCompatible(dress, Item("coat", ProductCategory.Coat, "camel")));
        Assert.True(WardrobeMatchRules.IsCompatible(dress, Item("bag", ProductCategory.Bag, "red")));
    }

    [Fact]
    public void CompatibleItems_CountsOnlyMatches()
    {
        var product = Sample.Product("blazer", ProductCategory.Jacket, colors: ["navy"]);
        var items = new[] { Item("a", ProductCategory.Shirt, "white"), Item("b", ProductCategory.Jacket, "black"), Item("c", ProductCategory.Trousers, "pink") };

        Assert.Equal(["a", "c"], WardrobeMatchRules.CompatibleItems(product, items).Select(i => i.Id).ToArray()); // navy is neutral
    }

    [Fact]
    public void MissingSlots_DressFillsTopAndBottom()
    {
        Assert.Equal([ProductSlot.Bottom, ProductSlot.Outerwear, ProductSlot.Shoes, ProductSlot.Bag],
            WardrobeMatchRules.MissingSlots([Item("shirt", ProductCategory.Shirt, "white")]));
        Assert.Equal([ProductSlot.Outerwear, ProductSlot.Shoes, ProductSlot.Bag],
            WardrobeMatchRules.MissingSlots([Item("dress", ProductCategory.Dress, "black")]));
    }

    [Fact]
    public void Complete_OnlyMissingSlots_InBandAndSize_HarmonisingWithEverySelectedPiece()
    {
        var selected = new[] { Item("green-shirt", ProductCategory.Shirt, "green") };
        var candidates = new[]
        {
            Sample.Product("top", ProductCategory.Blouse),                                                         // slot already filled
            Sample.Product("black-trousers", ProductCategory.Trousers, colors: ["black"], sizes: ["M"]),
            Sample.Product("pink-skirt", ProductCategory.Skirt, colors: ["pink"], sizes: ["M"]),                   // clashes with green
            Sample.Product("black-trousers-l", ProductCategory.Trousers, colors: ["black"], sizes: ["L"]),         // wrong size
            Sample.Product("lux-coat", ProductCategory.Coat, band: PriceBand.LuxuryTouch, colors: ["camel"], sizes: ["M"]),
            Sample.Product("shoes", ProductCategory.Shoes, colors: ["white"], sizes: ["38"]),                      // shoe sizes are not clothing sizes
            Sample.Product("retired-bag", ProductCategory.Bag, retired: true),
        };

        var result = WardrobeMatchRules.Complete(selected, candidates, PriceBand.HighStreet, "m", perSlot: 5);

        Assert.Equal([ProductSlot.Bottom, ProductSlot.Shoes], result.Select(r => r.Slot).ToArray());
        Assert.Equal(["black-trousers"], result[0].Products.Select(p => p.Id).ToArray());
        Assert.Equal(["shoes"], result[1].Products.Select(p => p.Id).ToArray());
    }
}

public class StyleMatchRulesTests
{
    [Theory]
    [InlineData(new[] { StyleTag.Minimal, StyleTag.Classic, StyleTag.Boho }, new[] { StyleTag.Minimal, StyleTag.Classic, StyleTag.Boho }, 100)]
    [InlineData(new[] { StyleTag.Minimal, StyleTag.Classic, StyleTag.Boho }, new[] { StyleTag.Boho, StyleTag.Minimal, StyleTag.Street }, 50)]
    [InlineData(new[] { StyleTag.Minimal, StyleTag.Classic, StyleTag.Boho }, new[] { StyleTag.Boho, StyleTag.Sporty, StyleTag.Street }, 20)]
    [InlineData(new[] { StyleTag.Minimal, StyleTag.Classic, StyleTag.Boho }, new[] { StyleTag.Vintage, StyleTag.Sporty, StyleTag.Street }, 0)]
    [InlineData(new[] { StyleTag.Minimal, StyleTag.Classic, StyleTag.Boho }, new StyleTag[0], 0)]
    public void Percent_IsJaccardOfStyleTags(StyleTag[] a, StyleTag[] b, int expected)
    {
        Assert.Equal(expected, StyleMatchRules.Percent(a, b));
        Assert.Equal(expected, StyleMatchRules.Percent(b, a)); // symmetric
    }

    [Fact]
    public void Percent_NullProfile_IsZero() => Assert.Equal(0, StyleMatchRules.Percent(null, [StyleTag.Minimal]));
}

public class AffiliateRulesTests
{
    [Theory]
    [InlineData("https://brand.example/p/1", "https://brand.example/p/1?click_id=C1")]
    [InlineData("https://brand.example/p/1?utm=x", "https://brand.example/p/1?utm=x&click_id=C1")]
    [InlineData("https://brand.example/p/1?click_id=old&utm=x", "https://brand.example/p/1?utm=x&click_id=C1")]
    [InlineData("https://brand.example/p/1?utm=x#details", "https://brand.example/p/1?utm=x&click_id=C1#details")]
    public void AppendClickId(string url, string expected) => Assert.Equal(expected, AffiliateLinkBuilder.AppendClickId(url, "click_id", "C1"));

    [Theory]
    [InlineData("https://a.example", true)]
    [InlineData("http://a.example", false)]
    [InlineData("javascript:alert(1)", false)]
    [InlineData(null, false)]
    public void IsHttpsUrl(string? url, bool expected) => Assert.Equal(expected, AffiliateLinkBuilder.IsHttpsUrl(url));

    [Fact]
    public void Signature_VerifiesExactBodyOnly()
    {
        var body = Encoding.UTF8.GetBytes("{\"orderId\":\"1\"}");
        var signature = PostbackSignature.Compute("secret", body);

        Assert.StartsWith("sha256=", signature);
        Assert.True(PostbackSignature.Verify("secret", body, signature));
        Assert.True(PostbackSignature.Verify("secret", body, signature.ToUpperInvariant().Replace("SHA256=", "sha256=")));
        Assert.False(PostbackSignature.Verify("other", body, signature));
        Assert.False(PostbackSignature.Verify("secret", Encoding.UTF8.GetBytes("{\"orderId\":\"2\"}"), signature));
        Assert.False(PostbackSignature.Verify("secret", body, null));
        Assert.False(PostbackSignature.Verify(null, body, signature));   // no secret configured = reject
        Assert.False(PostbackSignature.Verify("", body, PostbackSignature.Compute("", body)));
    }

    [Fact]
    public void SharedKey_ConstantTimeEquality_NoSecretRejects()
    {
        Assert.True(PostbackSignature.VerifySharedKey("k1", "k1"));
        Assert.False(PostbackSignature.VerifySharedKey("k1", "k2"));
        Assert.False(PostbackSignature.VerifySharedKey(null, "k1"));
        Assert.False(PostbackSignature.VerifySharedKey("k1", null));
    }

    [Fact]
    public void SecretFor_DirectPrefersBrandSecret()
    {
        var options = new AffiliatePostbackOptions { NetworkSecret = "n", DirectSecret = "d", DirectBrandSecrets = { ["vakko"] = "v" } };

        Assert.Equal("n", PostbackSignature.SecretFor(options, AffiliateSource.Network, "vakko"));
        Assert.Equal("v", PostbackSignature.SecretFor(options, AffiliateSource.Direct, "vakko"));
        Assert.Equal("d", PostbackSignature.SecretFor(options, AffiliateSource.Direct, "beymen"));
        Assert.Equal("d", PostbackSignature.SecretFor(options, AffiliateSource.Direct, null));
    }

    private static AffiliateConversionLedgerEntity Row(string order, string brand, long amount, long commission, AffiliateConversionStatus status,
        DateTime at, LookRefKind? lookKind = null, string? lookId = null, AffiliateSource source = AffiliateSource.Network) => new()
    {
        ExternalId = order, BrandId = brand, AmountMinor = amount, CommissionMinor = commission, Status = status, ReceivedAt = at,
        LookKind = lookKind, LookId = lookId, Source = source, Month = "2026-11", ClickId = "c",
    };

    [Fact]
    public void RevenueReport_TotalsByBrandLookSource_RejectedAddsNoMoney_RangeIsInclusive()
    {
        var rows = new[]
        {
            Row("1", "vakko", 100_000, 10_000, AffiliateConversionStatus.Approved, Sample.Now, LookRefKind.Edit, "e1", AffiliateSource.Direct),
            Row("2", "vakko", 50_000, 5_000, AffiliateConversionStatus.Pending, Sample.Now, LookRefKind.Edit, "e1", AffiliateSource.Direct),
            Row("3", "gap", 30_000, 2_100, AffiliateConversionStatus.Approved, Sample.Now.AddDays(-1), LookRefKind.User, "L9"),
            Row("4", "gap", 99_999, 9_999, AffiliateConversionStatus.Rejected, Sample.Now),
            Row("5", "gap", 77_777, 7_777, AffiliateConversionStatus.Approved, Sample.Now.AddDays(-40)), // out of range
        };

        var report = RevenueReportRules.Build(rows, new DateOnly(2026, 11, 17), new DateOnly(2026, 11, 18));

        Assert.Equal((3, 180_000L, 17_100L), (report.Conversions, report.GmvMinor, report.CommissionMinor));
        Assert.Equal((1, 2, 1), (report.Pending, report.Approved, report.Rejected));
        Assert.Equal([new RevenueBucket("vakko", 2, 150_000, 15_000), new RevenueBucket("gap", 1, 30_000, 2_100)], report.ByBrand);
        Assert.Equal([new RevenueBucket("edit:e1", 2, 150_000, 15_000), new RevenueBucket("user:L9", 1, 30_000, 2_100)], report.ByLook);
        Assert.Equal(["direct", "network"], report.BySource.Select(b => b.Key).ToArray());
    }

    [Fact]
    public void RevenueReport_CountsClicksPerDay_AndGroupsByNetwork()
    {
        var rows = new[]
        {
            Row("1", "vakko", 100_000, 10_000, AffiliateConversionStatus.Approved, Sample.Now, source: AffiliateSource.Direct),
            Row("2", "gap", 30_000, 2_100, AffiliateConversionStatus.Approved, Sample.Now.AddDays(-1)),
        };
        AffiliateClickLedgerEntity Click(string id, DateTime at) => new() { Month = "2026-11", ClickId = id, BrandId = "gap", CreatedAt = at };
        var clicks = new[] { Click("a", Sample.Now), Click("b", Sample.Now), Click("c", Sample.Now.AddDays(-1)), Click("d", Sample.Now.AddDays(-30)) };

        var report = RevenueReportRules.Build(rows, new DateOnly(2026, 11, 17), new DateOnly(2026, 11, 18), clicks: clicks,
            brandNetworks: new Dictionary<string, string?> { ["gap"] = "Admitad", ["vakko"] = null });

        Assert.Equal(3, report.Clicks);
        Assert.Equal(2, report.ByDay.Count);
        Assert.Equal(report.Clicks, report.ByDay.Sum(d => d.Clicks));
        Assert.Equal(report.Conversions, report.ByDay.Sum(d => d.Conversions));
        Assert.Equal(["direct", "admitad"], report.ByNetwork.Select(b => b.Key).ToArray());
    }
}

public class AnalyticsRulesTests
{
    private static AnalyticsEventInput Event(string? name, DateTime? at = null, Dictionary<string, string?>? props = null) => new(name, at, props);

    [Theory]
    [InlineData("paywall_viewed", null)]
    [InlineData("first_look_created", null)]
    [InlineData("credits_exhausted", null)]
    [InlineData(null, "name_required")]
    [InlineData("anything_else", "name_not_allowed")]
    [InlineData("conversion", "name_server_only")]
    [InlineData("add_to_cart", "name_server_only")]
    [InlineData("invited_install", "name_server_only")]
    public void Validate_NameAllowList(string? name, string? expected) => Assert.Equal(expected, AnalyticsRules.Validate(Event(name), Sample.Now));

    [Fact]
    public void Validate_RejectsPersonalOrFreeTextProperties()
    {
        string? Check(string key, string? value) => AnalyticsRules.Validate(Event("paywall_viewed", null, new() { [key] = value }), Sample.Now);

        Assert.Null(Check("source", "onboarding"));
        Assert.Null(Check("count", "3"));
        Assert.Equal("prop_not_allowed", Check("email", "a@b.co"));
        Assert.Equal("prop_not_allowed", Check("name", "Ayse"));
        Assert.Equal("prop_value_invalid", Check("source", "akşam iş yemeği"));   // free text
        Assert.Equal("prop_value_invalid", Check("source", "a@b.co"));
        Assert.Equal("prop_value_invalid", Check("source", null));
        Assert.Equal("prop_value_invalid", Check("source", new string('x', 65)));
    }

    [Fact]
    public void Validate_TimeWindowAndPropCount()
    {
        Assert.Null(AnalyticsRules.Validate(Event("paywall_viewed", Sample.Now.AddDays(-6)), Sample.Now));
        Assert.Equal("occurred_at_out_of_range", AnalyticsRules.Validate(Event("paywall_viewed", Sample.Now.AddDays(-8)), Sample.Now));
        Assert.Equal("occurred_at_out_of_range", AnalyticsRules.Validate(Event("paywall_viewed", Sample.Now.AddHours(1)), Sample.Now));
        var many = AnalyticsRules.AllowedProps.Take(9).ToDictionary(k => k, _ => (string?)"x");
        Assert.Equal("too_many_props", AnalyticsRules.Validate(Event("paywall_viewed", null, many), Sample.Now));
    }

    [Fact]
    public void ServerOnlyNames_AreInTheFunnel_AndNotClientAllowed()
    {
        Assert.Subset(AnalyticsRules.FunnelOrder.ToHashSet(), AnalyticsRules.ServerOnly.ToHashSet());
        Assert.Empty(AnalyticsRules.ClientAllowed.Intersect(AnalyticsRules.ServerOnly));
        Assert.Equal(AnalyticsRules.FunnelOrder.Count, AnalyticsRules.ClientAllowed.Count + AnalyticsRules.ServerOnly.Count);
    }

    [Fact]
    public void Entity_HasHashedActor_DayPartition_Ttl_AndNoTenantId()
    {
        var entity = AnalyticsRules.ToEntity("paywall_viewed", "tenant-1", Sample.Now, Sample.Now, new Dictionary<string, string?> { ["source"] = "home", ["platform"] = "ios" }, "E1");

        Assert.Equal("analytics#2026-11-18", entity.Pk);
        Assert.Equal(AnalyticsRules.Actor("tenant-1"), entity.Actor);
        Assert.NotEqual(AnalyticsRules.Actor("tenant-2"), entity.Actor);
        Assert.DoesNotContain("tenant-1", System.Text.Json.JsonSerializer.Serialize(entity));
        Assert.Equal("ios", entity.Platform);
        Assert.Equal(new Dictionary<string, string> { ["source"] = "home" }, entity.Props);
        Assert.Equal(new DateTimeOffset(Sample.Now.AddDays(400)).ToUnixTimeSeconds(), entity.Ttl);
    }

    [Fact]
    public void Funnel_CountsEventsAndDistinctActors_WithRates()
    {
        AnalyticsEventEntity E(string name, string tenant) => AnalyticsRules.ToEntity(name, tenant, Sample.Now, Sample.Now, null, Guid.NewGuid().ToString());
        var events = new[]
        {
            E("signup_started", "a"), E("signup_started", "b"), E("signup_started", "c"), E("signup_started", "d"),
            E("signup_completed", "a"), E("signup_completed", "b"),
            E("paywall_viewed", "a"), E("paywall_viewed", "a"), E("paywall_viewed", "b"),
            E("subscribed", "a"),
        };

        var report = AnalyticsRules.BuildFunnel(events, new DateOnly(2026, 11, 18), new DateOnly(2026, 11, 18));
        FunnelStep Step(string name) => report.Steps.Single(s => s.Name == name);

        Assert.Equal((10L, 4), (report.TotalEvents, report.TotalActors));
        Assert.Equal(AnalyticsRules.FunnelOrder, report.Steps.Select(s => s.Name));
        Assert.Equal((4L, 4), (Step("signup_started").Events, Step("signup_started").Actors));
        Assert.Null(Step("signup_started").RateFromFirst);
        Assert.Equal(0.5, Step("signup_completed").RateFromPrevious);
        Assert.Equal((3L, 2), (Step("paywall_viewed").Events, Step("paywall_viewed").Actors));
        Assert.Equal(0.5, Step("subscribed").RateFromPrevious);
        Assert.Equal(0.25, Step("subscribed").RateFromFirst);
        Assert.Null(Step("first_look_created").RateFromPrevious); // previous step had nobody
    }
}

public class InviteAndReminderRulesTests
{
    [Fact]
    public void InviteCode_GeneratedCodesAreValid_NormalisedCaseInsensitive()
    {
        var codes = Enumerable.Range(0, 200).Select(_ => InviteCodeRules.Generate()).ToList();

        Assert.All(codes, c => Assert.True(InviteCodeRules.IsValid(c)));
        Assert.True(codes.Distinct().Count() > 190);
        Assert.True(InviteCodeRules.IsValid(" " + codes[0].ToLowerInvariant() + " "));
        Assert.False(InviteCodeRules.IsValid("ABC"));
        Assert.False(InviteCodeRules.IsValid("ABCDEFG0"));  // 0 is not in the alphabet
        Assert.False(InviteCodeRules.IsValid(null));
    }

    [Fact]
    public void InviteLink_CarriesCodeAndTarget()
    {
        Assert.Equal("https://droblet.alatech.co/i/ABCDEFGH", InviteCodeRules.Link("https://droblet.alatech.co/i/", "ABCDEFGH"));
        Assert.Equal("https://droblet.alatech.co/i/ABCDEFGH?t=look&id=L1&u=ayse",
            InviteCodeRules.Link("https://droblet.alatech.co/i", "ABCDEFGH", ShareTargetKind.Look, "L1", "ayse"));
    }

    [Theory]
    [InlineData("inviter", false, 1, InviteAttributionDecision.Attribute)]
    [InlineData(null, false, 1, InviteAttributionDecision.CodeNotFound)]
    [InlineData("me", false, 1, InviteAttributionDecision.Self)]
    [InlineData("inviter", true, 1, InviteAttributionDecision.AlreadyAttributed)]
    [InlineData("inviter", false, 31, InviteAttributionDecision.WindowClosed)]
    public void InviteAttribution_OncePerNewAccount_NeverSelf(string? inviter, bool already, int accountAgeDays, InviteAttributionDecision expected) =>
        Assert.Equal(expected, InviteCodeRules.Decide("me", inviter, already, Sample.Now.AddDays(-accountAgeDays), Sample.Now, 30));

    [Theory]
    [InlineData("07:30", true)]
    [InlineData("23:45", true)]
    [InlineData("07:10", false)]
    [InlineData("7:30", false)]
    [InlineData("24:00", false)]
    [InlineData(null, false)]
    public void Reminder_LocalTimeIsQuarterHour(string? value, bool expected) => Assert.Equal(expected, ReminderRules.IsValidLocalTime(value));

    [Fact]
    public void Reminder_TimeZoneMustBeKnown()
    {
        Assert.True(ReminderRules.IsValidTimeZone("Europe/Istanbul"));
        Assert.False(ReminderRules.IsValidTimeZone("Mars/Olympus"));
        Assert.False(ReminderRules.IsValidTimeZone(""));
    }

    [Fact]
    public void Reminder_IsDueInTheUsersLocalSlot_AndDstDoesNotMoveIt()
    {
        // Istanbul is UTC+3 all year.
        Assert.True(ReminderRules.IsDueNow("07:30", "Europe/Istanbul", new DateTime(2026, 11, 18, 4, 30, 0, DateTimeKind.Utc)));
        Assert.True(ReminderRules.IsDueNow("07:30", "Europe/Istanbul", new DateTime(2026, 11, 18, 4, 44, 59, DateTimeKind.Utc)));
        Assert.False(ReminderRules.IsDueNow("07:30", "Europe/Istanbul", new DateTime(2026, 11, 18, 4, 45, 0, DateTimeKind.Utc)));
        // London: 07:30 local is 07:30 UTC in winter and 06:30 UTC in summer.
        Assert.True(ReminderRules.IsDueNow("07:30", "Europe/London", new DateTime(2026, 1, 15, 7, 30, 0, DateTimeKind.Utc)));
        Assert.True(ReminderRules.IsDueNow("07:30", "Europe/London", new DateTime(2026, 7, 15, 6, 30, 0, DateTimeKind.Utc)));
        Assert.False(ReminderRules.IsDueNow("07:30", "Europe/London", new DateTime(2026, 7, 15, 7, 30, 0, DateTimeKind.Utc)));
    }

    [Fact]
    public void Reminder_LocalSlotsNow_ContainTheSlotOfEveryRealZone()
    {
        var now = new DateTime(2026, 11, 18, 4, 30, 0, DateTimeKind.Utc);
        var slots = ReminderRules.LocalSlotsNow(now);

        Assert.Contains("07:30", slots);  // Istanbul
        Assert.Contains("04:30", slots);  // UTC
        Assert.Contains("10:00", slots);  // India +5:30
        Assert.Contains("10:15", slots);  // Nepal +5:45
        Assert.True(slots.Count < 60);    // not "every partition"
        Assert.Equal("2026-11-18", ReminderRules.LocalDay("Europe/Istanbul", now));
        Assert.Equal("2026-11-17", ReminderRules.LocalDay("America/Los_Angeles", now));
    }
}

public class WeatherAndLocalizationRulesTests
{
    [Theory]
    [InlineData(0, WeatherCondition.Clear)]
    [InlineData(2, WeatherCondition.PartlyCloudy)]
    [InlineData(3, WeatherCondition.Cloudy)]
    [InlineData(48, WeatherCondition.Fog)]
    [InlineData(55, WeatherCondition.Drizzle)]
    [InlineData(63, WeatherCondition.Rain)]
    [InlineData(75, WeatherCondition.Snow)]
    [InlineData(81, WeatherCondition.Showers)]
    [InlineData(86, WeatherCondition.Snow)]
    [InlineData(96, WeatherCondition.Thunderstorm)]
    [InlineData(-1, WeatherCondition.Unknown)]
    public void ConditionFromWmo(int code, WeatherCondition expected) => Assert.Equal(expected, WeatherRules.ConditionFromWmo(code));

    [Fact]
    public void LocationKey_RoundsToATenthOfADegree()
    {
        Assert.Equal("geo:41.0:29.0", WeatherRules.LocationKey(41.0082, 28.9784));
        Assert.Equal(WeatherRules.LocationKey(41.01, 28.96), WeatherRules.LocationKey(41.04, 29.04)); // same cache row for neighbours
        Assert.Equal("geo:-33.9:151.2", WeatherRules.LocationKey(-33.8688, 151.2093));
        Assert.True(WeatherRules.IsValidCoordinate(41, 29));
        Assert.False(WeatherRules.IsValidCoordinate(91, 29));
        Assert.False(WeatherRules.IsValidCoordinate(41, 181));
        Assert.Equal(7, WeatherRules.ClampDays(null));
        Assert.Equal(7, WeatherRules.ClampDays(30));
        Assert.Equal(1, WeatherRules.ClampDays(0));
    }

    [Fact]
    public void LocalizedText_Resolve_RequestedThenDefaultThenAny()
    {
        var text = Sample.Text("Keten Gömlek", "Linen Shirt");

        Assert.Equal("Linen Shirt", LocalizedText.Resolve(text, "en", "tr"));
        Assert.Equal("Keten Gömlek", LocalizedText.Resolve(text, "de", "tr"));               // new language without data → default
        Assert.Equal("Linen Shirt", LocalizedText.Resolve(new Dictionary<string, string> { ["en"] = "Linen Shirt" }, "de", "tr"));
        Assert.Equal("Keten Gömlek", LocalizedText.Resolve(new Dictionary<string, string> { ["tr"] = "Keten Gömlek", ["en"] = " " }, "en", "tr"));
        Assert.Null(LocalizedText.Resolve(null, "tr", "tr"));
    }

    [Theory]
    [InlineData("en-US,en;q=0.9,tr;q=0.8", "en")]
    [InlineData("tr-TR", "tr")]
    [InlineData("de-DE,de;q=0.9,tr;q=0.5,en;q=0.7", "en")]
    [InlineData("fr-FR", null)]
    [InlineData("", null)]
    [InlineData(null, null)]
    public void LocalizedText_NegotiateAcceptLanguage(string? header, string? expected) =>
        Assert.Equal(expected, LocalizedText.Negotiate(header, ["tr", "en"]));

    [Fact]
    public void LocalizedText_IsValid_DefaultLanguageRequired_OnlySupportedKeys()
    {
        string[] languages = ["tr", "en"];

        Assert.True(LocalizedText.IsValid(Sample.Text("a", "b"), true, 10, languages, "tr"));
        Assert.True(LocalizedText.IsValid(Sample.Text("a"), true, 10, languages, "tr"));
        Assert.False(LocalizedText.IsValid(new Dictionary<string, string> { ["en"] = "b" }, true, 10, languages, "tr"));  // default missing
        Assert.False(LocalizedText.IsValid(new Dictionary<string, string> { ["tr"] = "a", ["de"] = "c" }, true, 10, languages, "tr"));
        Assert.False(LocalizedText.IsValid(Sample.Text(new string('x', 11)), true, 10, languages, "tr"));
        Assert.False(LocalizedText.IsValid(null, true, 10, languages, "tr"));
        Assert.True(LocalizedText.IsValid(null, false, 10, languages, "tr"));
        Assert.True(LocalizedText.IsValid(new Dictionary<string, string> { ["tr"] = "a", ["de"] = "c" }, true, 10, ["tr", "en", "de"], "tr")); // data-only new language
    }

    [Fact]
    public void LocalizationOptions_DefaultsToTrEn_ConfigReplacesTheList()
    {
        Assert.Equal(["tr", "en"], new LocalizationOptions().Languages);
        var extended = new LocalizationOptions { SupportedLanguages = ["tr", "en", "DE"] };
        Assert.True(extended.IsSupported("de"));
        Assert.False(new LocalizationOptions().IsSupported("de"));
        Assert.False(new LocalizationOptions().IsSupported(null));
    }
}

public class StoreInputValidatorTests
{
    private static ProductInput Product(Func<ProductInput, ProductInput>? change = null)
    {
        var input = new ProductInput("sample-shirt", "brand-a", Sample.Text("Gömlek", "Shirt"), null, ProductCategory.Shirt, ["white"], ["S", "M"], 129_900, "TRY",
            PriceBand.HighStreet, ["https://img.example/1.jpg"], "https://brand.example/p/1", AffiliateSource.Network);
        return change is null ? input : change(input);
    }

    private static string[] Codes(ProductInput input) =>
        new ProductInputValidator(Sample.Localization).Validate(input).Errors.Select(e => e.ErrorCode).ToArray();

    [Fact]
    public void Product_ValidSample_Passes() => Assert.Empty(Codes(Product()));

    [Fact]
    public void Product_Rejections()
    {
        Assert.Contains("id_invalid", Codes(Product(p => p with { Id = "Has Space#" })));
        Assert.Contains("name_invalid", Codes(Product(p => p with { Name = new Dictionary<string, string> { ["en"] = "Shirt" } })));   // default language missing
        Assert.Contains("name_invalid", Codes(Product(p => p with { Name = new Dictionary<string, string> { ["tr"] = "a", ["xx"] = "b" } })));
        Assert.Contains("price_invalid", Codes(Product(p => p with { PriceMinor = 0 })));
        Assert.Contains("price_invalid", Codes(Product(p => p with { PriceMinor = StoreInputRules.MaxPriceMinor + 1 })));
        Assert.Contains("currency_unsupported", Codes(Product(p => p with { Currency = "USD" })));
        Assert.Contains("colors_invalid", Codes(Product(p => p with { Colors = ["Açık Mavi"] })));
        Assert.Contains("sizes_invalid", Codes(Product(p => p with { Sizes = ["this-size-is-too-long"] })));
        Assert.Contains("images_invalid", Codes(Product(p => p with { Images = ["http://insecure.example/1.jpg"] })));
        Assert.Contains("affiliate_url_invalid", Codes(Product(p => p with { AffiliateUrl = "javascript:alert(1)" })));
    }

    private static WeeklyEditInput Edit(int looks = 7, bool published = true, string weekStart = "2026-11-16") => new(
        "edit-2026-47", Segment.Women, weekStart, Sample.Text("Haftanın edit'i", "Edit of the week"), null, null,
        Enumerable.Range(1, looks).Select(day => new EditLookInput(null, day, Sample.Text($"Gün {day}", $"Day {day}"), null, null,
            [new EditLookVariantInput(PriceBand.HighStreet, ["sample-shirt"]), new EditLookVariantInput(PriceBand.LuxuryTouch, ["sample-shirt"])])).ToList(),
        null, null, published);

    private static string[] Codes(WeeklyEditInput input) =>
        new WeeklyEditInputValidator(Sample.Localization).Validate(input).Errors.Select(e => e.ErrorCode).ToArray();

    [Fact]
    public void WeeklyEdit_PublishedNeedsExactlySevenLooks_DraftMayBeIncomplete()
    {
        Assert.Empty(Codes(Edit()));
        Assert.Contains("looks_must_be_seven", Codes(Edit(looks: 5)));
        Assert.Empty(Codes(Edit(looks: 5, published: false)));
        Assert.Contains("looks_too_many", Codes(Edit(looks: 8, published: false)));
    }

    [Fact]
    public void WeeklyEdit_Rejections()
    {
        Assert.Contains("week_start_invalid", Codes(Edit(weekStart: "2026-11-18")));
        Assert.Contains("segment_not_available", Codes(Edit() with { Segment = Segment.Teen }));
        Assert.Contains("title_invalid", Codes(Edit() with { Title = null }));

        var duplicateDay = Edit(looks: 2, published: false);
        duplicateDay = duplicateDay with { Looks = [duplicateDay.Looks![0], duplicateDay.Looks[0]] };
        Assert.Contains("look_day_duplicate", Codes(duplicateDay));

        var sameBandTwice = Edit(looks: 1, published: false);
        sameBandTwice = sameBandTwice with
        {
            Looks = [sameBandTwice.Looks![0] with { Variants = [new(PriceBand.HighStreet, ["a1"]), new(PriceBand.HighStreet, ["b1"])] }],
        };
        Assert.Contains("look_variants_invalid", Codes(sameBandTwice));
    }

    [Fact]
    public void Brand_Rejections()
    {
        var validator = new BrandInputValidator();
        var brand = new BrandInput("vakko", "Vakko", "https://brand.example", null, AffiliateSource.Direct, null, null, "subid", 900);

        Assert.True(validator.Validate(brand).IsValid);
        Assert.Contains(validator.Validate(brand with { CommissionRateBps = 9000 }).Errors, e => e.ErrorCode == "commission_rate_invalid");
        Assert.Contains(validator.Validate(brand with { ClickIdParameter = "bad param" }).Errors, e => e.ErrorCode == "click_id_parameter_invalid");
        Assert.Contains(validator.Validate(brand with { CheckoutUrl = "http://x.example" }).Errors, e => e.ErrorCode == "checkout_url_invalid");
    }
}
