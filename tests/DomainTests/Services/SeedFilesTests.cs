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
}
