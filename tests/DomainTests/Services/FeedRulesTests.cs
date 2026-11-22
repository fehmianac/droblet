using Domain.Domain;
using Domain.Entity;
using Domain.Enum;
using Domain.Options;
using Domain.Services;
using Domain.Validation;
using Microsoft.Extensions.Options;

namespace DomainTests.Services;

public class FeedRulesTests
{
    private static readonly DateTime Now = new(2026, 11, 22, 9, 0, 0, DateTimeKind.Utc);

    private static FeedPostEntity Post(string id, DateTime publishAt, int sortOrder = 0, bool published = true, bool retired = false, Segment? segment = null) => new()
    {
        Id = id, PublishAt = publishAt, SortOrder = sortOrder, Published = published, Retired = retired, Segment = segment,
        Title = new() { ["tr"] = id }, ImageUrls = ["https://img.example/1.jpg"],
    };

    [Fact]
    public void IsLive_NeedsPublished_NotRetired_PublishTimeCome()
    {
        Assert.True(FeedRules.IsLive(Post("a", Now), Now));
        Assert.False(FeedRules.IsLive(Post("a", Now.AddSeconds(1)), Now));
        Assert.False(FeedRules.IsLive(Post("a", Now.AddHours(-1), published: false), Now));
        Assert.False(FeedRules.IsLive(Post("a", Now.AddHours(-1), retired: true), Now));
    }

    [Fact]
    public void StoryWindow_And_Segment()
    {
        FeedStoryEntity Story(DateTime publishAt, DateTime? expiresAt) => new() { Id = "s", ImageUrl = "https://x.example/s.jpg", PublishAt = publishAt, ExpiresAt = expiresAt, Published = true };

        Assert.True(FeedRules.IsActive(Story(Now.AddHours(-1), null), Now));
        Assert.True(FeedRules.IsActive(Story(Now.AddHours(-1), Now.AddSeconds(1)), Now));
        Assert.False(FeedRules.IsActive(Story(Now.AddHours(-1), Now), Now));          // expiresAt is exclusive
        Assert.False(FeedRules.IsActive(Story(Now.AddHours(1), null), Now));
        Assert.True(FeedRules.Shows(null, Segment.Men));
        Assert.True(FeedRules.Shows(Segment.Women, Segment.Women));
        Assert.False(FeedRules.Shows(Segment.Men, Segment.Women));
    }

    [Fact]
    public void Order_NewestFirst_ThenSortOrder_Paging_ByPosition()
    {
        var posts = new[]
        {
            Post("c", Now.AddHours(-2)), Post("b2", Now.AddHours(-1), sortOrder: 2), Post("b1", Now.AddHours(-1), sortOrder: 1),
            Post("a", Now), Post("d", Now.AddHours(-3)),
        };
        var ordered = FeedRules.Order(posts).ToList();

        var (first, token) = FeedRules.Page(ordered, null, 2);
        var withoutCursorPost = ordered.Where(p => p.Id != "b1").ToList();              // the cursor's post was retired meanwhile
        var (second, token2) = FeedRules.Page(withoutCursorPost, token, 2);
        var (third, token3) = FeedRules.Page(ordered, token2, 2);
        var (garbage, _) = FeedRules.Page(ordered, "!!not-a-token", 2);

        Assert.Equal(["a", "b1", "b2", "c", "d"], ordered.Select(p => p.Id));
        Assert.Equal(["a", "b1"], first.Select(p => p.Id));
        Assert.Equal(["b2", "c"], second.Select(p => p.Id));
        Assert.Equal(["d"], third.Select(p => p.Id));
        Assert.Null(token3);
        Assert.Equal(["a", "b1"], garbage.Select(p => p.Id));
    }

