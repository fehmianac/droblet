using System.Diagnostics;
using System.Text.Json;
using Amazon.S3;
using Domain.Enum;
using Domain.Options;
using Domain.Services.Ai;
using Infrastructure.Ai;
using Infrastructure.Telemetry;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Ops.Commands;

/// <summary>
/// ai-bench: direct provider calls (the workers' prompts and schemas, synthetic inputs only — no user content) to choose
/// the latency settings with numbers: reasoning effort per text operation (--efforts default,low,minimal), a fast text
/// model for the light operations (--models), image quality for try-on and cleanup (--qualities default,low,medium).
/// Prints duration and token usage per variant. Image-model calls are capped by the run's budget (--max-calls, ≤ 30).
/// The runner sits outside AWS, so absolute times include its own network path; compare variants with each other.
/// </summary>
internal static class AiBenchCommand
{
    private const string OutfitInput = """
        {"date":"2026-11-20","season":"autumn","occasion":"office","weather":{"MinTempC":6,"MaxTempC":12,"Condition":"cloudy"},"freeText":null,"language":"tr",
         "onlyMyWardrobe":true,"pinnedItemId":null,"avoidCombinations":[],"count":3,"productCandidates":[],
         "styleProfile":{"StyleTags":["minimal","classic"],"Budget":"mixed"},"palette":null,
         "candidates":[
          {"id":"t1","category":"top","colorIds":["white"],"fabric":"cotton","seasons":["spring","summer","autumn"]},
          {"id":"t2","category":"top","colorIds":["white"],"fabric":"cotton","seasons":["spring","autumn","winter"]},
          {"id":"t3","category":"top","colorIds":["black"],"fabric":"wool","seasons":["autumn","winter"]},
          {"id":"b1","category":"bottom","colorIds":["blue"],"fabric":"denim","seasons":["spring","summer","autumn","winter"]},
          {"id":"b2","category":"bottom","colorIds":["black"],"fabric":"wool","seasons":["autumn","winter","spring"]},
          {"id":"d1","category":"dress","colorIds":["black"],"fabric":"viscose","seasons":["spring","autumn","winter"]},
          {"id":"o1","category":"outerwear","colorIds":["navy"],"fabric":"wool","seasons":["autumn","spring"]},
          {"id":"o2","category":"outerwear","colorIds":["camel"],"fabric":"wool","seasons":["autumn","winter"]},
          {"id":"s1","category":"shoes","colorIds":["white"],"fabric":"leather","seasons":["spring","summer","autumn"]},
          {"id":"s2","category":"shoes","colorIds":["black"],"fabric":"leather","seasons":["autumn","winter"]},
          {"id":"g1","category":"bag","colorIds":["black"],"fabric":"leather","seasons":["spring","summer","autumn","winter"]},
          {"id":"a1","category":"accessory","colorIds":["beige"],"fabric":"silk","seasons":["spring","autumn"]}]}
        """;

    private static string WeekInput(int days)
    {
        var dates = Enumerable.Range(0, days).Select(i => new DateOnly(2026, 11, 23).AddDays(i)).ToList();
        var candidates = JsonDocument.Parse(OutfitInput).RootElement.GetProperty("candidates").GetRawText();
        var dayJson = string.Join(",", dates.Select((d, i) => $$"""{"Date":"{{d:yyyy-MM-dd}}","Occasion":"{{(i % 5 == 4 ? "dinner" : i >= 5 ? "weekend" : "office")}}","weather":null}"""));
        return $$"""{"weekStart":"2026-11-23","language":"tr","days":[{{dayJson}}],"styleProfile":{"StyleTags":["minimal","classic"],"Budget":"mixed"},"candidates":{{candidates}}}""";
    }

    private sealed record Row(string Call, string Variant, double Ms, string Outcome, AiCallRecord? Usage);

