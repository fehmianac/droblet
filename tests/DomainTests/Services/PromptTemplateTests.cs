using System.Text.Json;
using Domain.Services.Admin;
using Domain.Services.Ai;

namespace DomainTests.Services;

public class PromptTemplateTests
{
    [Fact]
    public void Render_ReplacesKnownPlaceholders_InOnePass_AndLeavesUnknownOnesAsTheyAre()
    {
        var text = PromptTemplate.Render("A {{x}} and {{y}}, {{x}} again, {{z}}", ("x", "{{y}}"), ("y", "2"));
        Assert.Equal("A {{y}} and 2, {{y}} again, {{z}}", text);
    }

    [Fact]
    public void Render_WithoutValues_ReturnsTheTemplateUnchanged()
    {
        Assert.Equal("plain {{x}}", PromptTemplate.Render("plain {{x}}", (IReadOnlyDictionary<string, string>?)null));
    }

    [Fact]
    public void Placeholders_AreDistinct_InOrderOfFirstUse()
    {
        Assert.Equal(["b", "a"], PromptTemplate.Placeholders("{{b}} {{a}} {{b}}"));
        Assert.Empty(PromptTemplate.Placeholders("no variables"));
    }

    [Theory]
    [InlineData("{{ name }}", true)]
    [InlineData("{{name", true)]
    [InlineData("name}}", true)]
    [InlineData("{{1name}}", true)]
    [InlineData("{{name}} and {single} braces", false)]
    [InlineData("JSON like {\"a\": 1}", false)]
    public void Malformed_Placeholders_AreDetected(string template, bool malformed)
    {
        Assert.Equal(malformed, PromptTemplate.HasMalformedPlaceholder(template));
    }

    [Fact]
    public void StaticPrefix_IsTheTextBeforeTheFirstPlaceholder()
    {
        Assert.Equal(6, PromptTemplate.StaticPrefixLength("Hello {{who}}"));
        Assert.Equal(5, PromptTemplate.StaticPrefixLength("Hello"));
    }
}

public class AiModelSettingsCatalogTests
{
    private static JsonElement Json(string raw) => JsonDocument.Parse(raw).RootElement.Clone();

    private static Dictionary<string, string[]> Validate(string key, string raw) =>
        SettingsCatalog.Validate(SettingsCatalog.AiModels, new Dictionary<string, JsonElement> { [key] = Json(raw) });

    [Fact]
    public void AiModels_IsOwnedByAiManage_AndWritesOnlyWorkerAi()
    {
        Assert.Equal(AdminPermissions.AiManage, SettingsCatalog.AiModels.Permission);
        Assert.Equal("/droblet/dev/worker/Ai", Assert.Single(SettingsCatalog.AiModels.Parameters).Name("dev"));
        Assert.Contains(SettingsCatalog.AiModels, SettingsCatalog.Groups);
        Assert.DoesNotContain(SettingsCatalog.AiModels.Fields, f => f.Key.Contains("ApiKey", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void EveryTextOperation_HasItsOwnReasoningEffort()
    {
        foreach (var operation in SettingsCatalog.AiTextOperations)
            Assert.Contains(SettingsCatalog.AiModels.Fields, f => f.Key == $"ReasoningEffort.{operation}" && f.Nullable);
    }

    [Theory]
    [InlineData("TextModel", "\"gpt-6.1-sol\"", null)]
    [InlineData("TextModel", "\"ft:gpt-5-mini:org::abc\"", null)]
    [InlineData("TextModel", "\"bad model\"", "invalid")]
    [InlineData("TextModel", "null", "invalid")]
    [InlineData("FastTextModel", "null", null)]
    [InlineData("ReasoningEffort.outfit", "\"low\"", null)]
    [InlineData("ReasoningEffort.outfit", "\"turbo\"", "invalid")]
    [InlineData("ServiceTier", "\"flex\"", null)]
    [InlineData("FastTextOperations", "\"photo_check,item_match\"", null)]
    [InlineData("FastTextOperations", "\"\"", null)]
    [InlineData("FastTextOperations", "\"photo_check,try_on\"", "invalid")]
    [InlineData("Image.TryOnQuality", "\"medium\"", null)]
    [InlineData("Image.TryOnSize", "\"4096x4096\"", "invalid")]
    [InlineData("Prompts.FailureThreshold", "500", "out_of_range")]
    public void ModelFields_AreValidated(string key, string raw, string? error)
    {
        var errors = Validate(key, raw);
        if (error is null)
            Assert.Empty(errors);
        else
            Assert.Equal([error], errors[key]);
    }

    [Fact]
    public void Apply_NullRemovesTheKey_AndKeepsEveryOtherKey()
    {
        var current = """{"Enabled":true,"TextModel":"a","FastTextModel":"b","ReasoningEffort":{"outfit":"low","photo_check":"minimal"}}""";
        var next = SettingsCatalog.Apply(current, new Dictionary<string, JsonElement>
        {
            ["FastTextModel"] = Json("null"),
            ["ReasoningEffort.outfit"] = Json("null"),
            ["ReasoningEffort.packing"] = Json("\"high\""),
        });
        var root = JsonDocument.Parse(next).RootElement;
        Assert.True(root.GetProperty("Enabled").GetBoolean());
        Assert.Equal("a", root.GetProperty("TextModel").GetString());
        Assert.False(root.TryGetProperty("FastTextModel", out _));
        Assert.False(root.GetProperty("ReasoningEffort").TryGetProperty("outfit", out _));
        Assert.Equal("minimal", root.GetProperty("ReasoningEffort").GetProperty("photo_check").GetString());
        Assert.Equal("high", root.GetProperty("ReasoningEffort").GetProperty("packing").GetString());
    }
}
