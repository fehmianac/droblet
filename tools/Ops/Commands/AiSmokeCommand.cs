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
/// palette, try-on (1 credit, then the cached repeat is free) → canvas 11 on a second user (2-piece wardrobe: complete
/// outfits with library / catalog picks; face photo only + body type: face-path try-on, image.source face)
/// → DELETE v1/auth/me, and the tenant's S3 objects are checked
/// to be gone. Prints endpoint · job status · duration · failure · notable output; model ids from the worker logs.
/// </summary>
internal sealed partial class AiSmokeCommand(IServiceProvider services, OpsArguments args, OpsOutput output)
{
    public const string DevApiUrl = "https://b8lvaj4r5e.execute-api.eu-central-1.amazonaws.com";
    private static readonly TimeSpan JobTimeout = TimeSpan.FromMinutes(6);

    internal static readonly string[] LibraryPieces =
    [
        "lib-white-tshirt", "lib-white-shirt", "lib-black-turtleneck", "lib-blue-jeans", "lib-black-trousers", "lib-little-black-dress",
        "lib-navy-blazer", "lib-camel-coat", "lib-white-sneakers", "lib-black-ankle-boots", "lib-black-tote", "lib-silk-scarf",
    ];

    private static readonly IReadOnlyDictionary<string, string> WorkerOf = new Dictionary<string, string>
    {
        ["stylist outfit"] = "stylist", ["stylist week"] = "stylist", ["trip pack"] = "stylist",
        ["item processing"] = "item-processor", ["multi-item detection"] = "item-processor", ["piece background removal"] = "item-processor", ["palette"] = "palette", ["try-on"] = "tryon",
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
            var (status, body, elapsed) = await CallAsync(HttpMethod.Post, "v1/auth/register", new JsonObject { ["name"] = "AI Smoke", ["email"] = email, ["password"] = password, ["ageConfirmed"] = true }, ct);
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

            // The all-in-one consent step of onboarding ("Tümünü kabul et"): every purpose, current text version.
            await GrantConsentsAsync(ct);

            // --items-only: just the item flows (single photo + multi-item detection), for prompt iteration.
            if (args.Flag("items-only"))
            {
                await ItemProcessingAsync(fixtures, ct);
                await MultiItemAsync(fixtures, ct);
                return _rows.Any(r => r.Status is "failed" or "timeout" or "error" || r.Failure.Length > 0) ? 1 : 0;
            }

            // --photo-tryon: only the outfit-photo try-on (canvas 16): body photo + one stored outfit photo → 1 image call.
            if (args.Flag("photo-tryon"))
            {
                await PhotoTryOnAsync(fixtures, ct);
                return _rows.Any(r => r.Status is "failed" or "timeout" or "error" || r.Failure.Length > 0) ? 1 : 0;
            }

            // --prereq-only: canvas 11 flows only (thin-wardrobe gap filling + face-path try-on), on this user.
            if (args.Flag("prereq-only"))
            {
                await ThinWardrobeAndFacePathAsync(fixtures, ct);
                return _rows.Any(r => r.Status is "failed" or "timeout" or "error" || r.Failure.Length > 0) ? 1 : 0;
            }

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

            // ── multi-item detection: a 5-piece flat-lay → draft group → select 2 → background removal ─────────
            await MultiItemAsync(fixtures, ct);

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

            // ── canvas 11 on a second, fresh user: 2-piece wardrobe + face photo only ────────────────────────────
            await SecondUserAsync(s3, photoBucket, ct, () => ThinWardrobeAndFacePathAsync(fixtures, ct));
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

    /// <summary>The pieces the synthetic flat-lay holds: every one must be found, the necklace included.</summary>
    private static readonly (string Category, string? Subcategory)[] FlatLayExpected =
        [("top", null), ("bottom", null), ("shoes", null), ("bag", null), ("accessory", "necklace")];

    private async Task MultiItemAsync(SmokeFixtures fixtures, CancellationToken ct)
    {
        var watch = Stopwatch.StartNew();
        var (photo, generated) = await fixtures.GetAsync(SmokeFixtures.FlatLay, ct);
        var (status, body, _) = await CallAsync(HttpMethod.Post, "v1/tenant/item/upload-url", new JsonObject { ["count"] = 1, ["contentType"] = "image/jpeg" }, ct);
        var slot = body?["uploads"]?[0];
        if (status != 200 || slot is null || await PresignedPostAsync(slot, photo, "image/jpeg", ct) is { } uploadError)
        {
            Add("multi-item detection", "failed", watch.Elapsed, "upload_failed");
            return;
        }
        var uploadId = slot["uploadId"]!.GetValue<string>();
        (status, body, var elapsed) = await CallAsync(HttpMethod.Post, "v1/tenant/item-draft",
            new JsonObject { ["requestId"] = Ulid.New(), ["uploadIds"] = new JsonArray(uploadId), ["splitOutfit"] = false, ["manual"] = false }, ct);
        var jobId = body?["jobs"]?[0]?["id"]?.GetValue<string>();
        if (status != 202 || jobId is null)
        {
            Add("multi-item detection", status.ToString(), elapsed, Code(body));
            return;
        }
        if (!await PollStepAsync("multi-item detection", "POST v1/tenant/item-draft (5-piece flat-lay)", jobId, watch.Elapsed, ct, r => $"itemCount {r?["itemCount"]}"))
            return;

        var (_, drafts, _) = await CallAsync(HttpMethod.Get, "v1/tenant/item-draft", null, ct);
        var all = drafts?["drafts"]?.AsArray().OfType<JsonObject>().ToList() ?? [];
        var group = all.FirstOrDefault(d => d["id"]?.GetValue<string>() == uploadId);
        var pieces = all.Where(d => d["groupId"]?.GetValue<string>() == uploadId && d["kind"]?.GetValue<string>() == "piece")
            .OrderBy(d => d["index"]?.GetValue<int>() ?? 0).ToList();
        string Describe(JsonObject p)
        {
            var box = p["box"];
            string F(string k) => (box?[k]?.GetValue<double>() ?? 0).ToString("0.00", System.Globalization.CultureInfo.InvariantCulture);
            return $"#{p["index"]} {p["category"]}/{p["subcategory"]} “{p["name"]}” [{string.Join(",", p["colorIds"]?.AsArray().Select(c => c?.ToString()) ?? [])}] " +
                   $"conf {p["confidence"]}{(p["needsReview"]?.GetValue<bool>() == true ? " (Kontrol et)" : "")} box x{F("x")} y{F("y")} w{F("width")} h{F("height")}";
        }
        foreach (var piece in pieces)
            output.Line($"  detected {Describe(piece)}");

        var missing = FlatLayExpected.Where(e => !pieces.Any(p => p["category"]?.GetValue<string>() == e.Category
                                                                 && (e.Subcategory is null || p["subcategory"]?.GetValue<string>() == e.Subcategory)))
            .Select(e => e.Subcategory ?? e.Category).ToList();
        var singleKind = group?["kind"]?.GetValue<string>();
        _rows[^1] = _rows[^1] with
        {
            Failure = missing.Count == 0 ? "" : "missing:" + string.Join(",", missing),
            Notable = $"group kind {singleKind ?? "-"}, {pieces.Count} piece(s) ({(generated ? "fixture generated now" : "fixture from ops-fixtures/")}): " +
                      string.Join("; ", pieces.Select(Describe)),
        };
        if (pieces.Count < 2)
            return;

        // Keep the necklace (jewellery crop) and the first other piece; the rest is discarded and costs nothing.
        var keep = pieces.Where(p => p["subcategory"]?.GetValue<string>() == "necklace").Take(1)
            .Concat(pieces.Where(p => p["subcategory"]?.GetValue<string>() != "necklace").Take(1)).ToList();
        watch.Restart();
        (status, body, elapsed) = await CallAsync(HttpMethod.Post, $"v1/tenant/item-draft/{uploadId}/select",
            new JsonObject { ["draftIds"] = new JsonArray(keep.Select(p => (JsonNode)p["id"]!.GetValue<string>()).ToArray()) }, ct);
        var cleanJobs = body?["jobs"]?.AsArray().Select(j => j?["id"]?.GetValue<string>()).Where(j => j is not null).ToList() ?? [];
        Add("POST v1/tenant/item-draft/{id}/select", status.ToString(), elapsed, status == 202 ? null : Code(body),
            $"kept {keep.Count} of {pieces.Count}, {cleanJobs.Count} background-removal job(s)");
        foreach (var cleanJob in cleanJobs)
            await PollStepAsync("piece background removal", "itemClean job", cleanJob!, TimeSpan.Zero, ct, _ => "");

        (_, drafts, _) = await CallAsync(HttpMethod.Get, "v1/tenant/item-draft", null, ct);
        var after = drafts?["drafts"]?.AsArray().OfType<JsonObject>().Where(d => d["groupId"]?.GetValue<string>() == uploadId).ToList() ?? [];
        var cleaned = after.Count(d => d["status"]?.GetValue<string>() == "ready" && d["imageUrl"]?.GetValue<string>() is { } image
                                       && d["originalImageUrl"]?.GetValue<string>() is { } original && StripQuery(image) != StripQuery(original));
        Add("draft group after selection", "checked", watch.Elapsed, after.Count == keep.Count && cleaned == keep.Count ? null : "unexpected_group_state",
            $"{after.Count} piece draft(s) left (expected {keep.Count}), {cleaned} with a cleaned image; " +
            $"the group photo {(after.Any(d => d["kind"]?.GetValue<string>() == "outfit") ? "still listed ✗" : "no longer listed ✓")}");
    }

    private async Task TryOnAsync(string outfitJobId, CancellationToken ct)
    {
        var before = await CreditsAsync(ct);
        var target = new JsonObject { ["kind"] = "suggestion", ["id"] = outfitJobId, ["index"] = 0 };
        var (status, body, elapsed) = await CallAsync(HttpMethod.Post, "v1/tenant/tryon", new JsonObject { ["requestId"] = Ulid.New(), ["target"] = target }, ct);
        if (status == 202 && body?["job"]?["id"]?.GetValue<string>() is { } jobId)
        {
            var afterQueue = await CreditsAsync(ct);
            string? bodyImageId = null;
            await PollStepAsync("try-on", "POST v1/tenant/tryon", jobId, elapsed, ct, result =>
            {
                bodyImageId = result?["tryOnImageId"]?.GetValue<string>();
                return $"image {bodyImageId}";
            });
            await SavePhotosAsync("body-path", ct);
            if (bodyImageId is not null) await SaveTryOnAsync(bodyImageId, "tryon-body-path", ct);
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

    /// <summary>Canvas 16: the whole outfit of a photo on the user (target kind "photo" = the upload id of an item photo).</summary>
    private async Task PhotoTryOnAsync(SmokeFixtures fixtures, CancellationToken ct)
    {
        var watch = Stopwatch.StartNew();
        var (bodyData, _) = await fixtures.GetAsync(SmokeFixtures.Body, ct);
        var photo = await UploadProfilePhotoAsync("body", bodyData, ct);
        Add("photo body", photo.Ok ? "200" : "failed", watch.Elapsed, photo.Error, $"{bodyData.Length / 1024} KB synthetic");
        if (!photo.Ok) return;

        var (outfit, generated) = await fixtures.GetAsync(OutfitImportSmokeCommand.Outfits[0], ct);
        var (status, slots, elapsed) = await CallAsync(HttpMethod.Post, "v1/tenant/item/upload-url", new JsonObject { ["count"] = 1, ["contentType"] = "image/jpeg" }, ct);
        var slot = slots?["uploads"]?[0];
        if (status != 200 || slot is null || await PresignedPostAsync(slot, outfit, "image/jpeg", ct) is { } uploadError)
        {
            Add("outfit photo upload", status.ToString(), elapsed, Code(slots), "upload failed");
            return;
        }
        Add("outfit photo upload", "200", elapsed, null, $"{outfit.Length / 1024} KB {(generated ? "generated now" : "from ops-fixtures/")}");

        var before = await CreditsAsync(ct);
        var target = new JsonObject { ["kind"] = "photo", ["id"] = slot["uploadId"]!.GetValue<string>() };
        (status, var body, elapsed) = await CallAsync(HttpMethod.Post, "v1/tenant/tryon", new JsonObject { ["requestId"] = Ulid.New(), ["target"] = target }, ct);
        if (status != 202 || body?["job"]?["id"]?.GetValue<string>() is not { } jobId)
        {
            Add("POST v1/tenant/tryon (photo)", status.ToString(), elapsed, Code(body), body?.ToJsonString());
            return;
        }
        string? imageId = null;
        await PollStepAsync("try-on (outfit photo)", "POST v1/tenant/tryon", jobId, elapsed, ct, result =>
        {
            imageId = result?["tryOnImageId"]?.GetValue<string>();
            return $"image {imageId} {result?["referenceIssue"]}";
        });
        await SavePhotosAsync("photo-tryon", ct);
        if (imageId is not null)
        {
            await SaveTryOnAsync(imageId, "tryon-outfit-photo", ct);
            var (s2, img, _) = await CallAsync(HttpMethod.Get, $"v1/tenant/tryon/{imageId}", null, ct);
            if (s2 == 200 && img?["referenceUrl"]?.GetValue<string>() is { } refUrl)
                await DownloadAsync(refUrl, "tryon-outfit-photo-reference", ct);
        }
        var after = await CreditsAsync(ct);
        if (_rows.LastOrDefault() is { } last)
            _rows[^1] = last with { Notable = $"{last.Notable}; credits {before} → {after}" };
    }

    // ── canvas 11: thin wardrobe gap filling + the face path of try-on ────────────────────────────────────────────────

    internal static readonly string[] ConsentTypes =
        ["bodyPhotoAi", "facePhotoPalette", "weight", "contacts", "marketingNotifications", "crossBorderTransfer", "facePhotoTryOn"];

    private async Task GrantConsentsAsync(CancellationToken ct)
    {
        var consents = new JsonArray(ConsentTypes.Select(t => (JsonNode)new JsonObject { ["type"] = t, ["granted"] = true, ["version"] = ConsentOptions.DefaultVersion }).ToArray());
        await Step("PUT v1/tenant/consents (all 7, onboarding)", HttpMethod.Put, "v1/tenant/consents",
            new JsonObject { ["consents"] = consents, ["source"] = "onboarding", ["locale"] = "tr" }, 200, ct);
    }

    /// <summary>Runs <paramref name="flow"/> as a second throw-away user (premium, all consents), then deletes it and switches back.</summary>
    private async Task SecondUserAsync(IAmazonS3 s3, string bucket, CancellationToken ct, Func<Task> flow)
    {
        var mainToken = _token;
        var email = $"ai-smoke-thin+{DateTime.UtcNow:yyyyMMddHHmmss}@example.com";
        _token = null;
        try
        {
            var (status, body, elapsed) = await CallAsync(HttpMethod.Post, "v1/auth/register",
                new JsonObject { ["name"] = "AI Smoke Thin", ["email"] = email, ["password"] = "Smoke-" + Guid.NewGuid().ToString("N"), ["ageConfirmed"] = true }, ct);
            Add("POST v1/auth/register (second user)", status.ToString(), elapsed, status == 201 ? null : Code(body), email);
            if (status != 201)
                return;
            _token = body!["accessToken"]!.GetValue<string>();
            var tenantId = body["tenantId"]!.GetValue<string>();
            await services.GetRequiredService<IAdminAppUserService>().GrantTestPremiumAsync(OpsHost.Actor, body["userId"]!.GetValue<string>(), 1, "ai-smoke", null, ct);
            await GrantConsentsAsync(ct);
            try
            {
                await flow();
            }
            finally
            {
                if (!args.Flag("keep-user"))
                    await DeleteUserAsync(s3, bucket, tenantId, email, ct);
            }
        }
        finally
        {
            _token = mainToken;
        }
    }

    /// <summary>
    /// Owner decisions 3 + 4 end to end: a 2-piece wardrobe gets complete outfits (picks from the library / catalog in
    /// `missing`, gapFilled), then a face photo + body type (no body photo) renders the first suggestion on the face path.
    /// </summary>
    private async Task ThinWardrobeAndFacePathAsync(SmokeFixtures fixtures, CancellationToken ct)
    {
        await Step("PUT v1/tenant/style-profile (thin)", HttpMethod.Put, "v1/tenant/style-profile",
            new JsonObject { ["segment"] = "women", ["styleTags"] = new JsonArray("minimal", "classic", "quietLuxury"), ["budget"] = "mixed", ["baseVersion"] = 0 }, 200, ct);
        await Step("PUT v1/tenant/body-profile (bodyType pear)", HttpMethod.Put, "v1/tenant/body-profile",
            new JsonObject { ["heightCm"] = 166, ["size"] = "s", ["bodyType"] = "pear", ["baseVersion"] = 0 }, 200, ct);

        string[] pieces = ["lib-white-tshirt", "lib-white-sneakers"];
        var rows = new JsonArray(pieces.Select(id => (JsonNode)new JsonObject { ["clientMutationId"] = Ulid.New(), ["libraryItemId"] = id }).ToArray());
        var (status, body, elapsed) = await CallAsync(HttpMethod.Post, "v1/tenant/item/from-library", new JsonObject { ["items"] = rows }, ct);
        Add("POST v1/tenant/item/from-library (2 pieces)", status.ToString(), elapsed, status is 200 or 201 ? null : Code(body), string.Join(", ", pieces));

        string? problem = null;
        var outfitJob = await JobStepAsync("stylist outfit (thin wardrobe)", "v1/tenant/stylist/outfit",
            new JsonObject { ["requestId"] = Ulid.New(), ["date"] = Day(DateOnly.FromDateTime(DateTime.UtcNow)), ["occasion"] = "office", ["onlyMyWardrobe"] = true }, ct,
            result =>
            {
                var suggestions = result?["suggestions"]?.AsArray() ?? [];
                var missing = suggestions.SelectMany(s => s?["missing"]?.AsArray() ?? []).ToList();
                var library = missing.Count(m => m?["libraryItemId"] is JsonValue);
                var catalog = missing.Count(m => m?["productId"] is JsonValue);
                var complete = suggestions.Count(s => Complete(s));
                if (result?["refusal"] is JsonValue || suggestions.Count == 0 || complete != suggestions.Count || result?["gapFilled"]?.GetValue<bool>() != true)
                    problem = "not_filled";
                var first = suggestions.FirstOrDefault();
                var own = string.Join("+", (first?["slots"]?.AsArray() ?? []).Select(s => s?["itemId"] is null ? "?" : s["slot"]?.ToString()));
                var picks = string.Join("+", (first?["missing"]?.AsArray() ?? []).Select(m => $"{m?["slot"]}:{m?["libraryItemId"] ?? m?["productId"]}"));
                return $"{suggestions.Count} suggestion(s), {complete} complete, gapFilled {result?["gapFilled"]}, refusal {result?["refusal"]?.ToString() ?? "null"}; " +
                       $"picks: {library} library, {catalog} catalog; first: own {own} + {picks}";
            });
        if (problem is not null && _rows.LastOrDefault() is { } row)
            _rows[^1] = row with { Failure = problem };
        if (outfitJob is null)
            return;

        // Face photo only (no body photo) → the face path.
        var watch = Stopwatch.StartNew();
        var (face, _) = await fixtures.GetAsync(SmokeFixtures.Face, ct);
        var photo = await UploadProfilePhotoAsync("face", face, ct);
        Add("photo face only (PUT v1/tenant/photo/face)", photo.Ok ? "200" : "failed", watch.Elapsed, photo.Error, "no body photo");

        var target = new JsonObject { ["kind"] = "suggestion", ["id"] = outfitJob, ["index"] = 0 };
        (status, body, elapsed) = await CallAsync(HttpMethod.Post, "v1/tenant/tryon", new JsonObject { ["requestId"] = Ulid.New(), ["target"] = target }, ct);
        if (status != 202 || body?["job"]?["id"]?.GetValue<string>() is not { } jobId)
        {
            Add("POST v1/tenant/tryon (face path)", status.ToString(), elapsed, Code(body), body?["status"]?.ToString());
            return;
        }
        string? imageId = null;
        if (!await PollStepAsync("try-on (face path, bodyType pear)", "POST v1/tenant/tryon", jobId, elapsed, ct, result =>
            {
                imageId = result?["tryOnImageId"]?.GetValue<string>();
                return $"image {imageId}";
            }) || imageId is null)
            return;

        (status, body, elapsed) = await CallAsync(HttpMethod.Get, $"v1/tenant/tryon/{imageId}", null, ct);
        var source = body?["source"]?.ToString();
        Add("GET v1/tenant/tryon/{id} (face path)", status.ToString(), elapsed, status == 200 && source == "face" ? null : "source_not_face", $"source {source}");
        await SavePhotosAsync("face-path", ct);
        await SaveTryOnAsync(imageId, "tryon-face-path", ct);
    }

    // ── keep the generated images (and the synthetic inputs) in the run's artifact for a visual check ─────────────
    private async Task SaveTryOnAsync(string imageId, string name, CancellationToken ct)
    {
        var (status, body, _) = await CallAsync(HttpMethod.Get, $"v1/tenant/tryon/{imageId}", null, ct);
        if (status == 200 && body?["url"]?.GetValue<string>() is { } url)
            await DownloadAsync(url, name, ct);
    }

    private async Task SavePhotosAsync(string prefix, CancellationToken ct)
    {
        var (status, body, _) = await CallAsync(HttpMethod.Get, "v1/tenant/photo", null, ct);
        if (status != 200 || body is null) return;
        foreach (var kind in new[] { "body", "face" })
        {
            var node = body[kind];
            var photo = node is JsonArray arr ? arr.FirstOrDefault() : node;
            if (photo?["url"]?.GetValue<string>() is { } url)
                await DownloadAsync(url, $"{prefix}-input-{kind}", ct);
        }
    }

    private async Task DownloadAsync(string url, string name, CancellationToken ct)
    {
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(60) };
            using var response = await http.GetAsync(url, ct);
            if (!response.IsSuccessStatusCode) { output.Line($"save {name}: HTTP {(int)response.StatusCode}"); return; }
            var ext = (response.Content.Headers.ContentType?.MediaType ?? "") switch
            {
                "image/png" => ".png",
                "image/jpeg" => ".jpg",
                _ => ".webp",
            };
            Directory.CreateDirectory(Path.Combine(output.Directory, "images"));
            var path = Path.Combine(output.Directory, "images", name + ext);
            await File.WriteAllBytesAsync(path, await response.Content.ReadAsByteArrayAsync(ct), ct);
            output.Line($"saved {name}{ext}");
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or IOException)
        {
            output.Line($"save {name}: {ex.GetType().Name}");
        }
    }

    /// <summary>A base (top + bottom, or a dress) and shoes, counting own slots and picked pieces.</summary>
    private static bool Complete(JsonNode? suggestion)
    {
        var slots = (suggestion?["slots"]?.AsArray() ?? []).Select(s => s?["slot"]?.ToString())
            .Concat((suggestion?["missing"]?.AsArray() ?? []).Select(m => m?["slot"]?.ToString())).ToList();
        var dress = (suggestion?["missing"]?.AsArray() ?? []).Any(m => m?["category"]?.ToString() == "dress");
        return slots.Contains("top") && (dress || slots.Contains("bottom")) && slots.Contains("shoes");
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

    [GeneratedRegex(@"OpenAI (?<op>[a-z_]+) (?<outcome>ok|failed)", RegexOptions.ExplicitCapture)]
    private static partial Regex OpenAiLine();

    [GeneratedRegex(@"model (?<model>[A-Za-z0-9._:\-]+)", RegexOptions.ExplicitCapture)]
    private static partial Regex ModelId();

    private static string Describe(string message)
    {
        var line = OpenAiLine().Match(message);
        if (!line.Success)
            return "";
        var model = ModelId().Match(message[line.Index..]);
        return $"{line.Groups["op"].Value} {line.Groups["outcome"].Value}{(model.Success ? " " + model.Groups["model"].Value : "")}";
    }

    private async Task AttachModelsAsync(DateTime started, CancellationToken ct)
    {
        // CloudWatch Logs ingestion lags a few seconds behind the last job.
        await Task.Delay(TimeSpan.FromSeconds(20), ct);
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
                .Select(e => Describe(e.Message)).Where(d => d.Length > 0)
                .GroupBy(d => d)
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
    internal static async Task<string?> PresignedPostAsync(JsonNode slot, byte[] data, string contentType, CancellationToken ct)
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

    internal static string Day(DateOnly day) => day.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
    internal static string Code(JsonNode? body) => body?["code"]?.ToString() ?? body?["title"]?.ToString() ?? body?["raw"]?.ToString() ?? "";
    private static string StripQuery(string url) => url.Split('?')[0];
    private static string Truncate(string text, int max) => text.Length > max ? text[..max] + "…" : text;
}
