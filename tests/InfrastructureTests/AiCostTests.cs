using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using Domain.Domain;
using Domain.Enum;
using Domain.Options;
using Domain.Services;
using Domain.Services.Ai;
using Infrastructure.Ai;
using Infrastructure.Telemetry;
using Infrastructure.Workers;
using Microsoft.Extensions.Logging.Abstractions;

namespace InfrastructureTests;

/// <summary>Cost accounting (Ai:Pricing) and the per-operation cost knobs of the provider (detail, max tokens, service tier).</summary>
public class AiCostTests
{
    private static AiPricingOptions Pricing() => new()
    {
        Models = new(StringComparer.OrdinalIgnoreCase)
        {
            ["text-model"] = new AiModelPrice { Input = 10, CachedInput = 1, Output = 50 },
            ["text-model-mini"] = new AiModelPrice { Input = 1, CachedInput = 0.1m, Output = 5 },
            ["image-model"] = new AiModelPrice { Input = 5, CachedInput = 1.25m, ImageInput = 8, ImageCachedInput = 2, ImageOutput = 30 },
        },
        TierMultipliers = new(StringComparer.OrdinalIgnoreCase) { ["flex"] = 0.5m },
        ImageFallback = new(StringComparer.OrdinalIgnoreCase) { ["low/1024x1024"] = 0.006m },
        UsdTry = 43,
    };

    [Fact]
    public void Text_UncachedInput_CachedInput_AndOutput_ArePricedSeparately()
    {
        // 1500 in (1024 cached), 300 out: 476 × 10 + 1024 × 1 + 300 × 50 per 1M.
        var cost = AiCost.Estimate(Pricing(), "outfit", "text-model", null, new AiUsage(1500, 1024, 300));
        Assert.Equal((476m * 10 + 1024m * 1 + 300m * 50) / 1_000_000m, cost);
    }

    [Fact]
    public void DatedSnapshot_UsesTheLongestMatchingEntry_AndFlexHalvesThePrice()
    {
        var pricing = Pricing();
        Assert.Same(pricing.Models["text-model-mini"], pricing.For("text-model-mini-2026-09-08"));
        Assert.Same(pricing.Models["text-model"], pricing.For("text-model-2026-01-01"));
        Assert.Null(pricing.For("other-model"));

        var standard = AiCost.Estimate(pricing, "item_match", "text-model-mini", null, new AiUsage(1000, 0, 100))!.Value;
        Assert.Equal(standard / 2, AiCost.Estimate(pricing, "item_match", "text-model-mini", "flex", new AiUsage(1000, 0, 100)));
        Assert.Null(AiCost.Estimate(pricing, "outfit", "unknown", null, new AiUsage(1000, 0, 100)));
    }

    [Fact]
    public void ImageEdit_TextAndImageInput_AndOutputTokens_ArePricedSeparately_WithAFallbackPerImage()
    {
        // 2200 input of which 2000 image tokens, 1000 output image tokens.
        var cost = AiCost.Estimate(Pricing(), "image_cleanup", "image-model", null, new AiUsage(2200, null, 1000, 2000), "1024x1024", "low");
        Assert.Equal((200m * 5 + 2000m * 8 + 1000m * 30) / 1_000_000m, cost);

        Assert.Equal(0.006m, AiCost.Estimate(Pricing(), "image_cleanup", "image-model", null, new AiUsage(null, null, null), "1024x1024", "low"));
        Assert.Null(AiCost.Estimate(Pricing(), "image_tryon", "image-model", null, new AiUsage(null, null, null), "1024x1536", "high"));
        Assert.Equal(1_234_568, AiCost.Micro(1.2345675m));
    }

    [Fact]
    public void CostSnapshot_SumsPerOperation_CountsCalls_AndHasATotal()
    {
        var timings = new StageTimings();
        Assert.Null(timings.CostSnapshot());
        timings.AddCall(new AiCallRecord("image_cleanup", "image-model", 1000, 200, CostUsd: 0.04m));
        timings.AddCall(new AiCallRecord("image_cleanup", "image-model", 1000, 0));   // cancelled: no cost, still a call
        timings.AddCall(new AiCallRecord("item_detection", "text-model", 1000, 200, CostUsd: 0.012345m));

        var cost = timings.CostSnapshot()!;

        Assert.Equal(40_000, cost["image_cleanup"]);
        Assert.Equal(2, cost["calls.image_cleanup"]);
        Assert.Equal(12_345, cost["item_detection"]);
        Assert.Equal(52_345, cost["total"]);
    }

