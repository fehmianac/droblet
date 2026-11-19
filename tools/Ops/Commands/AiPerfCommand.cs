using System.Diagnostics;
using System.Globalization;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;
using Amazon.S3;
using Domain.Options;
using Domain.Services.Admin;
using Infrastructure.Ai;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Ulid = Domain.Extensions.Ulid;

namespace Ops.Commands;

/// <summary>
/// ai-perf: latency of every AI flow on dev, N runs each, on one fresh premium throw-away user (ai-perf+{ts}@example.com,
/// set up like ai-smoke: consents, style / body profile, synthetic body + face photo from ops-fixtures/, 12 library
/// pieces). Per job it records what the client sees (POST → completed, polled every 250 ms), the server's own
/// end-to-end time (updatedAt − createdAt) and the worker's stage timings (job.timings: queue_wait, init, db, s3_get,
/// s3_put, ai.*, worker …), then prints p50 / p95 per flow and stage. "noticed (old/new poll)" replays the app's poll
/// schedules against the server time: when the app would have seen the result with the old back-off (1, 2, 4, 8, 10 s)
/// and with the new schedule (pollSchedule.ts). Image-model calls by the workers: one try-on and one item cleanup
/// per run (+1 face-path try-on with --face). The user is deleted at the end (unless --keep-user).
/// </summary>
internal sealed class AiPerfCommand(IServiceProvider services, OpsArguments args, OpsOutput output)
{
    private static readonly TimeSpan JobTimeout = TimeSpan.FromMinutes(4);
    private static readonly TimeSpan PollEvery = TimeSpan.FromMilliseconds(250);

    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(60) };
    private readonly List<Sample> _samples = [];
    private string? _token;

    internal sealed record Sample(string Flow, int Run, string Status, double ClientMs, double? ServerMs, IReadOnlyDictionary<string, long> Timings);

    public async Task<int> RunAsync(CancellationToken ct)
    {
        var runs = args.IntOption("runs", 3);
        var flows = args.PerfFlows.ToHashSet(StringComparer.Ordinal);
        _http.BaseAddress = new Uri((args.Option("api-url") ?? AiSmokeCommand.DevApiUrl).TrimEnd('/') + "/");
        var ai = services.GetRequiredService<IOptionsMonitor<AiOptions>>().CurrentValue;
        output.Line($"ai-perf ({args.Stage}): {runs} run(s) of {string.Join(",", flows)} · text {ai.TextModel} · image {ai.ImageModel} · " +
                    $"fast {ai.FastTextModel ?? "-"} · effort {string.Join(",", ai.ReasoningEffort.Select(kv => $"{kv.Key}={kv.Value}"))} · " +
                    $"image quality try-on {ai.ImageFor(ImageUse.TryOn).Quality ?? "default"} cleanup {ai.ImageFor(ImageUse.Cleanup).Quality ?? "default"}");

        var s3 = services.GetRequiredService<IAmazonS3>();
        var fixtures = new SmokeFixtures(s3, services.GetRequiredService<OpenAiProvider>(), OpsHost.PhotoBucket(args.Stage), new ImageCallBudget(4), output);
        var email = $"ai-perf+{DateTime.UtcNow:yyyyMMddHHmmss}@example.com";
        var exit = 0;
        try
        {
            if (!await SetUpUserAsync(email, fixtures, ct))
                return 1;

            var today = DateOnly.FromDateTime(DateTime.UtcNow);
            var (garment, _) = await fixtures.GetAsync(SmokeFixtures.Garment, ct);
            for (var run = 1; run <= runs; run++)
            {
                output.Line($"── run {run}/{runs}");
                string? outfitJob = null;
                if (flows.Contains("outfit") || flows.Contains("tryon"))
                    outfitJob = await JobAsync("outfit", run, "v1/tenant/stylist/outfit",
                        new JsonObject { ["requestId"] = Ulid.New(), ["date"] = AiSmokeCommand.Day(today.AddDays(run - 1)), ["occasion"] = run % 2 == 0 ? "dinner" : "office", ["onlyMyWardrobe"] = true }, ct);
                if (flows.Contains("week"))
                    await JobAsync("week", run, "v1/tenant/stylist/week",
                        new JsonObject { ["requestId"] = Ulid.New(), ["weekStart"] = AiSmokeCommand.Day(today.AddDays(7 * run)), ["onlyMyWardrobe"] = true }, ct);
                if (flows.Contains("pack"))
                {
                    var tripId = Ulid.New();
                    var (status, body, _) = await CallAsync(HttpMethod.Post, "v1/tenant/trip", new JsonObject
                    {
                        ["id"] = tripId, ["cityId"] = "paris", ["cityName"] = "Paris", ["startDate"] = AiSmokeCommand.Day(today.AddDays(7 + run)),
                        ["endDate"] = AiSmokeCommand.Day(today.AddDays(9 + run)), ["tripTypes"] = new JsonArray("business", "dinner"), ["cabinOnly"] = true,
                    }, ct);
                    if (status is 200 or 201)
                        await JobAsync("pack", run, $"v1/tenant/trip/{tripId}/pack", new JsonObject { ["requestId"] = Ulid.New() }, ct);
                    else
                        output.Error($"trip create {status} {AiSmokeCommand.Code(body)}");
                }
                if (flows.Contains("item"))
                    await ItemAsync(run, garment, ct);
                if (flows.Contains("palette"))
                    await JobAsync("palette", run, "v1/tenant/palette/analyze", new JsonObject { ["requestId"] = Ulid.New() }, ct);
                if (flows.Contains("tryon") && outfitJob is not null)
                    await TryOnAsync(run, outfitJob, ct);
            }

            if (args.Flag("face") && flows.Contains("tryon"))
                await FacePathAsync(fixtures, today, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
        {
            exit = 1;
            output.Error($"ai-perf aborted: {ex.GetType().Name}: {ex.Message}");
        }
        finally
        {
            if (_token is not null && !args.Flag("keep-user"))
            {
                var (status, _, _) = await CallAsync(HttpMethod.Delete, "v1/auth/me", null, CancellationToken.None);
                output.Line($"DELETE v1/auth/me → {status}");
            }
            Report(email, runs);
        }
        return exit != 0 || _samples.Any(s => s.Status != "completed") ? 1 : exit;
    }

    // ── setup ────────────────────────────────────────────────────────────────────────────────────────────────────────

    private async Task<bool> SetUpUserAsync(string email, SmokeFixtures fixtures, CancellationToken ct)
    {
        var (status, body, _) = await CallAsync(HttpMethod.Post, "v1/auth/register",
            new JsonObject { ["name"] = "AI Perf", ["email"] = email, ["password"] = "Perf-" + Guid.NewGuid().ToString("N"), ["ageConfirmed"] = true }, ct);
        if (status != 201)
        {
            output.Error($"register {status} {AiSmokeCommand.Code(body)}");
            return false;
        }
        _token = body!["accessToken"]!.GetValue<string>();
        await services.GetRequiredService<IAdminAppUserService>().GrantTestPremiumAsync(OpsHost.Actor, body["userId"]!.GetValue<string>(), 1, "ai-perf", null, ct);
        var consents = new JsonArray(AiSmokeCommand.ConsentTypes.Select(t => (JsonNode)new JsonObject { ["type"] = t, ["granted"] = true, ["version"] = ConsentOptions.DefaultVersion }).ToArray());
        await CallAsync(HttpMethod.Put, "v1/tenant/consents", new JsonObject { ["consents"] = consents, ["source"] = "onboarding", ["locale"] = "tr" }, ct);
        await CallAsync(HttpMethod.Put, "v1/tenant/style-profile",
            new JsonObject { ["segment"] = "women", ["styleTags"] = new JsonArray("minimal", "classic", "quietLuxury"), ["budget"] = "mixed", ["baseVersion"] = 0 }, ct);
        await CallAsync(HttpMethod.Put, "v1/tenant/body-profile", new JsonObject { ["heightCm"] = 168, ["size"] = "m", ["baseVersion"] = 0 }, ct);
        foreach (var (kind, fixture) in new[] { ("body", SmokeFixtures.Body), ("face", SmokeFixtures.Face) })
        {
            var (data, _) = await fixtures.GetAsync(fixture, ct);
            if (await UploadProfilePhotoAsync(kind, data, ct) is { } error)
            {
                output.Error($"photo {kind}: {error}");
                return false;
            }
        }
        var rows = new JsonArray(AiSmokeCommand.LibraryPieces.Select(id => (JsonNode)new JsonObject { ["clientMutationId"] = Ulid.New(), ["libraryItemId"] = id }).ToArray());
        (status, body, _) = await CallAsync(HttpMethod.Post, "v1/tenant/item/from-library", new JsonObject { ["items"] = rows }, ct);
        output.Line($"user {email}: premium, consents, profiles, body + face photo, library pieces {status}");
        return status is 200 or 201;
    }

    private async Task<string?> UploadProfilePhotoAsync(string kind, byte[] data, CancellationToken ct)
    {
        var (status, slot, _) = await CallAsync(HttpMethod.Post, "v1/tenant/photo/upload-url", new JsonObject { ["kind"] = kind, ["contentType"] = "image/jpeg" }, ct);
        if (status != 200 || slot is null)
            return $"upload-url {status}";
        if (await AiSmokeCommand.PresignedPostAsync(slot, data, "image/jpeg", ct) is { } error)
            return error;
        var (put, _, _) = await CallAsync(HttpMethod.Put, $"v1/tenant/photo/{kind}",
            new JsonObject { ["uploadId"] = slot["uploadId"]!.GetValue<string>(), ["clientMutationId"] = Ulid.New() }, ct);
        return put == 200 ? null : $"activate {put}";
    }

    // ── flows ────────────────────────────────────────────────────────────────────────────────────────────────────────

    private async Task<string?> JobAsync(string flow, int run, string path, JsonObject request, CancellationToken ct)
    {
        var watch = Stopwatch.StartNew();
        var (status, body, _) = await CallAsync(HttpMethod.Post, path, request, ct);
        var jobId = body?["id"]?.GetValue<string>() ?? body?["job"]?["id"]?.GetValue<string>();
        if (status == 200)
        {
            // A cached answer (e.g. the palette of a face photo that was already analysed): no job, nothing to time.
            output.Line($"{flow} #{run}: cached (200, no job) · {watch.Elapsed.TotalMilliseconds:0} ms");
            return null;
        }
        if (status != 202 || jobId is null)
        {
            output.Error($"{flow}: POST {path} → {status} {AiSmokeCommand.Code(body)}");
            _samples.Add(new Sample(flow, run, $"http {status}", watch.Elapsed.TotalMilliseconds, null, new Dictionary<string, long>()));
            return null;
        }
        return await PollAsync(flow, run, jobId, watch, ct) ? jobId : null;
    }

    private async Task ItemAsync(int run, byte[] garment, CancellationToken ct)
    {
        var watch = Stopwatch.StartNew();
        var (status, body, _) = await CallAsync(HttpMethod.Post, "v1/tenant/item/upload-url", new JsonObject { ["count"] = 1, ["contentType"] = "image/jpeg" }, ct);
        var slot = body?["uploads"]?[0];
        if (status != 200 || slot is null || await AiSmokeCommand.PresignedPostAsync(slot, garment, "image/jpeg", ct) is not null)
        {
            output.Error($"item: upload failed ({status})");
            return;
        }
        var uploaded = watch.Elapsed.TotalMilliseconds;
        watch.Restart();
        var uploadId = slot["uploadId"]!.GetValue<string>();
        (status, body, _) = await CallAsync(HttpMethod.Post, "v1/tenant/item-draft",
            new JsonObject { ["requestId"] = Ulid.New(), ["uploadIds"] = new JsonArray(uploadId), ["splitOutfit"] = false, ["manual"] = false }, ct);
        var jobId = body?["jobs"]?[0]?["id"]?.GetValue<string>();
        if (status != 202 || jobId is null)
        {
            output.Error($"item: POST item-draft → {status} {AiSmokeCommand.Code(body)}");
            return;
        }
        output.Line($"item: photo upload {uploaded:0} ms (not in the job time)");
        await PollAsync("item", run, jobId, watch, ct);
        await CallAsync(HttpMethod.Delete, $"v1/tenant/item-draft/{uploadId}", null, ct);
    }

    /// <summary>A suggestion of this run's outfit job that was never rendered (a cached one answers 200 and is skipped).</summary>
    private async Task TryOnAsync(int run, string outfitJob, CancellationToken ct, string flow = "tryon")
    {
        for (var index = 0; index < 3; index++)
        {
            var watch = Stopwatch.StartNew();
            var target = new JsonObject { ["kind"] = "suggestion", ["id"] = outfitJob, ["index"] = index };
            var (status, body, _) = await CallAsync(HttpMethod.Post, "v1/tenant/tryon", new JsonObject { ["requestId"] = Ulid.New(), ["target"] = target }, ct);
            if (status == 200)
                continue; // cached: that combination was rendered before
            if (status != 202 || body?["job"]?["id"]?.GetValue<string>() is not { } jobId)
            {
                output.Error($"{flow}: POST tryon → {status} {AiSmokeCommand.Code(body)}");
                return;
            }
            await PollAsync(flow, run, jobId, watch, ct);
            return;
        }
        output.Line($"{flow}: every suggestion of run {run} was already rendered — skipped");
    }

    /// <summary>--face: the face path once (a second user: face photo + body type, no body photo).</summary>
    private async Task FacePathAsync(SmokeFixtures fixtures, DateOnly today, CancellationToken ct)
    {
        var mainToken = _token;
        _token = null;
        try
        {
            var email = $"ai-perf-face+{DateTime.UtcNow:yyyyMMddHHmmss}@example.com";
            var (status, body, _) = await CallAsync(HttpMethod.Post, "v1/auth/register",
                new JsonObject { ["name"] = "AI Perf Face", ["email"] = email, ["password"] = "Perf-" + Guid.NewGuid().ToString("N"), ["ageConfirmed"] = true }, ct);
            if (status != 201)
                return;
            _token = body!["accessToken"]!.GetValue<string>();
            await services.GetRequiredService<IAdminAppUserService>().GrantTestPremiumAsync(OpsHost.Actor, body["userId"]!.GetValue<string>(), 1, "ai-perf", null, ct);
            var consents = new JsonArray(AiSmokeCommand.ConsentTypes.Select(t => (JsonNode)new JsonObject { ["type"] = t, ["granted"] = true, ["version"] = ConsentOptions.DefaultVersion }).ToArray());
            await CallAsync(HttpMethod.Put, "v1/tenant/consents", new JsonObject { ["consents"] = consents, ["source"] = "onboarding", ["locale"] = "tr" }, ct);
            await CallAsync(HttpMethod.Put, "v1/tenant/body-profile", new JsonObject { ["heightCm"] = 166, ["size"] = "s", ["bodyType"] = "pear", ["baseVersion"] = 0 }, ct);
            var rows = new JsonArray(AiSmokeCommand.LibraryPieces.Take(6).Select(id => (JsonNode)new JsonObject { ["clientMutationId"] = Ulid.New(), ["libraryItemId"] = id }).ToArray());
            await CallAsync(HttpMethod.Post, "v1/tenant/item/from-library", new JsonObject { ["items"] = rows }, ct);
            var (face, _) = await fixtures.GetAsync(SmokeFixtures.Face, ct);
            if (await UploadProfilePhotoAsync("face", face, ct) is not null)
                return;
            var outfit = await JobAsync("outfit (face user)", 1, "v1/tenant/stylist/outfit",
                new JsonObject { ["requestId"] = Ulid.New(), ["date"] = AiSmokeCommand.Day(today), ["occasion"] = "office", ["onlyMyWardrobe"] = true }, ct);
            if (outfit is not null)
                await TryOnAsync(1, outfit, ct, "tryon (face path)");
        }
        finally
        {
            if (_token is not null && !args.Flag("keep-user"))
                await CallAsync(HttpMethod.Delete, "v1/auth/me", null, CancellationToken.None);
            _token = mainToken;
        }
    }

    private async Task<bool> PollAsync(string flow, int run, string jobId, Stopwatch watch, CancellationToken ct)
    {
        JsonNode? job = null;
        while (watch.Elapsed < JobTimeout)
        {
            await Task.Delay(PollEvery, ct);
            var (status, body, _) = await CallAsync(HttpMethod.Get, $"v1/tenant/job/{jobId}", null, ct);
            if (status != 200)
                continue;
            job = body;
            if (job?["status"]?.GetValue<string>() is "completed" or "failed")
                break;
        }
        var clientMs = watch.Elapsed.TotalMilliseconds;
        var final = job?["status"]?.GetValue<string>() ?? "timeout";
        double? serverMs = DateTime.TryParse(job?["createdAt"]?.ToString(), CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal, out var created)
                           && DateTime.TryParse(job?["updatedAt"]?.ToString(), CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal, out var updated)
            ? (updated - created).TotalMilliseconds
            : null;
        var timings = (job?["timings"] as JsonObject ?? [])
            .Where(kv => kv.Value is JsonValue)
            .ToDictionary(kv => kv.Key, kv => kv.Value!.GetValue<long>(), StringComparer.Ordinal);
        _samples.Add(new Sample(flow, run, final is "completed" or "failed" ? final + (final == "failed" ? $":{job?["failure"]}" : "") : "timeout", clientMs, serverMs, timings));
        output.Line($"{flow} #{run}: {final} · client {clientMs / 1000:0.0}s · server {(serverMs ?? 0) / 1000:0.0}s · {string.Join(" ", timings.OrderBy(kv => kv.Key).Select(kv => $"{kv.Key}={kv.Value}"))}");
        return final == "completed";
    }

    // ── report ───────────────────────────────────────────────────────────────────────────────────────────────────────

    private void Report(string email, int runs)
    {
        output.Summary($"### ai-perf ({args.Stage}) — {runs} run(s), {email}\n\nTimes in seconds (p50 / p95, nearest rank; n = completed jobs). " +
                       "client = POST → completed seen (250 ms polling); server = job createdAt → updatedAt; noticed = when the app would see it " +
                       "with the old back-off (1,2,4,8,10 s) vs the new schedule; stage rows from job.timings (ms summed per job; db / s3 / ai.* are cumulative).\n");
        var rows = new List<IReadOnlyList<string>>();
        foreach (var flow in _samples.Select(s => s.Flow).Distinct())
        {
            var done = _samples.Where(s => s.Flow == flow && s.Status == "completed").ToList();
            var failed = _samples.Count(s => s.Flow == flow && s.Status != "completed");
            rows.Add([flow, "client e2e", Pct(done.Select(s => s.ClientMs)), $"{done.Count}{(failed > 0 ? $" (+{failed} not completed)" : "")}"]);
            rows.Add([flow, "server e2e", Pct(done.Where(s => s.ServerMs is not null).Select(s => s.ServerMs!.Value)), ""]);
            rows.Add([flow, "noticed, old poll", Pct(done.Where(s => s.ServerMs is not null).Select(s => PollSchedule.NoticedAt(s.ServerMs!.Value, PollSchedule.Old))), ""]);
            rows.Add([flow, "noticed, new poll", Pct(done.Where(s => s.ServerMs is not null).Select(s => PollSchedule.NoticedAt(s.ServerMs!.Value, PollSchedule.New))), ""]);
            foreach (var stage in done.SelectMany(s => s.Timings.Keys).Distinct().Order(StringComparer.Ordinal))
                rows.Add([flow, stage, Pct(done.Where(s => s.Timings.ContainsKey(stage)).Select(s => (double)s.Timings[stage])), ""]);
        }
        output.Table(["flow", "stage", "p50 / p95 (s)", "n"], rows);
    }

    internal static string Pct(IEnumerable<double> values)
    {
        var sorted = values.Order().ToList();
        if (sorted.Count == 0)
            return "-";
        return string.Create(CultureInfo.InvariantCulture, $"{Percentile(sorted, 50) / 1000:0.00} / {Percentile(sorted, 95) / 1000:0.00}");
    }

    /// <summary>Nearest-rank percentile of an ascending list.</summary>
    internal static double Percentile(IReadOnlyList<double> sorted, int p)
    {
        var rank = (int)Math.Ceiling(p / 100.0 * sorted.Count);
        return sorted[Math.Clamp(rank - 1, 0, sorted.Count - 1)];
    }

    // ── HTTP ─────────────────────────────────────────────────────────────────────────────────────────────────────────

    private async Task<(int Status, JsonNode? Body, TimeSpan Elapsed)> CallAsync(HttpMethod method, string path, JsonNode? body, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(method, path);
        if (_token is not null)
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _token);
        request.Headers.AcceptLanguage.ParseAdd("tr");
        if (body is not null)
            request.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
        var watch = Stopwatch.StartNew();
        using var response = await _http.SendAsync(request, ct);
        var text = await response.Content.ReadAsStringAsync(ct);
        JsonNode? json;
        try
        {
            json = string.IsNullOrWhiteSpace(text) ? null : JsonNode.Parse(text);
        }
        catch (System.Text.Json.JsonException)
        {
            json = new JsonObject { ["raw"] = text.Length > 300 ? text[..300] : text };
        }
        return ((int)response.StatusCode, json, watch.Elapsed);
    }
}

/// <summary>
/// The app's job poll schedules (mobile/src/api/pollSchedule.ts), replayed against a server completion time: the moment
/// of the first poll at or after the job finished. Request round trips are ignored (the same for both).
/// </summary>
internal static class PollSchedule
{
    /// <summary>Before: 1 s, 2, 4, 8, then every 10 s.</summary>
    public static double Old(int attempt, double elapsedMs) => Math.Min(1000 * Math.Pow(2, Math.Max(0, attempt)), 10_000);

    /// <summary>After (no server hint): every 750 ms for the first 3 s, then 1.5 s, and 3 s after 15 s.</summary>
    public static double New(int attempt, double elapsedMs) => elapsedMs < 3000 ? 750 : elapsedMs < 15_000 ? 1500 : 3000;

    public static double NoticedAt(double completedMs, Func<int, double, double> interval)
    {
        double t = 0;
        for (var attempt = 0; attempt < 1000; attempt++)
        {
            t += interval(attempt, t);
            if (t >= completedMs)
                return t;
        }
        return t;
    }
}
