using Domain.Enum;
using Domain.Options;
using Domain.Services;
using Domain.Validation;

namespace DomainTests.Services;

public class SeedFilesTests
{
    private static string SeedDirectory()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "Droblet.sln")))
            directory = directory.Parent;
        return Path.Combine(directory!.FullName, "seed");
    }

    [Fact]
    public void RepoSeedFiles_AreValid_Complete_AndTranslatedIntoEverySupportedLanguage()
    {
        var bundle = SeedData.Load(SeedDirectory());

        var errors = SeedData.Validate(bundle, new LocalizationOptions());

        Assert.True(errors.Count == 0, string.Join("\n", errors));
        Assert.NotEmpty(bundle.Brands);
        Assert.NotEmpty(bundle.Products);
        var edit = Assert.Single(bundle.Edits);
        Assert.Equal(WeeklyEditRules.LooksPerEdit, edit.Looks!.Count);
        Assert.All(edit.Looks, look => Assert.Equal([PriceBand.HighStreet, PriceBand.LuxuryTouch], look.Variants!.Select(v => v.PriceBand).ToArray()));
        Assert.Contains(bundle.Brands, b => b.Source == AffiliateSource.Network);
        Assert.Contains(bundle.Brands, b => b.Source == AffiliateSource.Direct);
        Assert.NotEmpty(bundle.Posts);
        Assert.NotEmpty(bundle.Stories);
        Assert.Contains(bundle.Posts, p => p.Occasion == Occasion.Dinner);   // the app's "Davet" tab
    }

    [Fact]
    public void Validate_ReportsDuplicates_BrokenReferences_AndMissingTranslations()
    {
        var product = new ProductInput("p-1", "no-such-brand", Sample.Text("Gömlek"), null, ProductCategory.Shirt, null, null, 100, null, PriceBand.HighStreet, null, null, null);
        var bundle = new SeedBundle([], [product, product], []);

        var errors = SeedData.Validate(bundle, new LocalizationOptions());

        Assert.Contains("product p-1: duplicate_id", errors);
        Assert.Contains("product p-1: brand_not_found (no-such-brand)", errors);
        Assert.Contains("product p-1 name: translation_missing (en)", errors);
    }

    [Fact]
    public void Validate_FeedPostsAndStories_ProductReferencesAndTranslations()
    {
        var post = new FeedPostInput("feed-1", null, new FeedAuthorInput(FeedAuthorKind.Edit, Sample.Text("Droblet Edit"), null, null), Occasion.Office,
            Sample.Text("Ofis"), null, ["https://img.example/1.jpg"], ["no-such-product"], new DateTime(2026, 11, 22, 7, 0, 0, DateTimeKind.Utc), 0, true);
        var story = new FeedStoryInput("story-1", null, new FeedStoryAuthorInput(Sample.Text("Droblet Edit"), null), null, Sample.Text("Başlık"), null,
            new DateTime(2026, 11, 22, 7, 0, 0, DateTimeKind.Utc), null, 0, true);
        var bundle = new SeedBundle([], [], [], [post, post], [story]);

        var errors = SeedData.Validate(bundle, new LocalizationOptions());

        Assert.Contains("feed post feed-1: duplicate_id", errors);
        Assert.Contains("feed post feed-1: product_not_found (no-such-product)", errors);
        Assert.Contains("feed post feed-1 title: translation_missing (en)", errors);
        Assert.Contains("feed story story-1: ImageUrl image_url_invalid", errors);
    }
}