    [Fact]
    public void EmbeddedMetrics_CarryCostAndReasoningTokens()
    {
        var timings = new StageTimings { JobKind = "StylistOutfit" };
        timings.AddCall(new AiCallRecord("outfit", "text-model", 5000, 200, 1500, 900, 0, 700, ServiceTier: "flex", CostUsd: 0.05m));

        var document = EmbeddedMetrics.Documents(timings, "dev", DateTimeOffset.UnixEpoch).Select(d => JsonNode.Parse(d)!)
            .Single(d => d["OutputTokens"] is not null);

        Assert.Equal(50_000, document["CostMicroUsd"]!.GetValue<double>());
        Assert.Equal(700, document["ReasoningTokens"]!.GetValue<double>());
        Assert.Equal("flex", document["ServiceTier"]!.GetValue<string>());
    }

    [Fact]
    public void TimingsLine_DescribesCostTierAndImageTokens()
    {
        var line = JobMessageHandler.Describe(new AiCallRecord("image_tryon", "image-model", 21000, 200, 2400, 4000, 0, null, "1024x1536", "low", 900_000, null, 2200, null, 0.15m));
        Assert.EndsWith("imgin 2200 tier - usd 0.15", line);
    }

    // ── Provider ───────────────────────────────────────────────────────────────────────────────────────────────────

    private sealed class Handler(string body) : HttpMessageHandler
    {
        public List<string> Bodies { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Bodies.Add(request.Content is null ? "" : Encoding.Latin1.GetString(await request.Content.ReadAsByteArrayAsync(cancellationToken)));
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        }
    }

    private const string PhotoCheckAnswer = """
        {"model":"text-model-mini-2026-09-08","choices":[{"finish_reason":"stop","message":{"content":"{\"people\":1,\"fullBody\":true,\"faceVisible\":true,\"tooDark\":false,\"blurry\":false,\"appearsMinor\":false}","refusal":null}}],
         "usage":{"prompt_tokens":1000,"completion_tokens":100,"total_tokens":1100,"prompt_tokens_details":{"cached_tokens":0},"completion_tokens_details":{"reasoning_tokens":40}}}
        """;

    private static (OpenAiProvider Provider, Handler Handler) Provider(Action<AiOptions> configure, string answer = PhotoCheckAnswer)
    {
        var options = new AiOptions { Enabled = true, ApiKey = "sk-test", TextModel = "text-model", ImageModel = "image-model", BaseUrl = "https://ai.test/", TimeoutSeconds = 5, Pricing = Pricing() };
        configure(options);
        var handler = new Handler(answer);
        return (new OpenAiProvider(new HttpClient(handler), new StaticOptions(options), NullLogger<OpenAiProvider>.Instance), handler);
    }

    [Fact]
    public async Task EveryCall_RecordsItsCost_FromTheModelTheApiAnsweredWith_AndTheTier()
    {
        var (provider, _) = Provider(o => o.ServiceTiers["photo_check"] = "flex");
        var timings = AiTelemetry.Begin();
        try
        {
            await provider.InspectAsync(new ImageInput([1, 2, 3], "image/jpeg"), PhotoKind.Body, default);
        }
        finally
        {
            AiTelemetry.End();
        }

        var call = Assert.Single(timings.Calls);
        Assert.Equal("flex", call.ServiceTier);
        Assert.Equal((1000m * 1 + 100m * 5) / 1_000_000m / 2, call.CostUsd);   // priced as text-model-mini (answered model), flex
    }

    [Fact]
    public async Task VisionDetail_MaxOutputTokens_AndServiceTier_ArePerOperation_AndNotSentWhenUnset()
    {
        var (plain, plainHandler) = Provider(_ => { });
        await plain.InspectAsync(new ImageInput([1], "image/jpeg"), PhotoKind.Face, default);
        var body = JsonNode.Parse(plainHandler.Bodies[0])!;
        Assert.Null(body["max_completion_tokens"]);
        Assert.Null(body["service_tier"]);
        Assert.Null(body["messages"]![1]!["content"]![1]!["image_url"]!["detail"]);

        var (tuned, tunedHandler) = Provider(o =>
        {
            o.VisionDetail["photo_check"] = "low";
            o.MaxOutputTokens["Default"] = 4000;
            o.ServiceTiers["photo_check"] = "flex";
            o.ServiceTier = "priority";
        });
        await tuned.InspectAsync(new ImageInput([1], "image/jpeg"), PhotoKind.Face, default);
        body = JsonNode.Parse(tunedHandler.Bodies[0])!;
        Assert.Equal("low", body["messages"]![1]!["content"]![1]!["image_url"]!["detail"]!.GetValue<string>());
        Assert.Equal(4000, body["max_completion_tokens"]!.GetValue<int>());
        Assert.Equal("flex", body["service_tier"]!.GetValue<string>());
    }

