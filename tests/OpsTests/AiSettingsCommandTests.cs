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

public class GoogleAuthCommandTests
{
    [Fact]
    public void AddClientId_AppendsOnce_AndKeepsOtherFields()
    {
        const string id = "246101741985-hka3auqnqlnlu891bt4g1jcbdr6q212t.apps.googleusercontent.com";
        var once = Ops.Commands.GoogleAuthCommand.AddClientId("{\"AndroidPackage\":\"com.alatech.droplet\",\"ClientIds\":[]}", id);
        Assert.Equal("{\"AndroidPackage\":\"com.alatech.droplet\",\"ClientIds\":[\"" + id + "\"]}", once);
        Assert.Equal(once, Ops.Commands.GoogleAuthCommand.AddClientId(once, id));
        Assert.Null(Ops.OpsArguments.Parse(["google-auth", "--stage", "dev", "--add-client-id", id]).Error);
        Assert.NotNull(Ops.OpsArguments.Parse(["google-auth", "--stage", "dev", "--add-client-id", "not-an-id"]).Error);
    }
}

public class GoogleAuthRepairTests
{
    [Fact]
    public void AddClientId_RepairsALineBreakTypedIntoTheValue()
    {
        const string ios = "246101741985-hka3auqnqlnlu891bt4g1jcbdr6q212t.apps.googleusercontent.com";
        const string android = "246101741985-1lsr1d53gkivi11q791t6a75ikjsogdr.apps.googleusercontent.com";
        var broken = "{\"AndroidPackage\":\"com.alatech.droplet\",\"ClientIds\":[\"" + ios + "\n\"]}";
        Assert.Equal("{\"AndroidPackage\":\"com.alatech.droplet\",\"ClientIds\":[\"" + ios + "\",\"" + android + "\"]}",
            Ops.Commands.GoogleAuthCommand.AddClientId(broken, android));
    }
}
