using System.Diagnostics;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Amazon.S3;
using Amazon.S3.Model;
using Domain.Options;
using Domain.Services.Admin;
using Infrastructure.Ai;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Ulid = Domain.Extensions.Ulid;

namespace Ops.Commands;

/// <summary>
/// ai-smoke: every AI flow end to end through the public API on dev, as a throw-away user
/// (ai-smoke+{ts}@example.com): register → test premium (admin service, audited as ops:github-actions) → style / body
/// profile → synthetic body + face photo → library pieces → stylist outfit, week, trip pack (cabin), item processing,
/// palette, try-on (1 credit, then the cached repeat is free) → DELETE v1/auth/me, and the tenant's S3 objects are checked
/// to be gone. Prints endpoint · job status · duration · failure · notable output; model ids from the worker logs.
/// </summary>
internal sealed partial class AiSmokeCommand(IServiceProvider services, OpsArguments args, OpsOutput output)
{
    public const string DevApiUrl = "https://b8lvaj4r5e.execute-api.eu-central-1.amazonaws.com";
    private static readonly TimeSpan JobTimeout = TimeSpan.FromMinutes(6);

    private static readonly string[] LibraryPieces =
    [
        "lib-white-tshirt", "lib-white-shirt", "lib-black-turtleneck", "lib-blue-jeans", "lib-black-trousers", "lib-little-black-dress",
        "lib-navy-blazer", "lib-camel-coat", "lib-white-sneakers", "lib-black-ankle-boots", "lib-black-tote", "lib-silk-scarf",
    ];

    private static readonly IReadOnlyDictionary<string, string> WorkerOf = new Dictionary<string, string>
    {
        ["stylist outfit"] = "stylist", ["stylist week"] = "stylist", ["trip pack"] = "stylist",
        ["item processing"] = "item-processor", ["palette"] = "palette", ["try-on"] = "tryon",
    };

