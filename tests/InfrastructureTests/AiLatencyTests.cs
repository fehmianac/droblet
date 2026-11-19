using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using Domain.Domain;
using Domain.Entity;
using Domain.Enum;
using Domain.Options;
using Domain.Services;
using Domain.Services.Ai;
using Infrastructure.Ai;
using Infrastructure.Telemetry;
using Infrastructure.Workers;
using Microsoft.Extensions.Logging.Abstractions;

namespace InfrastructureTests;

/// <summary>Stage timings, EMF, the poll hint and the latency settings of the provider (all optional, nothing sent when unset).</summary>
public class AiLatencyTests
{
    private sealed class FakeHandler(string body) : HttpMessageHandler
    {
        public List<string> Bodies { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Bodies.Add(request.Content is null ? "" : Encoding.Latin1.GetString(await request.Content.ReadAsByteArrayAsync(cancellationToken)));
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        }
    }

    private static AiOptions Options() =>
        new() { Enabled = true, ApiKey = "sk-test", TextModel = "text-model", ImageModel = "image-model", BaseUrl = "https://ai.test/", TimeoutSeconds = 5 };

    private const string ChatAnswer = """
        {"model":"text-model-2026","choices":[{"finish_reason":"stop","message":{"content":"{\"people\":1,\"fullBody\":true,\"faceVisible\":true,\"tooDark\":false,\"blurry\":false,\"appearsMinor\":false}","refusal":null}}],
         "usage":{"prompt_tokens":1500,"completion_tokens":80,"total_tokens":1580,"prompt_tokens_details":{"cached_tokens":1024},"completion_tokens_details":{"reasoning_tokens":64}}}
        """;

    [Fact]
    public void StageTimings_SumRepeatedStages_AndSetOverwrites()
    {
        var timings = new StageTimings();
        timings.Add("db", 10);
        timings.Add("db", 15);
        timings.Set("queue_wait", 100);
        timings.Set("queue_wait", 120);

        var snapshot = timings.Snapshot();
        Assert.Equal(25, snapshot["db"]);
        Assert.Equal(2, timings.CountOf("db"));
        Assert.Equal(120, snapshot["queue_wait"]);
        Assert.True(snapshot.ContainsKey("worker"));
    }

    [Fact]
    public async Task AiTelemetry_FlowsIntoParallelBranches_AndIsNoOpOutsideARun()
    {
        AiTelemetry.Add("ignored", 5); // no run: nothing happens
        var timings = AiTelemetry.Begin();
        try
        {
            await Task.WhenAll(
                Task.Run(() => AiTelemetry.Add("s3_get", 3)),
                Task.Run(() => AiTelemetry.Add("s3_get", 4)));
            Assert.Equal(7, timings.Snapshot()["s3_get"]);
        }
        finally
        {
            AiTelemetry.End();
        }
        Assert.Null(AiTelemetry.Current);
    }

    [Fact]
    public void QueueWait_IsNowMinusSentTimestamp()
    {
        var now = DateTimeOffset.FromUnixTimeMilliseconds(1_000_000);
        Assert.Equal(TimeSpan.FromMilliseconds(750), JobMessageHandler.QueueWait(new Dictionary<string, string> { ["SentTimestamp"] = "999250" }, now));
        Assert.Null(JobMessageHandler.QueueWait(new Dictionary<string, string>(), now));
        Assert.Null(JobMessageHandler.QueueWait(null, now));
    }