    public static async Task<int> RunAsync(IServiceProvider services, OpsArguments args, OpsOutput output, CancellationToken ct)
    {
        var baseline = services.GetRequiredService<IOptionsMonitor<AiOptions>>().CurrentValue;
        var reps = args.IntOption("reps", 2);
        var efforts = List(args.Option("efforts"), "default,low,minimal");
        var qualities = List(args.Option("qualities"), "default,low,medium");
        var models = List(args.Option("models"), "");
        var budget = new ImageCallBudget(args.MaxImageCalls);
        var s3 = services.GetRequiredService<IAmazonS3>();
        var fixtures = new SmokeFixtures(s3, services.GetRequiredService<OpenAiProvider>(), OpsHost.PhotoBucket(args.Stage), budget, output);
        var rows = new List<Row>();
        output.Line($"ai-bench: text {baseline.TextModel}, image {baseline.ImageModel}, {reps} rep(s), efforts {string.Join(",", efforts)}, qualities {string.Join(",", qualities)}, models {string.Join(",", models)}");
        await ListModelsAsync(baseline, output, ct);

        async Task Measure(string call, string variant, Func<OpenAiProvider, Task<string>> run, Action<AiOptions> configure)
        {
            var options = Clone(baseline);
            configure(options);
            var provider = new OpenAiProvider(new HttpClient { Timeout = Timeout.InfiniteTimeSpan }, new FixedOptions<AiOptions>(options),
                services.GetRequiredService<ILogger<OpenAiProvider>>());
            var timings = AiTelemetry.Begin();
            var watch = Stopwatch.StartNew();
            string outcome;
            try
            {
                outcome = await run(provider);
            }
            catch (Exception ex) when (ex is AiProviderException or HttpRequestException)
            {
                outcome = "failed: " + ex.Message;
            }
            finally
            {
                AiTelemetry.End();
            }
            rows.Add(new Row(call, variant, watch.Elapsed.TotalMilliseconds, outcome, timings.Calls.LastOrDefault()));
            output.Line($"{call} [{variant}] {watch.Elapsed.TotalSeconds:0.0}s {outcome}");
        }

        if (!args.Flag("image-only"))
        {
            var (face, _) = await fixtures.GetAsync(SmokeFixtures.Face, ct);
            var (garment, _) = await fixtures.GetAsync(SmokeFixtures.Garment, ct);
            for (var rep = 0; rep < reps; rep++)
            {
                foreach (var effort in efforts)
                {
                    void Effort(AiOptions o)
                    {
                        o.ReasoningEffort.Clear();
                        if (effort != "default") o.ReasoningEffort["Default"] = effort;
                    }
                    await Measure("outfit (3 looks, 12 candidates)", effort, async p => Summ(await p.GenerateAsync(new StylistPrompt(JobKind.StylistOutfit, OutfitInput, "tr"), ct)), Effort);
                    await Measure("week (7 days, one call)", effort, async p => Summ(await p.GenerateAsync(new StylistPrompt(JobKind.StylistWeek, WeekInput(7), "tr"), ct)), Effort);
                    await Measure("week (3 days, one batch)", effort, async p => Summ(await p.GenerateAsync(new StylistPrompt(JobKind.StylistWeek, WeekInput(3), "tr"), ct)), Effort);
                    await Measure("photo check (face)", effort, async p => (await p.InspectAsync(new ImageInput(face, "image/jpeg"), PhotoKind.Face, ct)).ToString(), Effort);
                    await Measure("item detection (1 garment)", effort, async p => $"{(await p.DetectItemsAsync(new ImageInput(garment, "image/jpeg"), "tr", ct)).Count} item(s)", Effort);
                }
                foreach (var model in models)
                {
                    void Fast(AiOptions o)
                    {
                        o.FastTextModel = model;
                        o.FastTextOperations = "photo_check,item_detection,outfit";
                    }
                    await Measure("outfit (3 looks, 12 candidates)", "model " + model, async p => Summ(await p.GenerateAsync(new StylistPrompt(JobKind.StylistOutfit, OutfitInput, "tr"), ct)), Fast);
                    await Measure("photo check (face)", "model " + model, async p => (await p.InspectAsync(new ImageInput(face, "image/jpeg"), PhotoKind.Face, ct)).ToString(), Fast);
                    await Measure("item detection (1 garment)", "model " + model, async p => $"{(await p.DetectItemsAsync(new ImageInput(garment, "image/jpeg"), "tr", ct)).Count} item(s)", Fast);
                }
            }
        }

        if (!args.Flag("text-only"))
        {
            var (body, _) = await fixtures.GetAsync(SmokeFixtures.Body, ct);
            var (garment, _) = await fixtures.GetAsync(SmokeFixtures.Garment, ct);
            for (var rep = 0; rep < reps; rep++)
            {
                foreach (var quality in qualities)
                {
                    void Quality(AiOptions o)
                    {
                        o.Image.TryOnQuality = quality == "default" ? null : quality;
                        o.Image.CleanupQuality = quality == "default" ? null : quality;
                    }
                    if (budget.TryTake())
                        await Measure("try-on edit (body + 1 garment)", quality, async p => Bytes(await p.RenderAsync(new ImageInput(body, "image/jpeg"), [new ImageInput(garment, "image/jpeg")], ct)), Quality);
                    if (budget.TryTake())
                        await Measure("cleanup edit (1 garment)", quality, async p => Bytes(await p.CleanupItemAsync(new ImageInput(garment, "image/jpeg"), ItemCategoryHint.Top, null, ct)), Quality);
                }
            }
        }

        var table = rows.GroupBy(r => (r.Call, r.Variant)).Select(g =>
        {
            var ok = g.Where(r => !r.Outcome.StartsWith("failed", StringComparison.Ordinal)).ToList();
            var ms = ok.Select(r => r.Ms).Order().ToList();
            string Avg(Func<AiCallRecord, long?> pick) => ok.Select(r => r.Usage is null ? null : pick(r.Usage)).Where(v => v is not null).Select(v => (double)v!.Value).DefaultIfEmpty(double.NaN).Average() is var a && double.IsNaN(a) ? "-" : $"{a:0}";
            return (IReadOnlyList<string>)[g.Key.Call, g.Key.Variant, ms.Count == 0 ? "-" : $"{AiPerfCommand.Percentile(ms, 50) / 1000:0.0} / {ms.Max() / 1000:0.0}",
                $"{ok.Count}/{g.Count()}", Avg(u => u.InputTokens), Avg(u => u.CachedTokens), Avg(u => u.OutputTokens), Avg(u => u.ReasoningTokens),
                string.Join(" · ", g.Select(r => r.Outcome).Distinct().Take(2))];
        }).ToList();
        output.Summary($"### ai-bench ({args.Stage}) — text `{baseline.TextModel}`, image `{baseline.ImageModel}`, image calls {budget.Used}\n");
        output.Table(["call", "variant", "p50 / max (s)", "ok", "in tok", "cached", "out tok", "reasoning", "outcome"], table);
        return rows.Any(r => r.Outcome.StartsWith("failed", StringComparison.Ordinal)) ? 1 : 0;
    }