    private readonly List<Row> _rows = [];
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(60) };
    private string? _token;

    private sealed record Row(string Endpoint, string Status, TimeSpan Duration, string Failure, string Notable);

    private void Add(string endpoint, string status, TimeSpan duration, string? failure = null, string? notable = null) =>
        _rows.Add(new Row(endpoint, status, duration, failure ?? "", notable ?? ""));

    public async Task<int> RunAsync(CancellationToken ct)
    {
        var started = DateTime.UtcNow;
        var api = (args.Option("api-url") ?? DevApiUrl).TrimEnd('/') + "/";
        _http.BaseAddress = new Uri(api);
        var ai = services.GetRequiredService<IOptionsMonitor<AiOptions>>().CurrentValue;
        output.Line($"Ai config ({args.Stage}): Enabled={ai.Enabled} TextModel={ai.TextModel} ImageModel={ai.ImageModel} ApiKey set={ai.HasApiKey}");

        var s3 = services.GetRequiredService<IAmazonS3>();
        var photoBucket = OpsHost.PhotoBucket(args.Stage);
        var budget = new ImageCallBudget(OpsArguments.MaxImageCallsPerRun);
        var fixtures = new SmokeFixtures(s3, services.GetRequiredService<OpenAiProvider>(), photoBucket, budget, output);

        var email = $"ai-smoke+{DateTime.UtcNow:yyyyMMddHHmmss}@example.com";
        string? userId = null, tenantId = null;
        var exit = 0;
        try
        {
            // ── account ──────────────────────────────────────────────────────────────────────────────────────────
            var password = "Smoke-" + Guid.NewGuid().ToString("N");
            var (status, body, elapsed) = await CallAsync(HttpMethod.Post, "v1/auth/register", new JsonObject { ["name"] = "AI Smoke", ["email"] = email, ["password"] = password }, ct);
            Add("POST v1/auth/register", status.ToString(), elapsed, status == 201 ? null : Code(body), email);
            if (status != 201)
                return 1;
            _token = body!["accessToken"]!.GetValue<string>();
            userId = body["userId"]!.GetValue<string>();
            tenantId = body["tenantId"]!.GetValue<string>();

            var watch = Stopwatch.StartNew();
            var grant = await services.GetRequiredService<IAdminAppUserService>().GrantTestPremiumAsync(OpsHost.Actor, userId, 1, "ai-smoke", null, ct);
            Add("grant test premium (admin service)", grant?.Entitlement.Tier.ToString() ?? "not found", watch.Elapsed, null,
                $"credits {grant?.Credits.AllowanceRemaining}/{grant?.Credits.AllowanceTotal}");

            await Step("PUT v1/tenant/style-profile", HttpMethod.Put, "v1/tenant/style-profile",
                new JsonObject { ["segment"] = "women", ["styleTags"] = new JsonArray("minimal", "classic", "quietLuxury"), ["budget"] = "mixed", ["baseVersion"] = 0 }, 200, ct);
            await Step("PUT v1/tenant/body-profile", HttpMethod.Put, "v1/tenant/body-profile",
                new JsonObject { ["heightCm"] = 168, ["size"] = "m", ["baseVersion"] = 0 }, 200, ct);

            // ── synthetic photos ─────────────────────────────────────────────────────────────────────────────────
            foreach (var (kind, fixture) in new[] { ("body", SmokeFixtures.Body), ("face", SmokeFixtures.Face) })
            {
                watch.Restart();
                var (data, generated) = await fixtures.GetAsync(fixture, ct);
                var photo = await UploadProfilePhotoAsync(kind, data, ct);
                Add($"photo {kind} (upload-url → S3 → PUT v1/tenant/photo/{kind})", photo.Ok ? "200" : "failed", watch.Elapsed, photo.Error,
                    $"{data.Length / 1024} KB synthetic{(generated ? ", generated now" : ", from ops-fixtures/")}");
            }

            // ── wardrobe from the library ────────────────────────────────────────────────────────────────────────
            var rows = new JsonArray(LibraryPieces.Select(id => (JsonNode)new JsonObject { ["clientMutationId"] = Ulid.New(), ["libraryItemId"] = id }).ToArray());
            (status, body, elapsed) = await CallAsync(HttpMethod.Post, "v1/tenant/item/from-library", new JsonObject { ["items"] = rows }, ct);
            var created = body?["results"]?.AsArray().Count(r => r?["outcome"]?.GetValue<string>() == "created") ?? 0;
            Add("POST v1/tenant/item/from-library", status.ToString(), elapsed, status is 200 or 201 ? null : Code(body), $"{created}/{LibraryPieces.Length} pieces created");

            var today = DateOnly.FromDateTime(DateTime.UtcNow);

            // ── stylist outfit ───────────────────────────────────────────────────────────────────────────────────
            var outfitJob = await JobStepAsync("stylist outfit", "v1/tenant/stylist/outfit",
                new JsonObject { ["requestId"] = Ulid.New(), ["date"] = Day(today), ["occasion"] = "office", ["onlyMyWardrobe"] = true }, ct,
                result =>
                {
                    var suggestions = result?["suggestions"]?.AsArray() ?? [];
                    var sources = string.Join(",", suggestions.Select(s => s?["source"]?.GetValue<string>()).Distinct());
                    var title = suggestions.FirstOrDefault()?["title"]?.GetValue<string>();
                    return $"{suggestions.Count} suggestion(s), source {sources}, refusal {result?["refusal"]?.ToString() ?? "null"}, lang {result?["language"]}, first: “{title}”";
                });

            // ── week plan ────────────────────────────────────────────────────────────────────────────────────────
            await JobStepAsync("stylist week", "v1/tenant/stylist/week",
                new JsonObject { ["requestId"] = Ulid.New(), ["weekStart"] = Day(today), ["onlyMyWardrobe"] = true }, ct,
                result =>
                {
                    var days = result?["days"]?.AsArray() ?? [];
                    var dressed = days.Count(d => d?["outfit"] is JsonObject);
                    var sources = string.Join(",", days.Select(d => d?["outfit"]?["source"]?.GetValue<string>()).Where(s => s is not null).Distinct());
                    return $"{dressed}/{days.Count} days dressed, source {sources}, refusal {result?["refusal"]?.ToString() ?? "null"}";
                });

            // ── trip pack (cabin only) ───────────────────────────────────────────────────────────────────────────
            var tripId = Ulid.New();
            (status, body, elapsed) = await CallAsync(HttpMethod.Post, "v1/tenant/trip", new JsonObject
            {
                ["id"] = tripId, ["cityId"] = "paris", ["cityName"] = "Paris", ["startDate"] = Day(today.AddDays(7)), ["endDate"] = Day(today.AddDays(9)),
                ["tripTypes"] = new JsonArray("business", "dinner"), ["cabinOnly"] = true,
            }, ct);
            Add("POST v1/tenant/trip", status.ToString(), elapsed, status is 200 or 201 ? null : Code(body), "3 days, cabin only");
            await JobStepAsync("trip pack", $"v1/tenant/trip/{tripId}/pack", new JsonObject { ["requestId"] = Ulid.New() }, ct,
                result => $"{result?["items"]?.AsArray().Count} pieces packed, cabinLimit {result?["cabinLimit"]?.ToString() ?? "null"}, trimmed {result?["cabinTrimmed"]}, " +
                          $"everyPieceWornTwice {result?["everyPieceWornTwice"]}, source {result?["source"]}, days {result?["days"]?.AsArray().Count}");

            // ── item processing on one photo ─────────────────────────────────────────────────────────────────────
            await ItemProcessingAsync(fixtures, ct);

            // ── palette ──────────────────────────────────────────────────────────────────────────────────────────
            (status, body, elapsed) = await CallAsync(HttpMethod.Post, "v1/tenant/palette/analyze", new JsonObject { ["requestId"] = Ulid.New() }, ct);
            if (status == 202 && body?["job"]?["id"]?.GetValue<string>() is { } paletteJob)
                await PollStepAsync("palette", "POST v1/tenant/palette/analyze", paletteJob, elapsed, ct,
                    result => $"season {result?["seasonTypeId"]}, lowConfidence {result?["lowConfidence"]}");
            else
                Add("POST v1/tenant/palette/analyze", status.ToString(), elapsed, Code(body), body?["status"]?.ToString());

            // ── try-on: 1 credit, then the cached repeat is free ─────────────────────────────────────────────────
            if (outfitJob is not null)
                await TryOnAsync(outfitJob, ct);
            else
                Add("POST v1/tenant/tryon", "skipped", TimeSpan.Zero, "no outfit job");
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
        {
            exit = 1;
            output.Error($"ai-smoke aborted: {ex.GetType().Name}: {ex.Message}");
            Add("(aborted)", "error", TimeSpan.Zero, ex.GetType().Name, ex.Message);
        }
        finally
        {
            await AttachModelsAsync(started, ct);
            if (_token is not null && tenantId is not null && !args.Flag("keep-user"))
                await DeleteUserAsync(s3, photoBucket, tenantId, email, ct);
            output.Summary($"### ai-smoke ({args.Stage}) — {email}\n\nAi: Enabled={ai.Enabled} · text `{ai.TextModel}` · image `{ai.ImageModel}` · image-model calls by the tool (fixtures): {budget.Used}\n");
            output.Table(["endpoint", "job status", "duration", "failure code", "notable output"],
                _rows.Select(r => (IReadOnlyList<string>)[r.Endpoint, r.Status, $"{r.Duration.TotalSeconds:0.0}s", r.Failure, r.Notable]));
        }

        var failed = _rows.Any(r => r.Status is "failed" or "timeout" or "error" || r.Failure.Length > 0);
        return exit != 0 || failed ? 1 : 0;
    }

    // ── flows ────────────────────────────────────────────────────────────────────────────────────────────────────────

    private async Task ItemProcessingAsync(SmokeFixtures fixtures, CancellationToken ct)
    {
        var watch = Stopwatch.StartNew();
        var (garment, _) = await fixtures.GetAsync(SmokeFixtures.Garment, ct);
        var (status, body, _) = await CallAsync(HttpMethod.Post, "v1/tenant/item/upload-url", new JsonObject { ["count"] = 1, ["contentType"] = "image/jpeg" }, ct);
        var slot = body?["uploads"]?[0];
        if (status != 200 || slot is null)
        {
            Add("POST v1/tenant/item/upload-url", status.ToString(), watch.Elapsed, Code(body));
            return;
        }
        var uploadError = await PresignedPostAsync(slot, garment, "image/jpeg", ct);
        if (uploadError is not null)
        {
            Add("item photo S3 upload", "failed", watch.Elapsed, uploadError);
            return;
        }
        var uploadId = slot["uploadId"]!.GetValue<string>();
        (status, body, var elapsed) = await CallAsync(HttpMethod.Post, "v1/tenant/item-draft",
            new JsonObject { ["requestId"] = Ulid.New(), ["uploadIds"] = new JsonArray(uploadId), ["splitOutfit"] = false, ["manual"] = false }, ct);
        var jobId = body?["jobs"]?[0]?["id"]?.GetValue<string>();
        if (status != 202 || jobId is null)
        {
            Add("POST v1/tenant/item-draft", status.ToString(), elapsed, Code(body));
            return;
        }
        await PollStepAsync("item processing", "POST v1/tenant/item-draft", jobId, watch.Elapsed, ct, _ => "");
        var (_, drafts, _) = await CallAsync(HttpMethod.Get, "v1/tenant/item-draft", null, ct);
        var draft = drafts?["drafts"]?.AsArray().FirstOrDefault(d => d?["id"]?.GetValue<string>() == uploadId);
        if (draft is not null && _rows.LastOrDefault() is { } last)
        {
            var cleaned = draft["imageUrl"]?.GetValue<string>() is { } image && draft["originalImageUrl"]?.GetValue<string>() is { } original
                          && StripQuery(image) != StripQuery(original);
            _rows[^1] = last with
            {
                Notable = $"draft {draft["status"]}: {draft["category"]}, colours [{string.Join(",", draft["colorIds"]?.AsArray().Select(c => c?.ToString()) ?? [])}], " +
                          $"fabric {draft["fabric"]}, name “{draft["name"]}”, flagged [{string.Join(",", draft["flaggedFields"]?.AsArray().Select(c => c?.ToString()) ?? [])}], " +
                          $"background removed: {(cleaned ? "yes (cleaned image)" : "no (original shown)")}",
            };
        }
    }

    private async Task TryOnAsync(string outfitJobId, CancellationToken ct)
    {
        var before = await CreditsAsync(ct);
        var target = new JsonObject { ["kind"] = "suggestion", ["id"] = outfitJobId, ["index"] = 0 };
        var (status, body, elapsed) = await CallAsync(HttpMethod.Post, "v1/tenant/tryon", new JsonObject { ["requestId"] = Ulid.New(), ["target"] = target }, ct);
        if (status == 202 && body?["job"]?["id"]?.GetValue<string>() is { } jobId)
        {
            var afterQueue = await CreditsAsync(ct);
            await PollStepAsync("try-on", "POST v1/tenant/tryon", jobId, elapsed, ct, result => $"image {result?["tryOnImageId"]}");
            var after = await CreditsAsync(ct);
            if (_rows.LastOrDefault() is { } last)
                _rows[^1] = last with { Notable = $"{last.Notable}; credits {before} → {afterQueue} (queued) → {after} (done, {(before - after == 1 ? "1 charged ✓" : $"Δ {before - after} ✗")})" };
        }
        else
        {
            Add("POST v1/tenant/tryon", status.ToString(), elapsed, Code(body), body?["status"]?.ToString());
            return;
        }

        var beforeRepeat = await CreditsAsync(ct);
        (status, body, elapsed) = await CallAsync(HttpMethod.Post, "v1/tenant/tryon", new JsonObject { ["requestId"] = Ulid.New(), ["target"] = target.DeepClone() }, ct);
        var afterRepeat = await CreditsAsync(ct);
        var cached = status == 200 && body?["status"]?.GetValue<string>() == "cached";
        Add("POST v1/tenant/tryon (same outfit again)", $"{status} {body?["status"]}", elapsed, cached && beforeRepeat == afterRepeat ? null : "not_cached_or_charged",
            $"credits {beforeRepeat} → {afterRepeat} ({(beforeRepeat == afterRepeat ? "free ✓" : "charged ✗")})");
    }

    private async Task<int> CreditsAsync(CancellationToken ct)
    {
        var (_, body, _) = await CallAsync(HttpMethod.Get, "v1/tenant/entitlement", null, ct);
        return body?["credits"]?["totalRemaining"]?.GetValue<int>() ?? -1;
    }

    private async Task DeleteUserAsync(IAmazonS3 s3, string bucket, string tenantId, string email, CancellationToken ct)
    {
        var objectsBefore = await CountObjectsAsync(s3, bucket, tenantId, ct);
        var (status, body, elapsed) = await CallAsync(HttpMethod.Delete, "v1/auth/me", null, ct);
        var objectsAfter = await CountObjectsAsync(s3, bucket, tenantId, ct);
        var stillThere = (await services.GetRequiredService<IAdminAppUserService>().SearchAsync(email, null, 1, ct)).Items
            .Any(u => string.Equals(u.Email, email, StringComparison.OrdinalIgnoreCase));
        var ok = status == 204 && objectsAfter == 0 && !stillThere;
        Add("DELETE v1/auth/me", status.ToString(), elapsed, ok ? null : status == 204 ? "leftovers" : Code(body),
            $"tenant S3 objects (photos, try-on, items, uploads) {objectsBefore} → {objectsAfter}; user record {(stillThere ? "still present ✗" : "gone ✓")}");
    }

    private static async Task<int> CountObjectsAsync(IAmazonS3 s3, string bucket, string tenantId, CancellationToken ct)
    {
        var total = 0;
        foreach (var prefix in new[] { $"tenant/{tenantId}/", $"uploads/tmp/{tenantId}/" })
        {
            var request = new ListObjectsV2Request { BucketName = bucket, Prefix = prefix };
            ListObjectsV2Response response;
            do
            {
                response = await s3.ListObjectsV2Async(request, ct);
                total += response.S3Objects?.Count ?? 0;
                request.ContinuationToken = response.NextContinuationToken;
            } while (response.IsTruncated == true);
        }
        return total;
    }

    // ── model ids from the worker logs ───────────────────────────────────────────────────────────────────────────────

    [GeneratedRegex(@"OpenAI (?<op>[a-z_]+) (?<outcome>ok|failed)[^\n]*?(model (?<model>[A-Za-z0-9._:\-]+))?[,)]", RegexOptions.ExplicitCapture)]
    private static partial Regex OpenAiLine();

    private async Task AttachModelsAsync(DateTime started, CancellationToken ct)
    {
        var window = DateTime.UtcNow - started + TimeSpan.FromMinutes(2);
        foreach (var worker in WorkerOf.Values.Distinct())
        {
            IReadOnlyList<(DateTime At, string Message)> events;
            try
            {
                events = await LogsCommand.FetchAsync(args.Stage, worker, window, "OpenAI", 500, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                output.Error($"logs {worker}: {ex.Message}");
                continue;
            }
            var calls = events.Where(e => e.At >= started.AddSeconds(-5))
                .Select(e => OpenAiLine().Match(e.Message)).Where(m => m.Success)
                .GroupBy(m => $"{m.Groups["op"].Value} {m.Groups["outcome"].Value}{(m.Groups["model"].Success ? " " + m.Groups["model"].Value : "")}")
                .Select(g => $"{g.Key} ×{g.Count()}").ToList();
            output.Line($"{worker} log: {(calls.Count == 0 ? "no OpenAI lines" : string.Join("; ", calls))}");
            foreach (var (row, index) in _rows.Select((r, i) => (r, i)).ToList())
                if (WorkerOf.TryGetValue(row.Endpoint, out var fn) && fn == worker)
                    _rows[index] = row with { Notable = $"{row.Notable} [{worker}: {(calls.Count == 0 ? "no OpenAI log line" : string.Join("; ", calls))}]" };
        }
    }

    // ── HTTP helpers ─────────────────────────────────────────────────────────────────────────────────────────────────

    private async Task Step(string name, HttpMethod method, string path, JsonObject body, int expected, CancellationToken ct)
    {
        var (status, response, elapsed) = await CallAsync(method, path, body, ct);
        Add(name, status.ToString(), elapsed, status == expected ? null : Code(response));
    }

    /// <summary>POST a job, poll it; returns the job id when it completed.</summary>
    private async Task<string?> JobStepAsync(string name, string path, JsonObject request, CancellationToken ct, Func<JsonNode?, string> describe)
    {
        var (status, body, elapsed) = await CallAsync(HttpMethod.Post, path, request, ct);
        var jobId = body?["id"]?.GetValue<string>() ?? body?["job"]?["id"]?.GetValue<string>();
        if (status != 202 || jobId is null)
        {
            Add(name, status.ToString(), elapsed, Code(body));
            return null;
        }
        return await PollStepAsync(name, "POST " + path, jobId, elapsed, ct, describe) ? jobId : null;
    }

    private async Task<bool> PollStepAsync(string name, string call, string jobId, TimeSpan already, CancellationToken ct, Func<JsonNode?, string> describe)
    {
        var watch = Stopwatch.StartNew();
        JsonNode? job = null;
        while (watch.Elapsed < JobTimeout)
        {
            await Task.Delay(TimeSpan.FromSeconds(3), ct);
            var (status, body, _) = await CallAsync(HttpMethod.Get, $"v1/tenant/job/{jobId}", null, ct);
            if (status != 200)
                continue;
            job = body;
            if (job?["status"]?.GetValue<string>() is "completed" or "failed")
                break;
        }
        var final = job?["status"]?.GetValue<string>() ?? "unknown";
        var total = already + watch.Elapsed;
        if (final is not ("completed" or "failed"))
        {
            Add(name, "timeout", total, "poll_timeout", $"{call} → last status {final}");
            return false;
        }
        var failure = job?["failure"]?.ToString();
        Add(name, final, total, final == "failed" ? failure ?? "failed" : null, final == "completed" ? describe(job?["result"]) : $"{call}");
        output.Line($"{name}: job {jobId} {final} in {total.TotalSeconds:0}s");
        return final == "completed";
    }

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
        JsonNode? json = null;
        try
        {
            json = string.IsNullOrWhiteSpace(text) ? null : JsonNode.Parse(text);
        }
        catch (System.Text.Json.JsonException)
        {
            json = new JsonObject { ["raw"] = text.Length > 300 ? text[..300] : text };
        }
        if (!response.IsSuccessStatusCode)
            output.Line($"{method} {path} → {(int)response.StatusCode} {Code(json)}");
        return ((int)response.StatusCode, json, watch.Elapsed);
    }

    private async Task<(bool Ok, string? Error)> UploadProfilePhotoAsync(string kind, byte[] data, CancellationToken ct)
    {
        var (status, slot, _) = await CallAsync(HttpMethod.Post, "v1/tenant/photo/upload-url", new JsonObject { ["kind"] = kind, ["contentType"] = "image/jpeg" }, ct);
        if (status != 200 || slot is null)
            return (false, $"upload-url {status} {Code(slot)}");
        if (await PresignedPostAsync(slot, data, "image/jpeg", ct) is { } error)
            return (false, error);
        var (put, body, _) = await CallAsync(HttpMethod.Put, $"v1/tenant/photo/{kind}",
            new JsonObject { ["uploadId"] = slot["uploadId"]!.GetValue<string>(), ["clientMutationId"] = Ulid.New() }, ct);
        return put == 200 ? (true, null) : (false, $"activate {put} {Code(body)}");
    }

    /// <summary>S3 presigned POST: every field first, the file last.</summary>
    private static async Task<string?> PresignedPostAsync(JsonNode slot, byte[] data, string contentType, CancellationToken ct)
    {
        using var form = new MultipartFormDataContent();
        foreach (var (key, value) in slot["fields"]!.AsObject())
            form.Add(new StringContent(value!.GetValue<string>()), key);
        var file = new ByteArrayContent(data);
        file.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        form.Add(file, "file", "photo.jpg");
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(60) };
        using var response = await http.PostAsync(slot["url"]!.GetValue<string>(), form, ct);
        return response.IsSuccessStatusCode ? null : $"S3 {(int)response.StatusCode}: {Truncate(await response.Content.ReadAsStringAsync(ct), 300)}";
    }

    private static string Day(DateOnly day) => day.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
    private static string Code(JsonNode? body) => body?["code"]?.ToString() ?? body?["title"]?.ToString() ?? body?["raw"]?.ToString() ?? "";
    private static string StripQuery(string url) => url.Split('?')[0];
    private static string Truncate(string text, int max) => text.Length > max ? text[..max] + "…" : text;
}
