using Domain.Entity;
using Domain.Enum;
using Domain.Services.Ai;
using Ops;
using Ops.Commands;

namespace OpsTests;

public class OpsArgumentsTests
{
    private static (OpsArguments? Args, string? Error) Parse(params string[] args) => OpsArguments.Parse(args);

    [Theory]
    [InlineData("grant-test-premium", "--email", "a@b.c")]
    [InlineData("revoke-test-premium", "--email", "a@b.c")]
    [InlineData("ai-smoke")]
    [InlineData("ai-probe")]
    public void DevOnlyCommands_AreRefusedOnProd(string command, params string[] rest)
    {
        var (args, error) = Parse([command, "--stage", "prod", .. rest]);

        Assert.Null(args);
        Assert.Contains("refused on prod", error);
    }

    [Fact]
    public void AiUsageBackfill_RunsOnProdToo_DaysAreCappedAtTheJobRetention()
    {
        var (args, error) = Parse("ai-usage-backfill", "--stage", "prod", "--days", "7", "--dry-run");
        Assert.Null(error);
        Assert.True(args!.DryRun);
        Assert.Equal(7, args.IntOption("days", 0));
        Assert.Contains("1–7", Parse("ai-usage-backfill", "--stage", "dev", "--days", "8").Error);
    }

    [Fact]
    public void GrantTestPremium_OnDev_ParsesEmailAndCredits()
    {
        var (args, error) = Parse("grant-test-premium", "--stage", "dev", "--email", "qa@example.com", "--credits", "20");

        Assert.Null(error);
        Assert.Equal("dev", args!.Stage);
        Assert.Equal("qa@example.com", args.Option("email"));
        Assert.Equal(20, args.IntOption("credits", 0));
    }

    [Theory]
    [InlineData("--credits", "0")]
    [InlineData("--credits", "501")]
    [InlineData("--credits", "ten")]
    [InlineData("--days", "91")]
    public void GrantTestPremium_RangesAreChecked(string option, string value)
    {
        var (args, error) = Parse("grant-test-premium", "--stage", "dev", "--email", "qa@example.com", option, value);

        Assert.Null(args);
        Assert.NotNull(error);
    }

    [Theory]
    [InlineData]
    [InlineData("--stage")]
    [InlineData("--stage", "staging")]
    public void Stage_IsRequiredAndKnown(params string[] stage)
    {
        var (args, error) = Parse(["generate-library-images", .. stage]);

        Assert.Null(args);
        Assert.NotNull(error);
    }

    [Fact]
    public void UnknownCommandOptionOrFlag_IsRefused()
    {
        Assert.NotNull(Parse("drop-table", "--stage", "dev").Error);
        Assert.NotNull(Parse("ai-smoke", "--stage", "dev", "--email", "a@b.c").Error);
        Assert.NotNull(Parse("grant-test-premium", "--stage", "dev", "--email", "a@b.c", "--force").Error);
        Assert.NotNull(Parse("ai-smoke", "stray", "--stage", "dev").Error);
        Assert.NotNull(Parse().Error);
    }

    [Fact]
    public void GenerateLibraryImages_ParsesOnlyDryRunForceAndEqualsSyntax()
    {
        var (args, error) = Parse("generate-library-images", "--stage=dev", "--only", "lib-white-tshirt, lib-navy-blazer,lib-white-tshirt", "--dry-run", "--force");

        Assert.Null(error);
        Assert.Equal(["lib-white-tshirt", "lib-navy-blazer"], args!.OnlyIds);
        Assert.True(args.DryRun);
        Assert.True(args.Force);
        Assert.Equal(OpsArguments.MaxImageCallsPerRun, args.MaxImageCalls);
    }

    [Theory]
    [InlineData("--only", "white-tshirt")]
    [InlineData("--only", "lib-White")]
    [InlineData("--max-calls", "31")]
    [InlineData("--max-calls", "-1")]
    [InlineData("--quality", "ultra")]
    public void GenerateLibraryImages_GuardsInvalidValues(string option, string value)
    {
        Assert.NotNull(Parse("generate-library-images", "--stage", "dev", option, value).Error);
    }

