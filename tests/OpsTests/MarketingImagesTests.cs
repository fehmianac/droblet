using Ops;
using Ops.Commands;

namespace OpsTests;

public class MarketingImagesTests
{
    private static (OpsArguments? Args, string? Error) Parse(params string[] args) => OpsArguments.Parse(args);

    [Fact]
    public void RequiresMax_AndCapsItAtSix()
    {
        Assert.Contains("--max is required", Parse("generate-marketing-images", "--stage", "dev").Error);
        Assert.Contains("1–6", Parse("generate-marketing-images", "--stage", "dev", "--max", "7").Error);
        Assert.Contains("1–6", Parse("generate-marketing-images", "--stage", "dev", "--max", "0").Error);

        var (args, error) = Parse("generate-marketing-images", "--stage", "dev", "--max", "6", "--dry-run");
        Assert.Null(error);
        Assert.Equal(6, args!.MaxMarketingCalls);
        Assert.True(args.DryRun);
    }

    [Fact]
    public void IsDevOnly_AndPromptFileMustComeFromOpsPresets()
    {
        Assert.Contains("refused on prod", Parse("generate-marketing-images", "--stage", "prod", "--max", "1").Error);
        Assert.NotNull(Parse("generate-marketing-images", "--stage", "dev", "--max", "1", "--prompts", "/etc/passwd").Error);
        Assert.Null(Parse("generate-marketing-images", "--stage", "dev", "--max", "1", "--prompts", "ops-presets/welcome-images.json").Error);
    }

    [Fact]
    public void CheckedInWelcomeFile_IsValid_SixPrompts_TwoPerSegment()
    {
        var file = MarketingImageFile.Parse(File.ReadAllText(Path.Combine(RepoRoot(), "ops-presets", "welcome-images.json")));

        Assert.Empty(file.Problems());
        Assert.Equal(6, file.Images.Count);
        Assert.All(new[] { "women", "men", "mixed" }, s => Assert.Equal(2, file.Images.Count(i => i.Segment == s)));
        Assert.All(file.Images, i => Assert.Contains("no text", file.PromptFor(i)));
    }

    [Fact]
    public void Select_HonoursOnlyAndCap()
    {
        var file = new MarketingImageFile("1024x1536", "high", "jpeg", "style", [new("a", null, "p"), new("b", null, "p"), new("c", null, "p")]);

        Assert.Equal(["a", "b"], file.Select([], 2).Selected.Select(i => i.Id));
        Assert.Equal(["c"], file.Select(["c"], 6).Selected.Select(i => i.Id));
        Assert.Equal(["zz"], file.Select(["zz"], 6).Unknown);
    }

    private static string RepoRoot()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
            if (Directory.Exists(Path.Combine(dir.FullName, "ops-presets")))
                return dir.FullName;
        throw new DirectoryNotFoundException("ops-presets");
    }
}