    /// <summary>The model ids the key can use (GET /v1/models) — to pick a fast text model for --models.</summary>
    private static async Task ListModelsAsync(AiOptions options, OpsOutput output, CancellationToken ct)
    {
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
            using var request = new HttpRequestMessage(HttpMethod.Get, options.BaseUrl.TrimEnd('/') + "/v1/models");
            request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", options.ApiKey);
            using var response = await http.SendAsync(request, ct);
            var body = await response.Content.ReadAsStringAsync(ct);
            var ids = (System.Text.Json.Nodes.JsonNode.Parse(body)?["data"] as System.Text.Json.Nodes.JsonArray ?? [])
                .Select(m => m?["id"]?.GetValue<string>()).Where(id => id is not null).Select(id => id!)
                .Where(id => !id.Contains("embedding", StringComparison.Ordinal) && !id.Contains("tts", StringComparison.Ordinal) && !id.Contains("whisper", StringComparison.Ordinal))
                .Order(StringComparer.Ordinal).ToList();
            output.Line($"models available ({ids.Count}): {string.Join(", ", ids.Take(120))}");
            output.Summary($"Models available to the key: {string.Join(", ", ids.Take(120).Select(i => $"`{i}`"))}\n");
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
        {
            output.Line($"models: {ex.GetType().Name}");
        }
    }

    private static List<string> List(string? raw, string fallback) =>
        (raw ?? fallback).Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Distinct().ToList();

    private static string Summ(string json) => $"ok, {json.Length} chars";
    private static string Bytes(ImageInput image) => $"ok, {image.Data.Length / 1024} KB {image.ContentType}";

    private static AiOptions Clone(AiOptions source)
    {
        var copy = JsonSerializer.Deserialize<AiOptions>(JsonSerializer.Serialize(source))!;
        copy.ApiKey = source.ApiKey;
        copy.ReasoningEffort = new Dictionary<string, string>(source.ReasoningEffort, StringComparer.OrdinalIgnoreCase);
        return copy;
    }

    private sealed class FixedOptions<T>(T value) : IOptionsMonitor<T>
    {
        public T CurrentValue => value;
        public T Get(string? name) => value;
        public IDisposable? OnChange(Action<T, string?> listener) => null;
    }
}