    [Fact]
    public void OwnsSimilar_SameProduct_OrSameCategoryAndMainColour()
    {
        var shirt = new ProductDto("p1", "b", "Marka", "Gömlek", null, ProductCategory.Shirt, ProductSlot.Top, ["White", "navy"], [], 100, "TRY", null,
            PriceBand.HighStreet, [], true, Now);
        ItemEntity Item(ItemCategory category, string[] colors, string? productId = null) => new() { Id = "i", TenantId = "t", Category = category, ColorIds = colors.ToList(), ProductId = productId };

        Assert.True(FeedRules.OwnsSimilar(shirt, [Item(ItemCategory.Top, ["white"])]));
        Assert.True(FeedRules.OwnsSimilar(shirt, [Item(ItemCategory.Bag, ["red"], productId: "p1")]));
        Assert.False(FeedRules.OwnsSimilar(shirt, [Item(ItemCategory.Top, ["red", "white"])]));     // main colour only
        Assert.False(FeedRules.OwnsSimilar(shirt, [Item(ItemCategory.Bottom, ["white"])]));
        Assert.False(FeedRules.OwnsSimilar(shirt, []));

        var products = new[] { FeedProductDto.From(shirt, true), FeedProductDto.From(shirt, false), FeedProductDto.From(shirt with { Available = false }, false) };
        Assert.Equal(1, FeedRules.BuyableCount(products));
    }

    [Theory]
    [InlineData(null, true, new Occasion[0])]
    [InlineData("office", true, new[] { Occasion.Office })]
    [InlineData("Weekend", true, new[] { Occasion.Weekend })]
    [InlineData("dinner,wedding", true, new[] { Occasion.Dinner, Occasion.Wedding })]   // the app's "Davet" tab
    [InlineData(" dinner , wedding ", true, new[] { Occasion.Dinner, Occasion.Wedding })]
    [InlineData("party", false, new Occasion[0])]
    [InlineData("dinner,party", false, new Occasion[0])]
    [InlineData("1", false, new Occasion[0])]
    [InlineData(",", false, new Occasion[0])]
    public void OccasionFilter(string? value, bool ok, Occasion[] expected)
    {
        Assert.Equal(ok, FeedRules.TryParseOccasions(value, out var occasions));
        Assert.Equal(expected.Order(), (occasions ?? new HashSet<Occasion>()).Order());
    }

    [Fact]
    public void Validators_AcceptAUlidOrSlug_RejectTeenSegment_ImageAndProductLimits()
    {
        var validator = new FeedPostInputValidator(Options.Create(new LocalizationOptions()));
        FeedPostInput Input(string id, Segment? segment = null, int images = 1, int products = 0) => new(
            id, segment, new FeedAuthorInput(FeedAuthorKind.Edit, new Dictionary<string, string> { ["tr"] = "Droblet Edit" }, null, null), Occasion.Office,
            new Dictionary<string, string> { ["tr"] = "Başlık" }, null, Enumerable.Range(0, images).Select(i => $"https://img.example/{i}.jpg").ToList(),
            Enumerable.Range(0, products).Select(i => $"p-{i}").ToList(), Now, 0, true);

        Assert.True(validator.Validate(Input(Domain.Extensions.Ulid.New())).IsValid);
        Assert.True(validator.Validate(Input("feed-office-1", Segment.Men, images: 4, products: 8)).IsValid);
        Assert.False(validator.Validate(Input("x", Segment.Teen)).IsValid);
        Assert.False(validator.Validate(Input("feed-1", images: 0)).IsValid);
        Assert.False(validator.Validate(Input("feed-1", images: 5)).IsValid);
        Assert.False(validator.Validate(Input("feed-1", products: 9)).IsValid);
    }

    [Fact]
    public void DeletionPlan_ListsLikesAndSaves()
    {
        Assert.Contains(typeof(FeedLikeEntity), DeletionPlan.TenantScopedEntityTypes);
        Assert.Contains(typeof(FeedSaveEntity), DeletionPlan.TenantScopedEntityTypes);
        Assert.False(DeletionPlan.IsTenantScoped(typeof(FeedPostEntity)));
        Assert.False(DeletionPlan.IsTenantScoped(typeof(FeedPostStatsEntity)));
    }

    // ── Akış F2 ─────────────────────────────────────────────────────────────────────────────────────────────────

    private static FeedUserCandidate User(string id, bool followed = false, int match = 0, int minutesAgo = 0) => new(id, followed, match, Now.AddMinutes(-minutesAgo));

    private static string Shape(IEnumerable<FeedMixItem> page) => string.Concat(page.Select(i => i.Editor is not null ? "E" : "U"));

