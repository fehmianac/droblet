using Domain.Options;
using Domain.Services.Styling;
using Microsoft.Extensions.Configuration;
using Ops;
using Ops.Commands;

namespace OpsTests;

public class AiCostCommandTests
{
    private static AiPricingOptions Pricing() => new()
    {
        Models = new(StringComparer.OrdinalIgnoreCase)
        {
            ["gpt-6-astra"] = new AiModelPrice { Input = 10, CachedInput = 1, Output = 50 },
            ["gpt-image-2.5-sunburst"] = new AiModelPrice { Input = 5, ImageInput = 8, ImageOutput = 30 },
        },
    };

    [Fact]
    public void Parse_TheWorkersTimingsLine_WithAndWithoutTheCostTail()
    {
        const string line = "Job timings 01JOB ItemProcess attempt 1 cold False: ai.image_cleanup=9000 worker=12000 | ai calls " +
                            "item_detection gpt-6-astra-2026-09-08 4100ms 200 in 1800 (cached 0) out 900 (reasoning 600) effort - img -/- req 300000B; " +
                            "image_cleanup gpt-image-2.5-sunburst 9000ms 200 in 1400 (cached ) out 1056 (reasoning ) effort - img 1024x1024/low req 280000B imgin 1200 tier - usd 0.04; " +
                            "image_cleanup gpt-image-2.5-sunburst 3000ms 0 in  (cached ) out  (reasoning ) effort - img 1024x1536/default req 280000B";

        var job = AiCostLog.Parse(DateTime.UnixEpoch, "item-processor", line)!;

        Assert.Equal(("01JOB", "ItemProcess", 3), (job.JobId, job.Kind, job.Calls.Count));
        var detection = job.Calls[0];
        Assert.Equal(("item_detection", "gpt-6-astra-2026-09-08", 1800L, 900L, 600L), (detection.Operation, detection.Model, detection.InputTokens!.Value, detection.OutputTokens!.Value, detection.ReasoningTokens!.Value));
        Assert.Equal((1800m * 10 + 900m * 50) / 1_000_000m, AiCostLog.Cost(Pricing(), detection));

        var cleanup = job.Calls[1];
        Assert.Equal((1200L, "low", "1024x1024", 0.04m), (cleanup.InputImageTokens!.Value, cleanup.ImageQuality, cleanup.ImageSize, cleanup.CostUsd!.Value));
        Assert.Equal((200m * 5 + 1200m * 8 + 1056m * 30) / 1_000_000m, AiCostLog.Cost(Pricing(), cleanup));

        Assert.Equal(0, job.Calls[2].Status);                    // cancelled speculative cleanup
        Assert.Null(AiCostLog.Cost(Pricing(), job.Calls[2]));
    }

    [Fact]
    public void Parse_OldImageLine_AssumesAShortTextPrompt()
    {
        var call = AiCostLog.ParseCall("image_tryon gpt-image-2.5-sunburst 21000ms 200 in 2400 (cached 0) out 4000 (reasoning ) effort - img 1024x1536/medium req 900000B")!;
        var expected = (AiCostLog.AssumedImagePromptTokens * 5m + (2400 - AiCostLog.AssumedImagePromptTokens) * 8m + 4000m * 30) / 1_000_000m;
        Assert.Equal(expected, AiCostLog.Cost(Pricing(), call));
        Assert.Null(AiCostLog.Parse(DateTime.UnixEpoch, "stylist", "OpenAI outfit ok, model x"));
    }

    [Fact]
    public void Variants_ParseAndApply_ToACopyOfTheOptions()
    {
        var variants = CostVariant.ParseAll("base;low:effort=low,detail.photo_check=low,maxout.outfit=6000,tier.item_match=flex;img:quality=low,size=1024x1024,uses=cleanup");
        Assert.Equal(["base", "low", "img"], variants.Select(v => v.Name));

        var options = new AiOptions { ReasoningEffort = new(StringComparer.OrdinalIgnoreCase) { ["outfit"] = "high" } };
        variants[1].Apply(options);
        Assert.Equal("low", options.EffortFor("outfit") is null ? null : options.ReasoningEffort["Default"]);
        Assert.False(options.ReasoningEffort.ContainsKey("outfit"));        // effort= replaces every per-operation effort
        Assert.Equal("low", options.DetailFor("photo_check", null));
        Assert.Equal(6000, options.MaxOutputTokensFor("outfit"));
        Assert.Equal("flex", options.TierFor("item_match"));

        variants[2].Apply(options);
        Assert.Equal(("1024x1024", "low"), options.ImageFor(ImageUse.Cleanup));
        Assert.Null(options.ImageFor(ImageUse.TryOn).Quality);               // uses=cleanup leaves try-on alone
        Assert.True(variants[0].Compact(true));
        Assert.Equal(30, CostVariant.ParseAll("c:cap=30,compact=1")[0].Cap(60));
        CostVariant.ParseAll("c:cap=30,compact=1,weekbatch=0")[0].Apply(new AiOptions());   // stylist keys leave the AI options alone
    }

