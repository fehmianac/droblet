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
}