    [Fact]
    public async Task ItemDetection_StaysHighDetail_UnlessConfigured()
    {
        const string detection = """{"model":"text-model","choices":[{"finish_reason":"stop","message":{"content":"{\"items\":[]}","refusal":null}}],"usage":{"prompt_tokens":10,"completion_tokens":5}}""";
        var (provider, handler) = Provider(_ => { }, detection);
        await provider.DetectItemsAsync(new ImageInput([1], "image/jpeg"), "tr", default);
        Assert.Equal("high", JsonNode.Parse(handler.Bodies[0])!["messages"]![1]!["content"]![1]!["image_url"]!["detail"]!.GetValue<string>());

        var (low, lowHandler) = Provider(o => o.VisionDetail["item_detection"] = "auto", detection);
        await low.DetectItemsAsync(new ImageInput([1], "image/jpeg"), "tr", default);
        Assert.Equal("auto", JsonNode.Parse(lowHandler.Bodies[0])!["messages"]![1]!["content"]![1]!["image_url"]!["detail"]!.GetValue<string>());
    }

    [Fact]
    public void ImageUsage_ReadsTheImagePartOfTheInput()
    {
        var usage = OpenAiPayloads.Usage("""{"usage":{"input_tokens":2300,"input_tokens_details":{"text_tokens":200,"image_tokens":2100},"output_tokens":1056}}""");
        Assert.Equal((2300L, 2100L, 1056L), (usage.Input!.Value, usage.InputImage!.Value, usage.Output!.Value));
    }

    private sealed class StaticOptions(AiOptions value) : Microsoft.Extensions.Options.IOptionsMonitor<AiOptions>
    {
        public AiOptions CurrentValue => value;
        public AiOptions Get(string? name) => value;
        public IDisposable? OnChange(Action<AiOptions, string?> listener) => null;
    }

    // ── Guardrails (AiLimits) ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task AiUsageGuard_DailyCapCountsUnits_PerTenant_AndTheMinuteCapCountsStarts_ZeroIsOff()
    {
        var clock = new Microsoft.Extensions.Time.Testing.FakeTimeProvider(new DateTimeOffset(2026, 11, 19, 10, 0, 0, TimeSpan.Zero));
        var limits = new AiLimitsOptions { ItemRecognitionsPerDay = 10, AiStartsPerMinute = 3 };
        var guard = new Infrastructure.Services.AiUsageGuard(new Infrastructure.Services.RateLimiter(new Tests.Shared.InMemoryRepository(), clock),
            new StaticMonitor<AiLimitsOptions>(limits), NullLogger<Infrastructure.Services.AiUsageGuard>.Instance);

        Assert.True(await guard.AllowAsync("t1", AiCap.ItemRecognition, 8, default));
        Assert.False(await guard.AllowAsync("t1", AiCap.ItemRecognition, 3, default));    // 8 + 3 > 10: refused, its units given back
        Assert.True(await guard.AllowAsync("t2", AiCap.ItemRecognition, 1, default));     // another tenant
        Assert.True(await guard.AllowAsync("t1", AiCap.ItemRecognition, 2, default));     // 8 + 2 still fits
        Assert.False(await guard.AllowAsync("t1", AiCap.Stylist, 1, default));           // 4th start of t1 this minute
        clock.Advance(TimeSpan.FromMinutes(1));
        Assert.True(await guard.AllowAsync("t1", AiCap.Stylist, 1, default));            // stylist has no daily cap (0)
        clock.Advance(TimeSpan.FromDays(1));
        Assert.True(await guard.AllowAsync("t1", AiCap.ItemRecognition, 10, default));   // a new day
    }

    private sealed class StaticMonitor<T>(T value) : Microsoft.Extensions.Options.IOptionsMonitor<T>
    {
        public T CurrentValue => value;
        public T Get(string? name) => value;
        public IDisposable? OnChange(Action<T, string?> listener) => null;
    }
}