    [Fact]
    public void Logs_NeedsAFunctionName()
    {
        Assert.NotNull(Parse("logs", "--stage", "dev").Error);
        Assert.NotNull(Parse("logs", "--stage", "dev", "--function", "../etc").Error);
        Assert.Null(Parse("logs", "--stage", "dev", "--function", "item-processor", "--minutes", "15").Error);
    }

    [Fact]
    public void ImageCallBudget_NeverExceedsTheHardCap()
    {
        var budget = new ImageCallBudget(1000);

        var taken = 0;
        while (budget.TryTake())
            taken++;

        Assert.Equal(OpsArguments.MaxImageCallsPerRun, taken);
        Assert.Equal(0, budget.Remaining);
        Assert.False(budget.TryTake());
    }
}

public class LibraryImagePlanTests
{
    private static LibraryItemEntity Item(string id, int sort, string? image = "library/x.webp", bool retired = false) => new()
    {
        Id = id,
        Name = new() { ["tr"] = "Ürün", ["en"] = "Navy blazer" },
        Category = ItemCategory.Outerwear,
        ColorIds = ["navy"],
        Fabric = "wool",
        Seasons = [Season.Autumn],
        ImageKey = image,
        SortOrder = sort,
        Retired = retired,
    };

    [Fact]
    public void Select_SkipsItemsThatAlreadyHaveAnImage_UnlessForced()
    {
        var items = new[] { Item("lib-a", 1, "https://bucket/catalog/library/lib-a.webp"), Item("lib-b", 2), Item("lib-c", 3, null) };

        var plan = LibraryImagePlan.Select(items, [], force: false, budget: 30);
        Assert.Equal(["lib-b", "lib-c"], plan.ToGenerate.Select(i => i.Id));
        Assert.Contains(plan.Skipped, s => s.Id == "lib-a");

        var forced = LibraryImagePlan.Select(items, [], force: true, budget: 30);
        Assert.Equal(["lib-a", "lib-b", "lib-c"], forced.ToGenerate.Select(i => i.Id));
    }

    [Fact]
    public void Select_HonoursOnly_ReportsUnknownIds_AndNeverPlansRetiredItems()
    {
        var items = new[] { Item("lib-a", 1), Item("lib-b", 2, retired: true), Item("lib-c", 3) };

        var plan = LibraryImagePlan.Select(items, ["lib-c", "lib-b", "lib-zzz"], force: true, budget: 30);

        Assert.Equal(["lib-c"], plan.ToGenerate.Select(i => i.Id));
        Assert.Equal(["lib-zzz"], plan.UnknownIds);
        Assert.Contains(plan.Skipped, s => s is { Id: "lib-b", Reason: "retired" });
    }

    [Fact]
    public void Select_StopsAtTheBudget()
    {
        var items = Enumerable.Range(1, 40).Select(i => Item($"lib-i{i}", i)).ToList();

        var plan = LibraryImagePlan.Select(items, [], force: false, budget: OpsArguments.MaxImageCallsPerRun);

        Assert.Equal(30, plan.ToGenerate.Count);
        Assert.Equal(10, plan.Skipped.Count(s => s.Reason == "image-call cap reached"));
    }

    [Fact]
    public void Prompt_CarriesTheHouseStyleAndTheItemFacts()
    {
        var prompt = LibraryImagePlan.Prompt(Item("lib-navy-blazer", 1));

        Assert.Contains("navy blazer", prompt);
        Assert.Contains("#1B2A49", prompt);
        Assert.Contains("wool", prompt);
        Assert.Contains(LibraryImagePlan.Background, prompt);
        Assert.Contains("no logos", prompt);
        Assert.Contains("No people", prompt);
        Assert.Contains("no text", prompt);
    }

