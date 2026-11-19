using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using Amazon.S3;
using Domain.Enum;
using Domain.Options;
using Domain.Services;
using Domain.Services.Ai;
using Domain.Services.Styling;
using Infrastructure.Ai;
using Infrastructure.Telemetry;
using ItemProcessor.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Ulid = Domain.Extensions.Ulid;

namespace Ops.Commands;

/// <summary>
/// ai-cost (dev only): what one AI call, one user flow and one user per month cost, in USD and ₺, from Ai:Pricing.
///  1. real usage: the workers' "Job timings … | ai calls …" log lines of the last --days (every provider call with model,
///     tokens, image size / quality), priced with today's list — p50 / p95 per job kind and per operation, plus the
///     hit rate of the speculative item cleanup;
///  2. synthetic: the workers' prompts, schemas and guards on synthetic inputs (ops-fixtures/, a 40-piece synthetic
///     wardrobe), once per settings variant (--text-variants / --image-variants) and rep — cost, tokens, latency and a
///     quality check per call (guard acceptance, expected detection, photo check answers); image outputs are saved
///     under images/ for side-by-side review;
///  3. per user: flows and monthly usage profiles (free / light / typical / heavy premium) priced from the synthetic
///     p50s, against the subscription price.
/// Text calls are capped by --max-text-calls (≤ 120), image calls by --max-calls (≤ 30).
/// </summary>
internal sealed class AiCostCommand(IServiceProvider services, OpsArguments args, OpsOutput output)
{
    public static readonly IReadOnlyList<string> AllOps = ["outfit", "week", "pack", "detect", "detect5", "photo_face", "photo_body", "palette", "match"];
    private static readonly string[] WorkerFunctions = ["item-processor", "outfit-import", "stylist", "tryon", "palette"];

    /// <summary>Subscription prices (₺, incl. 20% VAT) and the store's cut — for the margin table only.</summary>
    public const decimal MonthlyPriceTry = 199.99m, YearlyPriceTry = 1499.99m, Vat = 0.20m, StoreCut = 0.15m;

    private readonly List<Sample> _samples = [];
    private int _textCalls;
    private ImageCallBudget _images = new(0);

    internal sealed record Sample(string Op, string Variant, int Rep, double Ms, bool Ok, IReadOnlyList<AiCallRecord> Calls, decimal Cost, double Quality, string Note);

    private AiOptions Baseline => services.GetRequiredService<IOptionsMonitor<AiOptions>>().CurrentValue;

    public async Task<int> RunAsync(CancellationToken ct)
    {
        var ai = Baseline;
        var pricing = ai.Pricing;
        output.Line($"ai-cost ({args.Stage}): text {ai.TextModel}, image {ai.ImageModel}, fast {ai.FastTextModel ?? "-"} ({ai.FastTextOperations}), " +
                    $"effort {Effort(ai)}, tier {ai.ServiceTier ?? "-"}, image try-on {Img(ai, ImageUse.TryOn)}, cleanup {Img(ai, ImageUse.Cleanup)}, " +
                    $"speculative cleanup {ai.SpeculativeItemCleanup}, prompt cache key {ai.PromptCacheKey}, priced models {pricing.Models.Count}");
        output.Summary($"### ai-cost ({args.Stage})\n\nConfig: text `{ai.TextModel}` · image `{ai.ImageModel}` · fast `{ai.FastTextModel ?? "-"}` ({ai.FastTextOperations}) · " +
                       $"effort `{Effort(ai)}` · tier `{ai.ServiceTier ?? "-"}` · try-on image `{Img(ai, ImageUse.TryOn)}` · cleanup image `{Img(ai, ImageUse.Cleanup)}` · " +
                       $"speculative cleanup `{ai.SpeculativeItemCleanup}` · prompt cache key `{ai.PromptCacheKey}` · USD/TRY {pricing.UsdTry}\n");
        if (pricing.Models.Count == 0)
            output.Error("No Ai:Pricing — costs cannot be estimated (worker/Ai/Pricing or template.yaml).");

        await ListModelsAsync(ai, ct);
        if (!args.Flag("synthetic-only"))
            await RealUsageAsync(pricing, args.IntOption("days", 7), ct);
        if (!args.Flag("usage-only"))
        {
            try
            {
                await SyntheticAsync(ct);
            }
            finally
            {
                // What was measured is reported even when a later call aborts the run.
                ReportSynthetic(pricing);
            }
        }
        return _samples.Any(s => !s.Ok) ? 1 : 0;
    }

    private static string Effort(AiOptions ai) => ai.ReasoningEffort.Count == 0 ? "default" : string.Join(",", ai.ReasoningEffort.Select(kv => $"{kv.Key}={kv.Value}"));
    private static string Img(AiOptions ai, ImageUse use) => ai.ImageFor(use) is var (size, quality) ? $"{quality ?? "default"}/{size}" : "-";

    // ── 1. Real usage ────────────────────────────────────────────────────────────────────────────────────────────────

