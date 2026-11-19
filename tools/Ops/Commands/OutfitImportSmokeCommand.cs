using System.Diagnostics;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;
using Amazon.S3;
using Amazon.S3.Model;
using Domain.Options;
using Infrastructure.Ai;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Ulid = Domain.Extensions.Ulid;

namespace Ops.Commands;

/// <summary>
/// outfit-import-smoke (dev only, needs the outfit-import infra): "Kombinlerini içe aktar" end to end through the public
/// API as a throw-away free user (outfit-import-smoke+{ts}@example.com):
///   register → entitlement shows outfitImport.maxPhotos and the free recognitions → three synthetic outfit photos
///   (ops-fixtures/, generated once) → POST outfit-import → presigned POSTs → per-photo confirmations → poll until ready
///   (counters, pieces "match" / "new", the shirt both photos share counted once) → commit everything → looks with
///   their cover photo, new items, each item's background removal finishing → a second import of photo 1 matches
///   the pieces just created ("Gardırobunda var") → discard it → DELETE v1/auth/me and every S3 object of the tenant
///   (uploads/import/ included) is gone.
/// Model calls: 3 detections + a few match calls + one cleanup per new piece + 1 detection and its matches for the re-import
/// (≈ 15–25 for these photos), plus 3 image generations the first time the fixtures are made.
/// </summary>
internal sealed class OutfitImportSmokeCommand(IServiceProvider services, OpsArguments args, OpsOutput output)
{
    private static readonly TimeSpan ProcessTimeout = TimeSpan.FromMinutes(8);
    private static readonly TimeSpan CleanupTimeout = TimeSpan.FromMinutes(5);