    [Fact]
    public void Prompt_NamesTheSegment_WomenUnchanged_MenOnce_UnisexNone()
    {
        Assert.Contains("of a single women's navy blazer.", LibraryImagePlan.Prompt(Item("lib-navy-blazer", 1)));
        var men = Item("lib-men-navy-suit-jacket", 1);
        men.Segment = CatalogSegment.Men;
        Assert.Contains("of a single men's navy blazer.", LibraryImagePlan.Prompt(men));
        men.Name["en"] = "Men's camel coat";
        Assert.Contains("of a single men's camel coat.", LibraryImagePlan.Prompt(men));   // never "men's men's"
        men.Segment = CatalogSegment.Unisex;
        Assert.Contains("of a single men's camel coat.", LibraryImagePlan.Prompt(men));
        men.Name["en"] = "Steel watch";
        Assert.Contains("of a single steel watch.", LibraryImagePlan.Prompt(men));
    }

    [Fact]
    public void MensStarterSet_IsOneRun_OfExactlyItsImageCalls()
    {
        var seed = Infrastructure.Services.LibraryCatalog.LoadEmbeddedSeed();
        var menIds = seed.Where(i => i.Segment == CatalogSegment.Men).Select(i => i.Id).ToList();

        var plan = LibraryImagePlan.Select(seed, menIds, force: false, budget: OpsArguments.MaxImageCallsPerRun);

        // docs/images.md: the owner approves this many image calls (one per piece, none has an image yet).
        Assert.Equal(27, menIds.Count);
        Assert.Equal(menIds.Count, plan.ToGenerate.Count);
        Assert.Empty(plan.Skipped);
        Assert.True(menIds.Count <= OpsArguments.MaxImageCallsPerRun);
    }
}

public class WebpImageTests
{
    private static byte[] Vp8(int width, int height, int totalBytes)
    {
        var data = new byte[Math.Max(30, totalBytes)];
        "RIFF"u8.CopyTo(data);
        "WEBP"u8.CopyTo(data.AsSpan(8));
        "VP8 "u8.CopyTo(data.AsSpan(12));
        data[23] = 0x9d; data[24] = 0x01; data[25] = 0x2a;
        data[26] = (byte)width; data[27] = (byte)(width >> 8);
        data[28] = (byte)height; data[29] = (byte)(height >> 8);
        return data;
    }

    private static byte[] Vp8X(int width, int height)
    {
        var data = new byte[40];
        "RIFF"u8.CopyTo(data);
        "WEBP"u8.CopyTo(data.AsSpan(8));
        "VP8X"u8.CopyTo(data.AsSpan(12));
        var w = width - 1;
        var h = height - 1;
        data[24] = (byte)w; data[25] = (byte)(w >> 8); data[26] = (byte)(w >> 16);
        data[27] = (byte)h; data[28] = (byte)(h >> 8); data[29] = (byte)(h >> 16);
        return data;
    }

    [Fact]
    public void Dimensions_AreReadFromTheHeader()
    {
        Assert.Equal((1024, 1024), WebpImage.Dimensions(Vp8(1024, 1024, 100)));
        Assert.Equal((1536, 1024), WebpImage.Dimensions(Vp8X(1536, 1024)));
        Assert.Null(WebpImage.Dimensions([0xFF, 0xD8, 0xFF]));
    }

    [Fact]
    public void Fits_EnforcesSideAndSize()
    {
        Assert.True(WebpImage.Fits(Vp8(1024, 1024, 100_000)));
        Assert.False(WebpImage.Fits(Vp8(1024, 1024, WebpImage.MaxBytes)));
        Assert.False(WebpImage.Fits(Vp8X(1536, 1024)));
    }

    [Fact]
    public void Redact_HidesKeysAndBearerTokens()
    {
        var text = OpsOutput.Redact("key sk-proj-abcdefghijkl1234 and Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.x.y");

        Assert.DoesNotContain("abcdefghijkl1234", text);
        Assert.DoesNotContain("eyJhbGciOiJIUzI1NiJ9", text);
    }

    [Fact]
    public void ImageGenerationRequest_DefaultsToSquareWebp()
    {
        var request = new ImageGenerationRequest("p");

        Assert.Equal("1024x1024", request.Size);
        Assert.Equal("webp", request.OutputFormat);
    }
}