    private async Task RealUsageAsync(AiPricingOptions pricing, int days, CancellationToken ct)
    {
        var jobs = new List<LoggedJob>();
        foreach (var function in WorkerFunctions)
        {
            var events = await LogsCommand.FetchAsync(args.Stage, function, TimeSpan.FromDays(days), "Job timings", 10_000, ct);
            jobs.AddRange(events.Select(e => AiCostLog.Parse(e.At, function, e.Message)).Where(j => j is not null).Select(j => j!));
        }
        var withCalls = jobs.Where(j => j.Calls.Count > 0).ToList();
        output.Line($"real usage: {jobs.Count} worker runs in {days} day(s), {withCalls.Count} with AI calls, {withCalls.Sum(j => j.Calls.Count)} calls");
        output.Summary($"#### Real usage on {args.Stage}, last {days} day(s) — {withCalls.Count} runs with AI calls, priced with today's list\n");
        if (withCalls.Count == 0)
            return;

        decimal JobCost(LoggedJob j) => j.Calls.Sum(c => AiCostLog.Cost(pricing, c) ?? 0);
        output.Table(["job kind", "runs", "calls/run", "cost p50", "cost p95", "mean", "total"],
            withCalls.GroupBy(j => j.Kind).OrderBy(g => g.Key, StringComparer.Ordinal).Select(g =>
            {
                var costs = g.Select(JobCost).Order().ToList();
                return (IReadOnlyList<string>)[g.Key, g.Count().ToString(CultureInfo.InvariantCulture), $"{g.Average(j => j.Calls.Count):0.0}",
                    Usd(Pct(costs, 50)), Usd(Pct(costs, 95)), Usd(costs.Average()), Usd(costs.Sum())];
            }));

        var calls = withCalls.SelectMany(j => j.Calls.Select(c => (Job: j, Call: c))).ToList();
        output.Table(["operation", "model", "image", "calls (ok)", "in", "cached", "out", "reasoning", "cost p50", "cost p95", "total"],
            calls.GroupBy(c => (c.Call.Operation, Model: Family(c.Call.Model), Image: c.Call.ImageSize is null ? "-" : $"{c.Call.ImageQuality}/{c.Call.ImageSize}"))
                .OrderBy(g => g.Key.Operation, StringComparer.Ordinal).Select(g =>
                {
                    var ok = g.Where(c => c.Call.Status is >= 200 and < 300).ToList();
                    var costs = ok.Select(c => AiCostLog.Cost(pricing, c.Call) ?? 0).Order().ToList();
                    string Avg(Func<AiCallRecord, long?> pick) => ok.Count == 0 ? "-" : $"{ok.Average(c => (double)(pick(c.Call) ?? 0)):0}";
                    return (IReadOnlyList<string>)[g.Key.Operation, g.Key.Model, g.Key.Image, $"{g.Count()} ({ok.Count})", Avg(c => c.InputTokens), Avg(c => c.CachedTokens),
                        Avg(c => c.OutputTokens), Avg(c => c.ReasoningTokens), costs.Count == 0 ? "-" : Usd(Pct(costs, 50)), costs.Count == 0 ? "-" : Usd(Pct(costs, 95)), Usd(costs.Sum())];
                }));

        // Speculative item cleanup: a run that started it and then did not use it shows a cancelled image_cleanup (status 0).
        var itemRuns = withCalls.Where(j => j.Kind == nameof(JobKind.ItemProcess) && j.Calls.Any(c => c.Operation == "item_detection")).ToList();
        var cancelled = itemRuns.Count(j => j.Calls.Any(c => c.Operation == "image_cleanup" && c.Status == 0));
        var speculated = itemRuns.Count(j => j.Calls.Any(c => c.Operation == "image_cleanup"));
        var single = itemRuns.Count(j => j.Calls.Count(c => c.Operation == "image_cleanup" && c.Status is >= 200 and < 300) == 1);
        output.Summary($"Item photos: {itemRuns.Count} runs · with a cleanup call {speculated} · one used cleanup {single} · cancelled (wasted speculative) cleanup {cancelled} " +
                       $"→ speculation hit rate ≈ {(itemRuns.Count == 0 ? "-" : $"{100.0 * (itemRuns.Count - cancelled) / itemRuns.Count:0}%")} (single-piece share of item photos).\n");
    }

    private static string Family(string? model) => model ?? "-";

    // ── 2. Synthetic ─────────────────────────────────────────────────────────────────────────────────────────────────

