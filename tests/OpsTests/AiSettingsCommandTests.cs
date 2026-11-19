using Ops;
using Ops.Commands;

namespace OpsTests;

public class AiSettingsCommandTests
{
    [Fact]
    public void TheRepoPreset_IsAValidAiSetting()
    {
        var root = new DirectoryInfo(AppContext.BaseDirectory);
        while (root is not null && !Directory.Exists(Path.Combine(root.FullName, "ops-presets")))
            root = root.Parent;
        Assert.NotNull(root);
        Assert.Null(AiSettingsCommand.Validate(File.ReadAllText(Path.Combine(root.FullName, "ops-presets", "dev-worker-ai.json"))));
    }

    [Theory]
    [InlineData("not json")]
    [InlineData("[1]")]
    [InlineData("{\"Provider\":\"OpenAI\",\"TextModel\":\"a\",\"ImageModel\":\"b\"}")]
    [InlineData("{\"Enabled\":true,\"Provider\":\"OpenAI\",\"TextModel\":\"a\",\"ImageModel\":\"b\",\"ApiKey\":\"sk-x\"}")]
    public void BadPresets_AreRefused(string json) => Assert.NotNull(AiSettingsCommand.Validate(json));

    [Fact]
    public void ItIsDevOnly_AndTakesOnlyARepoPreset()
    {
        Assert.Contains(OpsArguments.AiSettings, OpsArguments.DevOnly);
        Assert.NotNull(OpsArguments.Parse(["ai-settings", "--stage", "prod"]).Error);
        Assert.NotNull(OpsArguments.Parse(["ai-settings", "--stage", "dev", "--apply", "/etc/passwd"]).Error);
        Assert.Null(OpsArguments.Parse(["ai-settings", "--stage", "dev", "--apply", "ops-presets/dev-worker-ai.json"]).Error);
    }
}