    [Theory]
    [InlineData("bad name:effort=low")]
    [InlineData("x:unknown=1")]
    [InlineData("x:effort=lo w")]
    public void Variants_RejectUnknownKeysAndOddValues(string raw) => Assert.NotNull(CostVariant.ParseError(raw));

    [Theory]
    [InlineData("--days", "0")]
    [InlineData("--days", "91")]
    [InlineData("--reps", "4")]
    [InlineData("--max-text-calls", "121")]
    [InlineData("--text-variants", "x:nope=1")]
    public void Arguments_AreBounded(string option, string value)
    {
        var (args, error) = OpsArguments.Parse(["ai-cost", "--stage", "dev", option, value]);
        Assert.Null(args);
        Assert.NotNull(error);
    }

    [Fact]
    public void Arguments_AiCost_IsDevOnly_AndTakesItsFlags()
    {
        Assert.Contains("refused on prod", OpsArguments.Parse(["ai-cost", "--stage", "prod"]).Error);
        var (args, error) = OpsArguments.Parse(["ai-cost", "--stage", "dev", "--usage-only", "--days", "14", "--text-variants", "base;low:effort=low"]);
        Assert.Null(error);
        Assert.True(args!.Flag("usage-only"));
    }

    [Fact]
    public void Flows_AndProfiles_ArePricedFromTheOperations()
    {
        decimal Text(string op) => op switch { "outfit" => 0.03m, "item_detection (1 piece)" => 0.02m, "item_detection (5 pieces)" => 0.03m, "item_match (same piece)" => 0.005m, _ => 0.01m };
        decimal Image(string op) => op switch { "image_cleanup (sweater)" => 0.05m, "image_cleanup (jeans crop)" => 0.04m, "image_tryon (body + 2)" => 0.2m, _ => 0 };

        var flows = AiCostCommand.Flows(Text, Image, speculative: true);

        Assert.Equal(0.07m, flows["item photo (1 piece)"]);
        Assert.Equal(0.03m + 3 * 0.04m + 0.05m, flows["item photo (3 of 5 kept)"]);       // + the wasted speculative cleanup
        Assert.Equal(0.03m + 3 * 0.005m + 2 * 0.04m, flows["outfit import photo"]);
        Assert.Equal(AiCostCommand.FlowNames.Order(), flows.Keys.Order());
        Assert.All(AiCostCommand.Profiles, p => Assert.All(p.Usage.Keys, k => Assert.Contains(k, AiCostCommand.FlowNames)));
        Assert.Equal(0.03m + 3 * 0.04m, AiCostCommand.Flows(Text, Image, speculative: false)["item photo (3 of 5 kept)"]);
    }

    [Fact]
    public void SyntheticWardrobe_HasRealLengthIds_AndEveryCategory()
    {
        var wardrobe = AiCostCommand.SyntheticWardrobe();
        Assert.Equal(40, wardrobe.Count);
        Assert.All(wardrobe, i => Assert.Equal(26, i.Id.Length));
        Assert.Equal(7, wardrobe.Select(i => i.Category).Distinct().Count());
    }

    [Fact]
    public void TemplatePricing_IsFoundFromTheWorkingDirectory()
    {
        var json = TemplatePricing.Json(AppContext.BaseDirectory);
        Assert.NotNull(json);
        Assert.Contains("\"gpt-6-astra\"", json);
        Assert.Contains("\"gpt-image-2.5-sunburst\"", json);
        var keys = TemplatePricing.Flatten(json!, "Ai:Pricing");
        Assert.Equal("10", keys["Ai:Pricing:Models:gpt-6-astra:Input"]);
        var bound = new ConfigurationBuilder().AddInMemoryCollection(keys).Build().GetSection("Ai").Get<AiOptions>()!;
        Assert.Equal(50m, bound.Pricing.For("gpt-6-astra")!.Output);
        _ = StylingJson.Options; // the styling contracts are reachable from ops (same prompt builder as the worker)
    }
}