    private async Task SyntheticAsync(CancellationToken ct)
    {
        var reps = args.IntOption("reps", 1);
        var textBudget = Math.Clamp(args.IntOption("max-text-calls", 60), 0, OpsArguments.MaxTextCallsPerRun);
        _images = new ImageCallBudget(args.MaxImageCalls);
        var ops = (args.Option("ops") is { } raw ? raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries) : AllOps.ToArray()).ToHashSet(StringComparer.Ordinal);
        var textVariants = CostVariant.ParseAll(args.Option("text-variants"));
        var imageVariants = CostVariant.ParseAll(args.Option("image-variants"));
        var stylist = services.GetRequiredService<IOptionsMonitor<StylistOptions>>().CurrentValue;
        var s3 = services.GetRequiredService<IAmazonS3>();
        var fixtures = new SmokeFixtures(s3, services.GetRequiredService<OpenAiProvider>(), OpsHost.PhotoBucket(args.Stage), _images, output);
        var cropper = new SkiaImageCropper();

        var face = new ImageInput((await fixtures.GetAsync(SmokeFixtures.Face, ct)).Data, "image/jpeg");
        var body = new ImageInput((await fixtures.GetAsync(SmokeFixtures.Body, ct)).Data, "image/jpeg");
        var garment = new ImageInput((await fixtures.GetAsync(SmokeFixtures.Garment, ct)).Data, "image/jpeg");
        var flatLay = new ImageInput((await fixtures.GetAsync(SmokeFixtures.FlatLay, ct)).Data, "image/jpeg");
        var wardrobe = SyntheticWardrobe();
        output.Line($"synthetic: {reps} rep(s), ops {string.Join(",", ops)}, text variants {string.Join(" ; ", textVariants.Select(v => v.Name))}, " +
                    $"image variants {string.Join(" ; ", imageVariants.Select(v => v.Name))}, text budget {textBudget}, image budget {_images.Remaining}");

        bool TakeText(int calls)
        {
            if (_textCalls + calls > textBudget)
                return false;
            _textCalls += calls;
            return true;
        }

        if (!args.Flag("image-only"))
        {
            for (var rep = 1; rep <= reps; rep++)
            {
                foreach (var variant in textVariants)
                {
                    var provider = Provider(variant);
                    var compact = variant.Compact(Baseline.CompactStylistPrompt);
                    var cap = variant.Cap(stylist.MaxCandidates);
                    var candidates = StylistCandidateSelector.Select(wardrobe, new CandidateCriteria(new HashSet<Season> { Season.Autumn }, Occasion.Office, 12, false, cap, stylist.HotFromC));
                    if (ops.Contains("outfit") && TakeText(1))
                        await MeasureAsync("outfit", variant, rep, () => OutfitAsync(provider, candidates, compact, ct));
                    var batches = WeekPlanning.Split(WeekDates(), variant.WeekBatch(stylist.WeekBatchDays));
                    if (ops.Contains("week") && TakeText(batches.Count))
                        await MeasureAsync("week", variant, rep, () => WeekAsync(provider, candidates, compact, batches, ct));
                    if (ops.Contains("pack") && TakeText(1))
                        await MeasureAsync("pack", variant, rep, () => PackAsync(provider, wardrobe, compact, cap, stylist, ct));
                    if (ops.Contains("detect") && TakeText(1))
                        await MeasureAsync("item_detection (1 piece)", variant, rep, async () => DetectQuality(await provider.DetectItemsAsync(garment, "tr", ct), 1));
                    if (ops.Contains("detect5") && TakeText(1))
                        await MeasureAsync("item_detection (5 pieces)", variant, rep, async () => DetectQuality(await provider.DetectItemsAsync(flatLay, "tr", ct), 5));
                    if (ops.Contains("photo_face") && TakeText(1))
                        await MeasureAsync("photo_check (face)", variant, rep, async () => PhotoQuality(await provider.InspectAsync(face, PhotoKind.Face, ct), PhotoKind.Face));
                    if (ops.Contains("photo_body") && TakeText(1))
                        await MeasureAsync("photo_check (body)", variant, rep, async () => PhotoQuality(await provider.InspectAsync(body, PhotoKind.Body, ct), PhotoKind.Body));
                    if (ops.Contains("palette") && TakeText(1))
                        await MeasureAsync("palette_season", variant, rep, async () =>
                        {
                            var p = await provider.AnalyzeAsync(face, ct);
                            return (string.IsNullOrEmpty(p.SeasonTypeId) ? 0 : 1, $"{p.SeasonTypeId} ({p.Confidence:0.00}){(p.Refusal is null ? "" : " refusal " + p.Refusal)}");
                        });
                    if (ops.Contains("match") && TakeText(2))
                    {
                        var crop = Thumb(cropper, garment, 0.1, 512);
                        var candidatesWith = new[] { Thumb(cropper, flatLay, 0, 512), Thumb(cropper, garment, 0, 512), Thumb(cropper, face, 0, 512) };
                        await MeasureAsync("item_match (same piece)", variant, rep, async () =>
                        {
                            var m = await provider.MatchAsync(crop, candidatesWith, "sweater", true, ct);
                            return (m.Index == 1 ? 1 : 0, $"match {(m.Index is { } i ? i + 1 : 0)} ({m.Confidence:0.00}), expected 2");
                        });
                        await MeasureAsync("item_match (none)", variant, rep, async () =>
                        {
                            var m = await provider.MatchAsync(crop, [candidatesWith[0], candidatesWith[2]], "sweater", true, ct);
                            return (m.Index is null ? 1 : 0, $"match {(m.Index is { } i ? i + 1 : 0)} ({m.Confidence:0.00}), expected none");
                        });
                    }
                }
            }
        }