    [Fact]
    public void EmbeddedMetrics_OneDocumentPerStage_WithEnvJobStageDimensions_AndTokenDocumentsPerCall()
    {
        var timings = new StageTimings { JobKind = "TryOn", JobId = "job-1" };
        timings.Set("queue_wait", 40);
        timings.AddCall(new AiCallRecord("image_tryon", "image-model", 21000, 200, 900, 4000, 0, null, "1024x1536", "medium"));

        var documents = EmbeddedMetrics.Documents(timings, "dev", DateTimeOffset.FromUnixTimeMilliseconds(5)).Select(d => JsonNode.Parse(d)!).ToList();

        var stage = documents.Single(d => d["Stage"]!.GetValue<string>() == "queue_wait" && d["DurationMs"] is not null);
        var metric = stage["_aws"]!["CloudWatchMetrics"]![0]!;
        Assert.Equal("Droblet/Ai", metric["Namespace"]!.GetValue<string>());
        Assert.Equal(["Env", "Job", "Stage"], metric["Dimensions"]![0]!.AsArray().Select(n => n!.GetValue<string>()));
        Assert.Equal("dev", stage["Env"]!.GetValue<string>());
        Assert.Equal("TryOn", stage["Job"]!.GetValue<string>());
        Assert.Equal(40, stage["DurationMs"]!.GetValue<double>());
        Assert.Contains(documents, d => d["Stage"]!.GetValue<string>() == "ai.image_tryon" && d["DurationMs"] is not null);
        var tokens = documents.Single(d => d["Stage"]!.GetValue<string>() == "ai.image_tryon" && d["OutputTokens"] is not null);
        Assert.Equal(4000, tokens["OutputTokens"]!.GetValue<double>());
        Assert.Equal("medium", tokens["ImageQuality"]!.GetValue<string>());
    }

    [Theory]
    [InlineData(null, 0, null, 1000)]          // unknown kind: poll every second
    [InlineData(20000L, 2000, 18000L, 3000)]    // far from done: capped at 3 s
    [InlineData(20000L, 18200, 1800L, 1800)]    // almost done: poll when it should be ready
    [InlineData(20000L, 19800, 200L, 500)]      // never sooner than 500 ms
    [InlineData(20000L, 25000, 0L, 1000)]       // slower than usual: every second
    public void JobEta_Hint(long? typical, long elapsed, long? eta, long retry)
    {
        Assert.Equal((eta, retry), JobEta.Hint(typical, elapsed));
    }

    [Fact]
    public void JobEta_Update_IsAnEwma_StartingWithTheFirstSample()
    {
        Assert.Equal(10000, JobEta.Update(0, 0, 10000));
        Assert.Equal(12000, JobEta.Update(10000, 1, 20000));
    }

    [Fact]
    public void JobDto_CarriesTimings_AndTheHintOnlyWhileRunning()
    {
        var created = new DateTime(2026, 11, 19, 10, 0, 0, DateTimeKind.Utc);
        var job = new JobEntity { Id = "j", TenantId = "t", Kind = JobKind.TryOn, Status = JobStatus.Processing, CreatedAt = created, Timings = new() { ["worker"] = 5 } };

        var running = job.ToDto(20000, created.AddSeconds(5));
        Assert.Equal(15000, running.EtaMs);
        Assert.Equal(3000, running.RetryAfterMs);

        job.Status = JobStatus.Completed;
        var done = job.ToDto(20000, created.AddSeconds(5));
        Assert.Null(done.EtaMs);
        Assert.Null(done.RetryAfterMs);
        Assert.Equal(5, done.Timings!["worker"]);
    }

    [Fact]
    public void AiOptions_Resolution_DefaultsToTheOldBehaviour()
    {
        var o = Options();
        Assert.Equal("text-model", o.ModelFor("photo_check"));
        Assert.Null(o.EffortFor("outfit"));
        Assert.Equal(("1024x1536", (string?)null), o.ImageFor(ImageUse.TryOn));

        o.FastTextModel = "fast-model";
        o.ReasoningEffort["Default"] = "low";
        o.ReasoningEffort["photo_check"] = "minimal";
        o.Image.Quality = "medium";
        o.Image.TryOnQuality = "high";
        o.Image.CleanupSize = "1024x1024";
        Assert.Equal("fast-model", o.ModelFor("photo_check"));
        Assert.Equal("text-model", o.ModelFor("outfit"));
        Assert.Equal("minimal", o.EffortFor("PHOTO_CHECK"));
        Assert.Equal("low", o.EffortFor("week_plan"));
        Assert.Equal(("1024x1536", "high"), o.ImageFor(ImageUse.TryOn));
        Assert.Equal(("1024x1536", "low"), o.ImageFor(ImageUse.TryOn, "low"));
        Assert.Equal(("1024x1024", "medium"), o.ImageFor(ImageUse.Cleanup));
    }