    [Fact]
    public void UserPostId_IsStableOpaque_AndNeverAnEditorOrFallbackId()
    {
        var id = FeedRules.UserPostId("tenant-1", "look-1");

        Assert.Equal(id, FeedRules.UserPostId("tenant-1", "look-1"));
        Assert.NotEqual(id, FeedRules.UserPostId("tenant-1", "look-2"));
        Assert.NotEqual(id, FeedRules.UserPostId("tenant-2", "look-1"));
        Assert.Matches("^u_[0-9a-f]{26}$", id);
        Assert.DoesNotContain("tenant-1", id);
        Assert.True(FeedRules.IsUserPostId(id));
        Assert.False(FeedInputRules.IsId(id));                                          // an admin can never create an editor post with such an id
        Assert.False(FeedRules.IsUserPostId("u_short"));
        Assert.False(FeedRules.IsUserPostId("feed-office-1"));
        Assert.False(FeedRules.IsUserPostId(null));
        Assert.Equal("edit-47-look-1", FeedRules.EditLookIdOf(FeedRules.EditPostId("edit-47-look-1")));
        Assert.False(FeedInputRules.IsId(FeedRules.EditPostId("edit-47-look-1")));
        Assert.Null(FeedRules.EditLookIdOf(id));
        Assert.Null(FeedRules.EditLookIdOf("e_Not A Slug"));
        Assert.Null(FeedRules.EditLookIdOf("feed-office-1"));
    }

    [Fact]
    public void UserLooks_Order_FollowedFirst_ThenStyleMatch_ThenNewest()
    {
        var ordered = FeedRules.Order(new[]
        {
            User("old-stranger", minutesAgo: 60), User("match-80", match: 80, minutesAgo: 30), User("followed-old", followed: true, minutesAgo: 500),
            User("new-stranger", minutesAgo: 1), User("followed-match", followed: true, match: 40, minutesAgo: 900), User("match-80-newer", match: 80, minutesAgo: 5),
        }).Select(c => c.PostId);

        Assert.Equal(["followed-match", "followed-old", "match-80-newer", "match-80", "new-stranger", "old-stranger"], ordered);
    }

    [Fact]
    public void Mix_AtMostOneInThree_UserLooksNeedEditorPostsBeforeThem_EditorsCarryOn()
    {
        var editors = Enumerable.Range(0, 7).Select(i => Post($"e{i}", Now.AddMinutes(-i))).ToList();
        var users = Enumerable.Range(0, 5).Select(i => User($"u{i}", minutesAgo: i)).ToList();

        Assert.Equal("EEUEEUEEUE", Shape(FeedRules.MixPage(editors, users, null, 20, 3).Page));              // 7 editor posts carry 3 user looks
        Assert.Equal("EEUEEUEEE", Shape(FeedRules.MixPage(editors.Take(7).ToList(), users.Take(2).ToList(), null, 20, 3).Page));   // user looks run out
        Assert.Equal("EEEEEEE", Shape(FeedRules.MixPage(editors, [], null, 20, 3).Page));
        Assert.Empty(FeedRules.MixPage([], users, null, 20, 3).Page);                                         // nothing to mix into
        Assert.Equal("E", Shape(FeedRules.MixPage(editors.Take(1).ToList(), users, null, 20, 3).Page));
        Assert.Equal("EEEUEEEU", Shape(FeedRules.MixPage(editors, users, null, 8, 4).Page));                  // ContentFeed:UserPostEvery = 4
        Assert.Equal("EUEUEU", Shape(FeedRules.MixPage(editors, users, null, 6, 1).Page));                    // never denser than every second item
    }