        if (!args.Flag("text-only") && (ops.Contains("cleanup") || ops.Contains("tryon") || args.Option("image-variants") is not null))
        {
            // The jeans crop of the flat lay, cut exactly like the item worker does (one detection call with the stage config).
            ImageInput? jeans = null;
            if (TakeText(1))
            {
                var detected = ItemDetectionGuard.Filter(await Provider(CostVariant.Base).DetectItemsAsync(flatLay, "tr", ct), 12);
                if (detected.FirstOrDefault(d => d.Garment.Category == ItemCategoryHint.Bottom) is { } piece && cropper.Measure(flatLay) is { } size)
                    jeans = cropper.Crop(flatLay, CropMath.Plan(piece.Box, size, CropMath.IsSmall(piece.Box, piece.Subcategory)));
            }
            output.SaveFile("images/input-garment.jpg", garment.Data);
            output.SaveFile("images/input-body.jpg", body.Data);
            if (jeans is not null)
                output.SaveFile("images/input-jeans-crop.jpg", jeans.Data);
            for (var rep = 1; rep <= reps; rep++)
            {
                foreach (var variant in imageVariants)
                {
                    var provider = Provider(variant);
                    if (variant.Uses("cleanup") && _images.TryTake())
                        await MeasureAsync("image_cleanup (sweater)", variant, rep, async () => Saved("cleanup-sweater", variant, rep,
                            await provider.CleanupItemAsync(garment, ItemCategoryHint.Top, "sweater", ct)));
                    if (variant.Uses("cleanup") && jeans is not null && _images.TryTake())
                        await MeasureAsync("image_cleanup (jeans crop)", variant, rep, async () => Saved("cleanup-jeans", variant, rep,
                            await provider.CleanupItemAsync(jeans, ItemCategoryHint.Bottom, "jeans", ct)));
                    if (variant.Uses("tryon") && _images.TryTake())
                        await MeasureAsync("image_tryon (body + 2)", variant, rep, async () => Saved("tryon", variant, rep,
                            await provider.RenderAsync(body, jeans is null ? [garment] : [garment, jeans], ct)));
                }
            }
        }
        output.Line($"synthetic calls: text {_textCalls}, image {_images.Used} (fixtures included)");
    }

    private (double, string) Saved(string name, CostVariant variant, int rep, ImageInput image)
    {
        var extension = image.ContentType switch { "image/png" => "png", "image/jpeg" => "jpg", _ => "webp" };
        output.SaveFile($"images/{name}-{variant.Name}-{rep}.{extension}", image.Data);
        return (1, $"{image.Data.Length / 1024} KB");
    }

    private static ImageInput Thumb(SkiaImageCropper cropper, ImageInput image, double inset, int edge)
    {
        if (cropper.Measure(image) is not { } size)
            return image;
        var (x, y) = ((int)(size.Width * inset), (int)(size.Height * inset));
        var (w, h) = (size.Width - 2 * x, size.Height - 2 * y);
        var scale = Math.Min(1, (double)edge / Math.Max(w, h));
        return cropper.Crop(image, new CropPlan(x, y, w, h, Math.Max(1, (int)(w * scale)), Math.Max(1, (int)(h * scale)))) ?? image;
    }

    private OpenAiProvider Provider(CostVariant variant)
    {
        var options = JsonSerializer.Deserialize<AiOptions>(JsonSerializer.Serialize(Baseline))!;
        options.ApiKey = Baseline.ApiKey;
        options.ReasoningEffort = new Dictionary<string, string>(Baseline.ReasoningEffort, StringComparer.OrdinalIgnoreCase);
        options.VisionDetail = new Dictionary<string, string>(Baseline.VisionDetail, StringComparer.OrdinalIgnoreCase);
        options.ServiceTiers = new Dictionary<string, string>(Baseline.ServiceTiers, StringComparer.OrdinalIgnoreCase);
        options.MaxOutputTokens = new Dictionary<string, int>(Baseline.MaxOutputTokens, StringComparer.OrdinalIgnoreCase);
        options.Pricing = Baseline.Pricing;
        variant.Apply(options);
        return new OpenAiProvider(new HttpClient { Timeout = Timeout.InfiniteTimeSpan }, new FixedOptions<AiOptions>(options), services.GetRequiredService<ILogger<OpenAiProvider>>());
    }

    private async Task MeasureAsync(string op, CostVariant variant, int rep, Func<Task<(double Quality, string Note)>> run)
    {
        var timings = AiTelemetry.Begin();
        var watch = Stopwatch.StartNew();
        double quality = 0;
        string note;
        var ok = true;
        try
        {
            (quality, note) = await run();
        }
        catch (Exception ex) when (ex is AiProviderException or HttpRequestException or InvalidOperationException)
        {
            ok = false;
            note = "failed: " + ex.Message;
        }
        finally
        {
            AiTelemetry.End();
        }
        var calls = timings.Calls;
        var cost = calls.Sum(c => c.CostUsd ?? 0);
        _samples.Add(new Sample(op, variant.Name, rep, watch.Elapsed.TotalMilliseconds, ok, calls, cost, quality, note));
        output.Line($"{op} [{variant.Name}] #{rep}: {watch.Elapsed.TotalSeconds:0.0}s {Usd(cost)} q={quality:0.00} {note} | " +
                    string.Join("; ", calls.Select(Infrastructure.Workers.JobMessageHandler.Describe)));
    }

    // ── Stylist inputs (the worker's prompt builder and guards) ──────────────────────────────────────────────────────

    private static readonly object Style = new { StyleTags = new[] { "minimal", "classic", "quietLuxury" }, Budget = "mixed" };

    private static IReadOnlyList<string> WeekDates() => Enumerable.Range(0, 7).Select(i => new DateOnly(2026, 11, 23).AddDays(i).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)).ToList();

    private static async Task<(double, string)> OutfitAsync(OpenAiProvider provider, IReadOnlyList<CandidateItem> candidates, bool compact, CancellationToken ct)
    {
        var aliases = CandidateAliases.For(candidates, compact);
        var prompt = StylistPrompts.Outfit(aliases, candidates, "tr", Style, null, 3, true, [], "2026-11-20", Season.Autumn, Occasion.Office,
            new PromptWeather(6, 12, WeatherCondition.Cloudy), null, null);
        var answer = aliases.Restore(await provider.GenerateAsync(new StylistPrompt(JobKind.StylistOutfit, prompt, "tr", compact), ct));
        var output = StylingJson.TryDeserialize<ModelOutfitOutput>(answer);
        var accepted = StylistOutputGuard.AcceptDistinct(output?.Suggestions, GuardContext.For(candidates, true, null, 40, 280), 3);
        return (accepted.Count / 3.0, $"{accepted.Count}/3 accepted · {string.Join(" / ", accepted.Select(a => a.Title))}");
    }

    private static async Task<(double, string)> WeekAsync(OpenAiProvider provider, IReadOnlyList<CandidateItem> candidates, bool compact,
        IReadOnlyList<IReadOnlyList<string>> batches, CancellationToken ct)
    {
        var aliases = CandidateAliases.For(candidates, compact);
        var dates = WeekDates();
        var days = dates.Select((d, i) => new StylistPrompts.WeekDay(d, i == 4 ? Occasion.Dinner : i >= 5 ? Occasion.Weekend : Occasion.Office, new PromptWeather(5, 11, WeatherCondition.Rain))).ToList();
        var answers = await Task.WhenAll(batches.Select(async batch => (batch, aliases.Restore(await provider.GenerateAsync(new StylistPrompt(JobKind.StylistWeek,
            StylistPrompts.Week(aliases, candidates, "tr", Style, dates[0], days.Where(d => batch.Contains(d.Date))), "tr", compact), ct)))));
        var merged = WeekPlanning.Merge(answers.Select(a => (a.batch, StylingJson.TryDeserialize<ModelWeekOutput>(a.Item2))));
        var accepted = StylistOutputGuard.AcceptWeek(merged, dates, GuardContext.For(candidates, true, null, 40, 280));
        var repeats = WeekPlanning.RepeatedDates(accepted, dates).Count();
        return (Math.Max(0, accepted.Count - repeats) / 7.0, $"{accepted.Count}/7 days accepted, {repeats} repeated, {batches.Count} call(s)");
    }

    private static async Task<(double, string)> PackAsync(OpenAiProvider provider, IReadOnlyList<CandidateItem> wardrobe, bool compact, int cap, StylistOptions settings, CancellationToken ct)
    {
        var dates = new[] { "2026-12-03", "2026-12-04", "2026-12-05" };
        var seasons = new HashSet<Season> { Season.Winter, Season.Autumn };
        var candidates = StylistCandidateSelector.Select(wardrobe, new CandidateCriteria(seasons, null, 9, true, cap, settings.HotFromC));
        var occasions = new List<Occasion> { Occasion.Office, Occasion.Dinner };
        var dayOccasions = CapsuleRules.DayOccasions(dates.Length, occasions);
        var layerDates = dates.ToHashSet(StringComparer.Ordinal);
        var context = new PackingContext(candidates.ToDictionary(c => c.Id, StringComparer.Ordinal), dates, true, 12, dayOccasions, layerDates);
        var target = CapsuleRules.TargetFor(context)!;
        var range = CapsuleRules.PieceRange(context)!.Value;
        var aliases = CandidateAliases.For(candidates, compact);
        var prompt = StylistPrompts.Pack(aliases, candidates, "tr",
            new { dates, TripTypes = new[] { TripType.Business, TripType.Dinner }, CabinOnly = true, cabinMaxItems = 12,
                weather = dates.Select(d => new { date = d, MinTempC = 2, MaxTempC = 8, Condition = WeatherCondition.Rain }) },
            dates.Select((d, i) => new { date = d, occasion = dayOccasions[i], outerLayer = true }),
            new { target.Tops, target.Bottoms, target.Shoes, target.Outerwear, target.Bags, pieces = target.Pieces, minPieces = range.Min, maxPieces = range.Max },
            CapsuleRules.MinRewearRatio);
        var answer = aliases.Restore(await provider.GenerateAsync(new StylistPrompt(JobKind.StylistPack, prompt, "tr", compact), ct));
        var plan = PackingRules.FromModel(StylingJson.TryDeserialize<ModelPackOutput>(answer));
        if (plan is null)
            return (0, "unparsable plan");
        plan = plan with { Days = plan.Days.Select(d => d with { Occasion = context.OccasionOn(d.Date) ?? d.Occasion }).ToList() };
        var trim = PackingRules.TrimToCabinLimit(plan, context);
        var errors = trim.Plan is null ? ["trim failed"] : PackingRules.Validate(trim.Plan, context);
        return (errors.Count == 0 ? 1 : 0, $"{plan.ItemIds.Count} pieces, {plan.Days.Count} days, {(errors.Count == 0 ? "valid" : "invalid: " + string.Join(", ", errors.Take(3)))}");
    }

    /// <summary>40 pieces with real-length ids (ULIDs): what a filled wardrobe sends to the stylist.</summary>
    internal static IReadOnlyList<CandidateItem> SyntheticWardrobe()
    {
        var random = new Random(20261119);
        string[] colours = ["white", "black", "navy", "grey", "beige", "camel", "blue", "brown", "green", "burgundy", "cream", "red"];
        string[] fabrics = ["cotton", "wool", "denim", "leather", "silk", "linen", "viscose", "cashmere", "polyester"];
        (ItemCategory Category, int Count)[] plan = [(ItemCategory.Top, 12), (ItemCategory.Bottom, 8), (ItemCategory.Dress, 3), (ItemCategory.Outerwear, 4),
            (ItemCategory.Shoes, 6), (ItemCategory.Bag, 4), (ItemCategory.Accessory, 3)];
        var start = new DateTimeOffset(2026, 10, 1, 0, 0, 0, TimeSpan.Zero);
        var items = new List<CandidateItem>();
        foreach (var (category, count) in plan)
            for (var i = 0; i < count; i++)
            {
                var seasons = Enum.GetValues<Season>().Where(_ => random.NextDouble() < 0.6).ToList();
                items.Add(new CandidateItem(Ulid.New(start.AddMinutes(items.Count).UtcDateTime), category,
                    colours.OrderBy(_ => random.Next()).Take(random.Next(1, 3)).ToList(), fabrics[random.Next(fabrics.Length)],
                    seasons.Count == 0 ? [Season.Autumn, Season.Winter] : seasons, random.Next(0, 12)));
            }
        return items;
    }

    // ── Quality checks ───────────────────────────────────────────────────────────────────────────────────────────────

    private static (double, string) DetectQuality(IReadOnlyList<DetectedItem> raw, int expected)
    {
        var items = ItemDetectionGuard.Filter(raw, 12);
        var labels = string.Join(", ", items.Select(i => $"{i.Garment.Category}/{i.Subcategory}/{string.Join("+", i.Garment.ColorIds)}"));
        if (expected == 1)
        {
            var ok = items.Count == 1 && items[0].Garment.Category == ItemCategoryHint.Top && items[0].Garment.ColorIds.FirstOrDefault() is "navy" or "blue";
            return (ok ? 1 : 0, $"{items.Count} item(s): {labels}");
        }
        // Flat lay: t-shirt, jeans, sneakers, tote, necklace — one point each, the necklace being the hard one.
        var score = new[]
        {
            items.Any(i => i.Garment.Category == ItemCategoryHint.Top),
            items.Any(i => i.Garment.Category == ItemCategoryHint.Bottom),
            items.Any(i => i.Garment.Category == ItemCategoryHint.Shoes),
            items.Any(i => i.Garment.Category == ItemCategoryHint.Bag),
            items.Any(i => i.Garment.Category == ItemCategoryHint.Accessory),
        }.Count(b => b) / 5.0 - Math.Max(0, items.Count - 5) * 0.1;
        return (Math.Max(0, score), $"{items.Count} item(s): {labels}");
    }

    private static (double, string) PhotoQuality(PhotoInspection p, PhotoKind kind)
    {
        var ok = p.People == 1 && !p.AppearsMinor && !p.TooDark && !p.Blurry && (kind == PhotoKind.Face ? p.FaceVisible : p.FullBody);
        return (ok ? 1 : 0, p.ToString());
    }

    // ── 3. Report ────────────────────────────────────────────────────────────────────────────────────────────────────

    private void ReportSynthetic(AiPricingOptions pricing)
    {
        if (_samples.Count == 0)
            return;
        output.Summary($"#### Synthetic calls ({_textCalls} text, {_images.Used} image incl. fixtures) — USD per call, p50 / p95 over reps; quality 1 = as expected\n");
        output.Table(["operation", "variant", "n ok", "cost p50", "cost p95", "in", "cached", "out", "reasoning", "img", "latency p50 (s)", "quality", "note"],
            _samples.GroupBy(s => (s.Op, s.Variant)).Select(g =>
            {
                var ok = g.Where(s => s.Ok).ToList();
                var costs = ok.Select(s => s.Cost).Order().ToList();
                string Avg(Func<AiCallRecord, long?> pick) => ok.Count == 0 ? "-" : $"{ok.Average(s => s.Calls.Sum(c => (double)(pick(c) ?? 0))):0}";
                var image = g.SelectMany(s => s.Calls).FirstOrDefault(c => c.ImageSize is not null) is { } ic ? $"{ic.ImageQuality}/{ic.ImageSize}" : "-";
                return (IReadOnlyList<string>)[g.Key.Op, g.Key.Variant, $"{ok.Count}/{g.Count()}", costs.Count == 0 ? "-" : Usd(Pct(costs, 50)), costs.Count == 0 ? "-" : Usd(Pct(costs, 95)),
                    Avg(c => c.InputTokens), Avg(c => c.CachedTokens), Avg(c => c.OutputTokens), Avg(c => c.ReasoningTokens), image,
                    ok.Count == 0 ? "-" : $"{Pct(ok.Select(s => (decimal)s.Ms).Order().ToList(), 50) / 1000:0.0}",
                    ok.Count == 0 ? "-" : $"{ok.Average(s => s.Quality):0.00}", string.Join(" · ", g.Select(s => s.Note).Distinct().Take(2))];
            }));

        // Per flow and per user from the p50 of each operation, per variant pair (text variant × image variant).
        var textVariants = _samples.Where(s => !AiCost.IsImageOperation(s.Calls.FirstOrDefault()?.Operation ?? "")).Select(s => s.Variant).Distinct().ToList();
        var imageVariants = _samples.Where(s => s.Calls.Any(c => AiCost.IsImageOperation(c.Operation))).Select(s => s.Variant).Distinct().ToList();
        if (textVariants.Count == 0 || imageVariants.Count == 0)
            return;
        decimal Op(string op, string variant) =>
            _samples.Where(s => s.Op == op && s.Variant == variant && s.Ok).Select(s => s.Cost).Order().ToList() is { Count: > 0 } c ? Pct(c, 50) : 0;
        var rows = new List<IReadOnlyList<string>>();
        var userRows = new List<IReadOnlyList<string>>();
        foreach (var tv in textVariants)
            foreach (var iv in imageVariants)
            {
                var speculative = Baseline.SpeculativeItemCleanup;
                var flows = Flows(op => Op(op, tv), op => Op(op, iv), speculative);
                rows.Add([$"{tv} × {iv}", .. flows.Select(f => Usd(f.Value))]);
                foreach (var profile in Profiles)
                {
                    var usd = profile.Usage.Sum(u => flows[u.Key] * u.Value);
                    userRows.Add([$"{tv} × {iv}", profile.Name, Usd(usd), Try(usd, pricing.UsdTry), Margin(usd, pricing.UsdTry, profile.Premium)]);
                }
            }
        output.Summary("#### Cost per user flow (USD, from the p50s above)\n");
        output.Table(["text × image variant", .. FlowNames], rows);
        output.Summary($"#### Cost per user per month (assumptions: docs/ai-cost.md) vs. premium ₺{MonthlyPriceTry} / month (net of {Vat:P0} VAT and {StoreCut:P0} store fee)\n");
        output.Table(["text × image variant", "profile", "USD / month", "₺ / month", "share of net monthly price"], userRows);
    }

    public static readonly string[] FlowNames = ["outfit", "week plan", "trip pack", "item photo (1 piece)", "item photo (3 of 5 kept)", "outfit import photo", "palette", "try-on", "first try-on (photo check)"];

    /// <summary>One flow = the operations it runs (p50 cost each). Speculative cleanup wastes one cleanup on every multi-piece photo.</summary>
    internal static Dictionary<string, decimal> Flows(Func<string, decimal> text, Func<string, decimal> image, bool speculative)
    {
        var cleanup = image("image_cleanup (sweater)") is var c1 and > 0 ? c1 : image("image_cleanup (jeans crop)");
        var cleanupCrop = image("image_cleanup (jeans crop)") is var c2 and > 0 ? c2 : cleanup;
        return new Dictionary<string, decimal>
        {
            ["outfit"] = text("outfit"),
            ["week plan"] = text("week"),
            ["trip pack"] = text("pack"),
            ["item photo (1 piece)"] = text("item_detection (1 piece)") + cleanup,
            ["item photo (3 of 5 kept)"] = text("item_detection (5 pieces)") + 3 * cleanupCrop + (speculative ? cleanup : 0),
            // detection + one match call per piece (3) + cleanup of the new pieces at commit (assumption: 2 of 3 new)
            ["outfit import photo"] = text("item_detection (5 pieces)") + 3 * text("item_match (same piece)") + 2 * cleanupCrop,
            ["palette"] = text("palette_season"),
            ["try-on"] = image("image_tryon (body + 2)"),
            ["first try-on (photo check)"] = image("image_tryon (body + 2)") + text("photo_check (body)"),
        };
    }

    internal sealed record Profile(string Name, bool Premium, IReadOnlyDictionary<string, decimal> Usage);

    /// <summary>Monthly usage per profile (flow → times per month). Documented in docs/ai-cost.md.</summary>
    internal static readonly IReadOnlyList<Profile> Profiles =
    [
        new("free (10 recognitions, one-off)", false, new Dictionary<string, decimal> { ["item photo (1 piece)"] = 8, ["item photo (3 of 5 kept)"] = 2 }),
        new("light premium", true, new Dictionary<string, decimal>
        {
            ["outfit"] = 8, ["week plan"] = 1, ["item photo (1 piece)"] = 8, ["item photo (3 of 5 kept)"] = 1, ["try-on"] = 4, ["first try-on (photo check)"] = 1,
        }),
        new("typical premium", true, new Dictionary<string, decimal>
        {
            ["outfit"] = 30, ["week plan"] = 4, ["trip pack"] = 1, ["item photo (1 piece)"] = 15, ["item photo (3 of 5 kept)"] = 4, ["outfit import photo"] = 5,
            ["try-on"] = 14, ["first try-on (photo check)"] = 1,
        }),
        new("heavy premium", true, new Dictionary<string, decimal>
        {
            ["outfit"] = 120, ["week plan"] = 8, ["trip pack"] = 3, ["item photo (1 piece)"] = 40, ["item photo (3 of 5 kept)"] = 10, ["outfit import photo"] = 30,
            ["palette"] = 1, ["try-on"] = 29, ["first try-on (photo check)"] = 1,
        }),
        new("typical premium, onboarding month", true, new Dictionary<string, decimal>
        {
            ["outfit"] = 30, ["week plan"] = 4, ["item photo (1 piece)"] = 40, ["item photo (3 of 5 kept)"] = 10, ["outfit import photo"] = 30,
            ["palette"] = 1, ["try-on"] = 14, ["first try-on (photo check)"] = 1,
        }),
    ];

    internal static decimal NetMonthlyTry => MonthlyPriceTry / (1 + Vat) * (1 - StoreCut);

    private static string Margin(decimal usd, decimal usdTry, bool premium) =>
        !premium || usdTry <= 0 ? "-" : $"{usd * usdTry / NetMonthlyTry:P1}";

    private static string Try(decimal usd, decimal usdTry) => usdTry <= 0 ? "-" : string.Create(CultureInfo.InvariantCulture, $"₺{usd * usdTry:0.00}");

    internal static string Usd(decimal usd) => string.Create(CultureInfo.InvariantCulture, $"${usd:0.0000}");

    internal static decimal Pct(IReadOnlyList<decimal> sorted, int p)
    {
        if (sorted.Count == 0)
            return 0;
        var rank = (int)Math.Ceiling(p / 100.0 * sorted.Count);
        return sorted[Math.Clamp(rank - 1, 0, sorted.Count - 1)];
    }

    private async Task ListModelsAsync(AiOptions options, CancellationToken ct)
    {
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
            using var request = new HttpRequestMessage(HttpMethod.Get, options.BaseUrl.TrimEnd('/') + "/v1/models");
            request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", options.ApiKey);
            using var response = await http.SendAsync(request, ct);
            var ids = (System.Text.Json.Nodes.JsonNode.Parse(await response.Content.ReadAsStringAsync(ct))?["data"] as System.Text.Json.Nodes.JsonArray ?? [])
                .Select(m => m?["id"]?.GetValue<string>()).Where(id => id is not null && (id.StartsWith("gpt", StringComparison.Ordinal) || id.StartsWith('o')))
                .Select(id => id!).Order(StringComparer.Ordinal).ToList();
            var priced = ids.Where(id => options.Pricing.For(id) is not null).ToList();
            output.Line($"models ({ids.Count}): {string.Join(", ", ids)}");
            output.Summary($"Models the key can use ({ids.Count}; priced: {priced.Count}): {string.Join(", ", ids.Select(i => options.Pricing.For(i) is null ? $"`{i}`" : $"**`{i}`**"))}\n");
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
        {
            output.Line($"models: {ex.GetType().Name}");
        }
    }

    private sealed class FixedOptions<T>(T value) : IOptionsMonitor<T>
    {
        public T CurrentValue => value;
        public T Get(string? name) => value;
        public IDisposable? OnChange(Action<T, string?> listener) => null;
    }
}