    [Fact]
    public async Task Chat_SendsEffortTierAndCacheKey_OnlyWhenConfigured_AndRecordsUsage()
    {
        var handler = new FakeHandler(ChatAnswer);
        var plain = new OpenAiProvider(new HttpClient(handler), Fixtures.Monitor(Options()), NullLogger<OpenAiProvider>.Instance);
        await plain.InspectAsync(new ImageInput([1, 2, 3], "image/jpeg"), PhotoKind.Body, default);
        var body = JsonNode.Parse(handler.Bodies[0])!.AsObject();
        Assert.False(body.ContainsKey("reasoning_effort"));
        Assert.False(body.ContainsKey("service_tier"));
        Assert.False(body.ContainsKey("prompt_cache_key"));

        var tuned = Options();
        tuned.FastTextModel = "fast-model";
        tuned.ReasoningEffort["photo_check"] = "minimal";
        tuned.ServiceTier = "priority";
        tuned.PromptCacheKey = true;
        var provider = new OpenAiProvider(new HttpClient(handler), Fixtures.Monitor(tuned), NullLogger<OpenAiProvider>.Instance);
        var timings = AiTelemetry.Begin();
        try
        {
            await provider.InspectAsync(new ImageInput([1, 2, 3], "image/jpeg"), PhotoKind.Body, default);
        }
        finally
        {
            AiTelemetry.End();
        }
        body = JsonNode.Parse(handler.Bodies[1])!.AsObject();
        Assert.Equal("fast-model", body["model"]!.GetValue<string>());
        Assert.Equal("minimal", body["reasoning_effort"]!.GetValue<string>());
        Assert.Equal("priority", body["service_tier"]!.GetValue<string>());
        Assert.Equal("droblet-photo_check", body["prompt_cache_key"]!.GetValue<string>());

        var call = Assert.Single(timings.Calls);
        Assert.Equal(("photo_check", "text-model-2026", 1500L, 80L, 1024L, 64L, "minimal"),
            (call.Operation, call.Model, call.InputTokens, call.OutputTokens, call.CachedTokens, call.ReasoningTokens, call.ReasoningEffort));
        Assert.True(timings.Snapshot().ContainsKey("ai.photo_check"));
    }

    [Fact]
    public async Task ImageEdit_SendsQualityAndFidelity_OnlyWhenConfigured()
    {
        var webp = Convert.ToBase64String([.. "RIFF"u8, 0, 0, 0, 0, .. "WEBP"u8, 1]);
        var handler = new FakeHandler($$$"""{"data":[{"b64_json":"{{{webp}}}"}],"usage":{"input_tokens":700,"output_tokens":1500}}""");
        var options = Options();
        var provider = new OpenAiProvider(new HttpClient(handler), Fixtures.Monitor(options), NullLogger<OpenAiProvider>.Instance);
        var photo = new ImageInput([0xFF, 0xD8, 0xFF], "image/jpeg");

        await provider.RenderAsync(photo, [photo], default);
        Assert.DoesNotContain("name=quality", handler.Bodies[0]);
        Assert.DoesNotContain("name=input_fidelity", handler.Bodies[0]);

        options.Image.TryOnQuality = "medium";
        options.Image.TryOnInputFidelity = "low";
        await provider.RenderAsync(photo, [photo], default);
        Assert.Contains("name=quality", handler.Bodies[1]);
        Assert.Contains("medium", handler.Bodies[1]);
        Assert.Contains("name=input_fidelity", handler.Bodies[1]);

        await provider.RenderFromFaceAsync(photo, [photo], new TryOnFigure(BodyType.Pear, null, null), default, quality: "low");
        Assert.Contains("low", handler.Bodies[2].Split("name=quality")[1][..40]);

        await provider.CleanupItemAsync(photo, ItemCategoryHint.Top, null, default);
        Assert.DoesNotContain("name=input_fidelity", handler.Bodies[3]);
    }

    [Fact]
    public void Usage_ReadsChatAndImageShapes_Defensively()
    {
        Assert.Equal(new TokenUsage(1500, 80, 1024, 64), OpenAiPayloads.Usage(ChatAnswer));
        Assert.Equal(new TokenUsage(700, 1500, null, null), OpenAiPayloads.Usage("""{"usage":{"input_tokens":700,"output_tokens":1500}}"""));
        Assert.Equal(new TokenUsage(null, null, null, null), OpenAiPayloads.Usage("nope"));
    }
}