    [Fact]
    public void Mix_Paging_ContinuesThePatternAcrossPages_SurvivesRemovedAndNewItems_ReadsF1Tokens()
    {
        var editors = Enumerable.Range(0, 9).Select(i => Post($"e{i}", Now.AddMinutes(-i))).ToList();
        var users = Enumerable.Range(0, 4).Select(i => User($"u{i}", minutesAgo: i)).ToList();
        static string[] Ids(IEnumerable<FeedMixItem> page) => page.Select(i => i.Editor?.Id ?? i.User!.PostId).ToArray();

        var (first, token) = FeedRules.MixPage(editors, users, null, 4, 3);
        // Between the pages: the cursor's own items go away and new ones arrive on top of both lists.
        var editorsLater = editors.Where(e => e.Id != "e2").Prepend(Post("e-new", Now.AddMinutes(5))).ToList();
        var usersLater = users.Where(u => u.PostId != "u0").Prepend(User("u-new", followed: true)).ToList();
        var (second, token2) = FeedRules.MixPage(editorsLater, usersLater, token, 4, 3);
        var (third, token3) = FeedRules.MixPage(editorsLater, usersLater, token2, 4, 3);
        var (fourth, token4) = FeedRules.MixPage(editorsLater, usersLater, token3, 4, 3);

        Assert.Equal(["e0", "e1", "u0", "e2"], Ids(first));
        Assert.Equal(["e3", "u1", "e4", "e5"], Ids(second));                             // one editor post since the last user look: the pattern goes on
        Assert.Equal(["u2", "e6", "e7", "u3"], Ids(third));
        Assert.Equal(["e8"], Ids(fourth));
        Assert.Null(token4);
        Assert.NotNull(token3);

        // A page that ends on the last editor post with a user look still due announces one more page.
        var (full, more) = FeedRules.MixPage(editors.Take(2).ToList(), users, null, 2, 3);
        var (tail, end) = FeedRules.MixPage(editors.Take(2).ToList(), users, more, 2, 3);
        Assert.Equal(["e0", "e1"], Ids(full));
        Assert.Equal(["u0"], Ids(tail));
        Assert.Null(end);

        // An Akış F1 token (editor position only) continues the editor list; garbage starts from the top.
        var legacy = FeedRules.Page(editors, null, 2).Next;
        Assert.Equal(["e2", "e3", "u0", "e4"], Ids(FeedRules.MixPage(editors, users, legacy, 4, 3).Page));
        Assert.Equal(["e0", "e1", "u0", "e2"], Ids(FeedRules.MixPage(editors, users, "!!not-a-token", 4, 3).Page));
    }

    [Fact]
    public void OwnedItem_TheProductsOwnItemFirst_ElseTheNewestCategoryAndMainColourMatch()
    {
        var shirt = new ProductDto("shirt", "b", "Marka", "Gömlek", null, ProductCategory.Shirt, ProductSlot.Top, ["white", "blue"], [], 1000, "TRY", null, PriceBand.HighStreet, [], true, Now, CatalogSegment.Women);
        ItemEntity Item(string id, ItemCategory category, string[] colors, int daysAgo, string? productId = null) =>
            new() { Id = id, Category = category, ColorIds = colors.ToList(), ProductId = productId, CreatedAt = Now.AddDays(-daysAgo) };

        Assert.Null(FeedRules.OwnedItem(shirt, []));
        Assert.Null(FeedRules.OwnedItem(shirt, [Item("trousers", ItemCategory.Bottom, ["white"], 1), Item("red", ItemCategory.Top, ["red", "white"], 1), Item("no-colour", ItemCategory.Top, [], 1)]));
        Assert.Equal("newer", FeedRules.OwnedItem(shirt, [Item("older", ItemCategory.Top, ["white"], 9), Item("newer", ItemCategory.Top, ["blue"], 2)])!.Id);
        Assert.Equal("from-product", FeedRules.OwnedItem(shirt, [Item("newer", ItemCategory.Top, ["white"], 1), Item("from-product", ItemCategory.Outerwear, ["green"], 50, "shirt")])!.Id);
        Assert.True(FeedRules.OwnsSimilar(shirt, [Item("newer", ItemCategory.Top, ["WHITE "], 1)]));
        Assert.Equal((true, "x"), (FeedProductDto.From(shirt, true, "x").OwnedSimilar, FeedProductDto.From(shirt, true, "x").OwnedItemId));
        Assert.Null(FeedProductDto.From(shirt, false, "x").OwnedItemId);                 // never an item id without ownedSimilar
    }