    /// <summary>Three mirror selfies: the white shirt is in A and B, the jeans in A and C (de-duplication), faces hidden.</summary>
    internal static readonly SmokeFixtures.Fixture[] Outfits =
    [
        new("outfit-a.jpg", "1024x1536",
            "Amateur smartphone mirror selfie of a fictional adult woman (an invented person) in a bright bedroom, the phone covering her face. " +
            "Full body visible. She wears a plain white button-up cotton shirt, plain light-blue straight jeans and plain white leather sneakers. No text, no logos."),
        new("outfit-b.jpg", "1024x1536",
            "Amateur smartphone mirror selfie of a fictional adult woman (an invented person) in a hallway, the phone covering her face. " +
            "Full body visible. She wears the same plain white button-up cotton shirt under an open black blazer, plain black straight trousers and black leather loafers. No text, no logos."),
        new("outfit-c.jpg", "1024x1536",
            "Amateur smartphone mirror selfie of a fictional adult woman (an invented person) in a living room, the phone covering her face. " +
            "Full body visible. She wears a chunky cream wool sweater, the same plain light-blue straight jeans and plain white leather sneakers, with a brown leather shoulder bag. No text, no logos."),
    ];

    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(60) };
    private readonly List<string[]> _rows = [];
    private string? _token;
    private bool _failed;

    private void Check(string step, bool ok, TimeSpan elapsed, string detail)
    {
        _rows.Add([step, ok ? "ok" : "FAILED", $"{elapsed.TotalSeconds:0.0}s", detail]);
        if (!ok) _failed = true;
        output.Line($"{(ok ? "ok  " : "FAIL")} {step}: {detail}");
    }

    public async Task<int> RunAsync(CancellationToken ct)
    {
        var api = (args.Option("api-url") ?? AiSmokeCommand.DevApiUrl).TrimEnd('/') + "/";
        _http.BaseAddress = new Uri(api);
        var s3 = services.GetRequiredService<IAmazonS3>();
        var bucket = OpsHost.PhotoBucket(args.Stage);
        var ai = services.GetRequiredService<IOptionsMonitor<AiOptions>>().CurrentValue;
        var budget = new ImageCallBudget(OpsArguments.MaxImageCallsPerRun);
        var fixtures = new SmokeFixtures(s3, services.GetRequiredService<OpenAiProvider>(), bucket, budget, output);
        var email = $"outfit-import-smoke+{DateTime.UtcNow:yyyyMMddHHmmss}@example.com";
        var watch = Stopwatch.StartNew();
        string? tenantId = null;

        try
        {
            var (status, body) = await CallAsync(HttpMethod.Post, "v1/auth/register",
                new JsonObject { ["name"] = "Import Smoke", ["email"] = email, ["password"] = "Smoke-" + Guid.NewGuid().ToString("N"), ["ageConfirmed"] = true }, ct);
            Check("POST v1/auth/register", status == 201, watch.Elapsed, $"{status} {email}");
            if (status != 201) return 1;
            _token = body!["accessToken"]!.GetValue<string>();
            tenantId = body["tenantId"]!.GetValue<string>();
            var consents = new JsonArray(AiSmokeCommand.ConsentTypes.Select(t => (JsonNode)new JsonObject { ["type"] = t, ["granted"] = true, ["version"] = ConsentOptions.DefaultVersion }).ToArray());
            (status, _) = await CallAsync(HttpMethod.Put, "v1/tenant/consents", new JsonObject { ["consents"] = consents, ["source"] = "onboarding", ["locale"] = "tr" }, ct);
            Check("PUT v1/tenant/consents", status == 200, watch.Elapsed, status.ToString());

            // ── the plan limit and the free allowance, as the app reads them ─────────────────────────────────────
            (status, body) = await CallAsync(HttpMethod.Get, "v1/tenant/entitlement", null, ct);
            var maxPhotos = body?["outfitImport"]?["maxPhotos"]?.GetValue<int>();
            Check("GET v1/tenant/entitlement", status == 200 && maxPhotos >= 3, watch.Elapsed,
                $"tier {body?["tier"]}, outfitImport.maxPhotos {maxPhotos}, itemRecognition {body?["itemRecognition"]?.ToJsonString()}");

            // ── import of three photos ───────────────────────────────────────────────────────────────────────────
            var photos = new List<byte[]>();
            foreach (var fixture in Outfits)
                photos.Add((await fixtures.GetAsync(fixture, ct)).Data);
            var sessionId = await ImportAsync("import 3 outfit photos", photos, ct);
            if (sessionId is null) return 1;

            var session = await PollAsync(sessionId, ct);
            if (session is null) return 1;
            var pieces = session["photos"]!.AsArray().SelectMany(p => p!["pieces"]!.AsArray()).OfType<JsonObject>().ToList();
            var newOccurrences = pieces.Count(p => p["kind"]?.GetValue<string>() == "new");
            var newPieces = session["newPieceCount"]!.GetValue<int>();
            foreach (var photo in session["photos"]!.AsArray().OfType<JsonObject>())
                output.Line($"  photo {photo["index"]} {photo["status"]}: " + string.Join("; ", photo["pieces"]!.AsArray().OfType<JsonObject>()
                    .Select(p => $"{p["ref"]} {p["kind"]} {p["category"]}/{p["subcategory"]} “{p["name"]}” slot {p["slot"]} alsoIn [{string.Join(",", p["alsoIn"]!.AsArray().Select(a => a!.ToString()))}]")));
            Check("de-duplication", newPieces < newOccurrences, watch.Elapsed,
                $"{newOccurrences} new piece occurrence(s) across photos → {newPieces} distinct new piece(s); counters {session["counters"]?.ToJsonString()}");

            // ── commit everything ────────────────────────────────────────────────────────────────────────────────
            var commitWatch = Stopwatch.StartNew();
            (status, body) = await CallAsync(HttpMethod.Post, $"v1/tenant/outfit-import/{sessionId}/commit", new JsonObject { ["looks"] = new JsonArray() }, ct);
            var looksCreated = body?["createdLookCount"]?.GetValue<int>() ?? 0;
            var itemsCreated = body?["createdItemCount"]?.GetValue<int>() ?? 0;
            Check("POST outfit-import/{id}/commit", status == 200 && looksCreated >= 1 && itemsCreated >= 1, commitWatch.Elapsed,
                $"{looksCreated} look(s), {itemsCreated} new item(s), {body?["cleanupJobCount"]} cleanup job(s); looks {body?["looks"]?.ToJsonString()}");
            (status, body) = await CallAsync(HttpMethod.Post, $"v1/tenant/outfit-import/{sessionId}/commit", new JsonObject { ["looks"] = new JsonArray() }, ct);
            Check("commit replay", status == 200 && body?["createdItemCount"]?.GetValue<int>() == itemsCreated, commitWatch.Elapsed, "same result, nothing created twice");

            (status, body) = await CallAsync(HttpMethod.Get, "v1/tenant/look", null, ct);
            var imported = body?.AsArray().OfType<JsonObject>().Where(l => l["source"]?.GetValue<string>() == "import").ToList() ?? [];
            Check("GET v1/tenant/look", imported.Count == looksCreated && imported.All(l => l["coverImageUrl"]?.GetValue<string>() is { Length: > 0 }), commitWatch.Elapsed,
                $"{imported.Count} imported look(s), every one with its cover photo; slots {string.Join(" | ", imported.Select(l => string.Join(",", l["slots"]!.AsArray().Select(s => s!["slot"]))))}");

            // Background removal only for the created items: each ends with a cleaned image.
            var cleaned = await WaitForCleanupAsync(itemsCreated, ct);
            Check("background removal of the new items", cleaned == itemsCreated, commitWatch.Elapsed, $"{cleaned}/{itemsCreated} item(s) show their cleaned image");

            // ── re-import of photo A: its pieces are in the wardrobe now ─────────────────────────────────────────
            var again = await ImportAsync("re-import photo A", [photos[0]], ct);
            if (again is not null && await PollAsync(again, ct) is { } second)
            {
                var kinds = second["photos"]!.AsArray().SelectMany(p => p!["pieces"]!.AsArray()).Select(p => p!["kind"]!.GetValue<string>()).ToList();
                Check("matching against the wardrobe", kinds.Count(k => k == "match") >= 1, watch.Elapsed,
                    $"{kinds.Count(k => k == "match")} of {kinds.Count} piece(s) tagged “Gardırobunda var”");
                (status, _) = await CallAsync(HttpMethod.Delete, $"v1/tenant/outfit-import/{again}", null, ct);
                Check("DELETE outfit-import/{id} (discard)", status == 204, watch.Elapsed, status.ToString());
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
        {
            Check("(aborted)", false, watch.Elapsed, $"{ex.GetType().Name}: {ex.Message}");
        }
        finally
        {
            if (_token is not null && tenantId is not null && !args.Flag("keep-user"))
            {
                var before = await CountObjectsAsync(s3, bucket, tenantId, ct);
                var (status, _) = await CallAsync(HttpMethod.Delete, "v1/auth/me", null, ct);
                var after = await CountObjectsAsync(s3, bucket, tenantId, ct);
                Check("DELETE v1/auth/me", status == 204 && after == 0, watch.Elapsed, $"tenant S3 objects (tenant/, uploads/tmp/, uploads/import/) {before} → {after}");
            }
            output.Summary($"### outfit-import-smoke ({args.Stage}) — {email}\n\nAi: Enabled={ai.Enabled} · text `{ai.TextModel}` · fast `{ai.FastTextModel ?? "-"}` · image `{ai.ImageModel}` · fixture image calls: {budget.Used}\n");
            output.Table(["step", "result", "time", "detail"], _rows.Select(r => (IReadOnlyList<string>)r));
        }
        return _failed ? 1 : 0;
    }

    /// <summary>Session → presigned POSTs → confirmations; the session id, or null.</summary>
    private async Task<string?> ImportAsync(string name, IReadOnlyList<byte[]> photos, CancellationToken ct)
    {
        var watch = Stopwatch.StartNew();
        var (status, body) = await CallAsync(HttpMethod.Post, "v1/tenant/outfit-import", new JsonObject { ["requestId"] = Ulid.New(), ["count"] = photos.Count }, ct);
        var uploads = body?["uploads"]?.AsArray().OfType<JsonObject>().ToList() ?? [];
        var sessionId = body?["session"]?["id"]?.GetValue<string>();
        Check($"{name}: POST v1/tenant/outfit-import", status == 201 && uploads.Count == photos.Count && sessionId is not null, watch.Elapsed,
            $"{status}, {uploads.Count} slot(s), maxPhotos {body?["maxPhotos"]}, skipped {body?["skipped"]}");
        if (sessionId is null || uploads.Count != photos.Count)
            return null;
        for (var i = 0; i < uploads.Count; i++)
        {
            if (await AiSmokeCommand.PresignedPostAsync(uploads[i], photos[i], "image/jpeg", ct) is { } error)
            {
                Check($"{name}: S3 upload {i + 1}", false, watch.Elapsed, error);
                return null;
            }
            var index = uploads[i]["index"]!.GetValue<int>();
            (status, _) = await CallAsync(HttpMethod.Post, $"v1/tenant/outfit-import/{sessionId}/photos/{index}/uploaded", null, ct);
            if (status != 200)
            {
                Check($"{name}: confirm photo {index}", false, watch.Elapsed, status.ToString());
                return null;
            }
        }
        Check($"{name}: uploads + confirmations", true, watch.Elapsed, $"{photos.Count} photo(s) queued");
        return sessionId;
    }

    private async Task<JsonObject?> PollAsync(string sessionId, CancellationToken ct)
    {
        var watch = Stopwatch.StartNew();
        JsonObject? session = null;
        while (watch.Elapsed < ProcessTimeout)
        {
            await Task.Delay(TimeSpan.FromSeconds(4), ct);
            var (status, body) = await CallAsync(HttpMethod.Get, $"v1/tenant/outfit-import/{sessionId}", null, ct);
            if (status != 200 || body is not JsonObject json)
                continue;
            session = json;
            if (json["status"]?.GetValue<string>() is "ready" or "failed")
                break;
        }
        var final = session?["status"]?.GetValue<string>() ?? "unknown";
        var failures = session?["photos"]?.AsArray().OfType<JsonObject>().Where(p => p["status"]?.GetValue<string>() == "failed").Select(p => $"{p["index"]}:{p["failure"]}").ToList() ?? [];
        Check($"processing {sessionId}", final == "ready", watch.Elapsed,
            $"status {final}, counters {session?["counters"]?.ToJsonString()}, new {session?["newPieceCount"]}, matched {session?["matchedPieceCount"]}{(failures.Count > 0 ? ", failed " + string.Join(" ", failures) : "")}");
        return final == "ready" ? session : null;
    }

    private async Task<int> WaitForCleanupAsync(int expected, CancellationToken ct)
    {
        var watch = Stopwatch.StartNew();
        var cleaned = 0;
        while (watch.Elapsed < CleanupTimeout && expected > 0)
        {
            await Task.Delay(TimeSpan.FromSeconds(6), ct);
            var (status, body) = await CallAsync(HttpMethod.Get, "v1/tenant/item", null, ct);
            if (status != 200) continue;
            var items = body?.AsArray().OfType<JsonObject>().ToList() ?? [];
            cleaned = items.Count(i => i["hasOriginalImage"]?.GetValue<bool>() == true && i["useOriginalImage"]?.GetValue<bool>() == false);
            if (cleaned >= expected) break;
        }
        return cleaned;
    }

    private static async Task<int> CountObjectsAsync(IAmazonS3 s3, string bucket, string tenantId, CancellationToken ct)
    {
        var total = 0;
        foreach (var prefix in new[] { $"tenant/{tenantId}/", $"uploads/tmp/{tenantId}/", $"uploads/import/{tenantId}/" })
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

    private async Task<(int Status, JsonNode? Body)> CallAsync(HttpMethod method, string path, JsonNode? body, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(method, path);
        if (_token is not null)
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _token);
        request.Headers.AcceptLanguage.ParseAdd("tr");
        if (body is not null)
            request.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
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
            output.Line($"{method} {path} → {(int)response.StatusCode} {json?["code"]}");
        return ((int)response.StatusCode, json);
    }
}