    [Fact]
    public void Similar_CategoryAndMainColour_PieceAfterPiece_NewestFirst_NoRetired_Capped()
    {
        CatalogProductEntity Product(string id, ProductCategory category, string[] colors, int daysAgo = 0, bool retired = false) =>
            new() { Id = id, Category = category, Colors = colors.ToList(), Retired = retired, CreatedAt = Now.AddDays(-daysAgo) };
        var catalog = new[]
        {
            Product("white-shirt-old", ProductCategory.Shirt, ["white"], 9), Product("white-tee", ProductCategory.Tshirt, ["blue", "white"], 1),
            Product("red-shirt", ProductCategory.Shirt, ["red"]), Product("white-skirt", ProductCategory.Skirt, ["white"]),
            Product("black-jeans", ProductCategory.Jeans, ["black"], 2), Product("black-trousers-retired", ProductCategory.Trousers, ["black"], retired: true),
            Product("the-bag", ProductCategory.Bag, ["tan"], 30), Product("black-bag", ProductCategory.Bag, ["black"], 3),
        };
        FeedPieceRef[] pieces = [new(ItemCategory.Top, "white"), new(ItemCategory.Bottom, "black"), new(ItemCategory.Bag, "black", "the-bag"), new(ItemCategory.Shoes, null)];

        var similar = FeedRules.Similar(pieces, catalog, 12).Select(p => p.Id).ToArray();

        Assert.Equal(["white-tee", "black-jeans", "the-bag", "white-shirt-old", "black-bag"], similar);   // round-robin; the look's own catalog piece leads its piece
        Assert.Equal(["white-tee", "black-jeans"], FeedRules.Similar(pieces, catalog, 2).Select(p => p.Id));
        Assert.Empty(FeedRules.Similar([new(ItemCategory.Shoes, "white"), new(ItemCategory.Top, null)], catalog, 12));
    }

    [Fact]
    public void FallbackPosts_MapTheEditsLooks_MondayFirst_FirstVariantByPriceBand_SkipLooksWithoutAnImage()
    {
        var edit = new WeeklyEditEntity
        {
            Id = "edit-47", Segment = Segment.Women, WeekStart = "2026-11-16", Published = true,
            Looks =
            [
                new EditLook { Id = "look-2", Day = 2, Title = new() { ["tr"] = "Salı" }, ImageUrl = "https://img.example/2.jpg",
                    Variants = [new EditLookVariant { PriceBand = PriceBand.LuxuryTouch, ProductIds = ["lux"] }, new EditLookVariant { PriceBand = PriceBand.HighStreet, ProductIds = ["high"] }] },
                new EditLook { Id = "look-1", Day = 1, Title = new() { ["tr"] = "Pazartesi" }, StyleNote = new() { ["tr"] = "Not" }, ImageUrl = "https://img.example/1.jpg" },
                new EditLook { Id = "look-3", Day = 3, Title = new() { ["tr"] = "Çarşamba" } },
            ],
        };

        var posts = FeedRules.Order(FeedRules.FallbackPosts(edit)).ToList();

        Assert.Equal(["e_look-1", "e_look-2"], posts.Select(p => p.Id));
        Assert.All(posts, p => Assert.Equal((FeedAuthorKind.Edit, "Droblet Edit", Segment.Women, true), (p.Author.Kind, p.Author.Name["tr"], p.Segment, FeedRules.IsLive(p, Now))));
        Assert.Equal(["high"], posts[1].ProductIds);
        Assert.Empty(posts[0].ProductIds);
        Assert.Equal(("Pazartesi", "Not", "https://img.example/1.jpg"), (posts[0].Title["tr"], posts[0].Note!["tr"], posts[0].ImageUrls.Single()));
    }

    [Fact]
    public void Shareable_NeverAnImportedOrRemovedLook_DistinctReporters_CountDeletedAccountsOneEach()
    {
        LookEntity Look(LookSource source = LookSource.User, string? coverImageKey = null, DateTime? hiddenAt = null, bool slots = true) => new()
        {
            Id = "l", TenantId = "t", Source = source, CoverImageKey = coverImageKey, ModerationHiddenAt = hiddenAt,
            Slots = slots ? [new LookSlotValue { Slot = OutfitSlot.Top, ItemId = "i" }] : [],
        };
        ReportEntity Report(string? reporter) => new() { Id = Guid.NewGuid().ToString("N"), ReporterTenantId = reporter, TargetTenantId = "t" };

        Assert.True(FeedRules.IsShareable(Look()));
        Assert.True(FeedRules.IsShareable(Look(LookSource.Stylist)));
        Assert.False(FeedRules.IsShareable(Look(LookSource.Import)));
        Assert.False(FeedRules.IsShareable(Look(coverImageKey: "tenant/t/import/o.jpg")));   // its cover is the user's own photo
        Assert.False(FeedRules.IsShareable(Look(hiddenAt: Now)));
        Assert.False(FeedRules.IsShareable(Look(slots: false)));
        Assert.Equal(4, FeedRules.DistinctReporters([Report("a"), Report("a"), Report("b"), Report(null), Report(null)]));
        Assert.Equal(0, FeedRules.DistinctReporters([]));
    }
}
