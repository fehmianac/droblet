using System.Net;
using Domain.Entity;
using Domain.Enum;
using Domain.Events;
using Domain.Extensions;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Domain.Services.Ai;
using Infrastructure.Telemetry;
using Infrastructure.Workers;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace ItemProcessor.Services;

public interface IOutfitImportJobService
{
    Task ProcessAsync(OutfitImportPhotoRequestedEvent message, bool isLastAttempt, CancellationToken ct);
}

/// <summary>
/// One photo of an outfit import session, in stages (the photo row is the state, every write versioned, so a duplicate
/// delivery never runs a stage twice):
///  A. detect — the multi-item detection (one vision call, Ai:FastTextModel when configured), each piece cropped;
///  B. match — per piece an attribute shortlist (category, sub-type, colours) of wardrobe items, then one vision call that
///     compares the crop with up to K thumbnails → the item, or new;
///  C. de-duplicate — the shortlist also holds the session's new pieces from earlier photos, so the same new piece seen in
///     several photos becomes one session piece. B + C run one photo at a time per session (match lease);
///  D. look draft — one piece per slot, the photo is the cover.
/// Fairness: at most OutfitImport:MaxInFlightPerTenant photos of a tenant are processed at once (DynamoDB lease row); a
/// photo over the cap, or waiting for its session's match step, goes back on the queue with a delay. An OpenAI rate limit
/// (429) backs off exponentially; a billing 429 fails the photo at once, and a failed photo gives its recognition back.
/// Never writes an item or a look: those are created by the user's commit only.
/// </summary>
public sealed class OutfitImportJobService(
    IRepository repository,
    IObjectStorage storage,
    IEventManager events,
    IFastItemDetector detector,
    IItemMatcher matcher,
    IImageCropper cropper,
    IItemRecognitionQuotaService itemRecognition,
    INotificationInbox inbox,
    IOptionsMonitor<AiOptions> aiOptions,
    IOptionsMonitor<WardrobeOptions> wardrobeOptions,
    IOptionsMonitor<OutfitImportOptions> importOptions,
    TimeProvider timeProvider,
    ILogger<OutfitImportJobService> logger) : IOutfitImportJobService
{
    private const long MaxImageBytes = 15 * 1024 * 1024;

    private DateTime Now => timeProvider.GetUtcNow().UtcDateTime;
    private OutfitImportOptions Options => importOptions.CurrentValue;

    public async Task ProcessAsync(OutfitImportPhotoRequestedEvent message, bool isLastAttempt, CancellationToken ct)
    {
        var tenantId = message.TenantId;
        var holder = $"{message.JobId}#{message.Index}";
        if (AiTelemetry.Current is { } timings)
        {
            timings.JobId = holder;
            timings.JobKind = JobKind.OutfitImport.ToString();
        }

        var session = await repository.GetAsync<OutfitImportSessionEntity>(OutfitImportSessionEntity.GetPk(tenantId), OutfitImportSessionEntity.GetSk(message.JobId), ct);
        var photo = await PhotoAsync(tenantId, message.JobId, message.Index, ct);
        // Discarded / committed session, or a stage already done: nothing to do (idempotent by session + photo index).
        if (session is not { Status: OutfitImportStatus.Open } || photo is not { Status: OutfitImportPhotoStatus.Uploaded or OutfitImportPhotoStatus.Detected })
        {
            logger.LogInformation("Outfit import photo {Holder} skipped (session {State}, photo {Status})", holder, session?.Status.ToString() ?? "gone", photo?.Status.ToString() ?? "gone");
            return;
        }

        if (!await TryLeaseAsync(tenantId, OutfitImportLeaseEntity.InFlight, holder, Options.MaxInFlightPerTenant, ct))
        {
            AiTelemetry.Add("busy_tenant", 1);
            await RequeueAsync(message, TimeSpan.FromSeconds(Options.BusyDelaySeconds + Random.Shared.Next(0, 5)), ct);
            return;
        }

        try
        {
            if (photo.Status == OutfitImportPhotoStatus.Uploaded)
            {
                var uploaded = photo;
                if (await AiTelemetry.TimeAsync("stage_detect", () => DetectAsync(session, uploaded, ct)) is not { Status: OutfitImportPhotoStatus.Detected } detected)
                    return;
                photo = detected;
            }

            if (!await TryLeaseAsync(tenantId, OutfitImportLeaseEntity.MatchLock(session.Id), holder, 1, ct))
            {
                AiTelemetry.Add("busy_session", 1);
                await RequeueAsync(message, TimeSpan.FromSeconds(Math.Max(2, Options.BusyDelaySeconds / 2) + Random.Shared.Next(0, 3)), ct);
                return;
            }
            try
            {
                await AiTelemetry.TimeAsync("stage_match", () => MatchAsync(session, photo, ct));
            }
            finally
            {
                await ReleaseLeaseAsync(tenantId, OutfitImportLeaseEntity.MatchLock(session.Id), holder, ct);
            }
        }
        catch (HttpRequestException ex) when (ex.StatusCode == HttpStatusCode.TooManyRequests)
        {
            // Rate limit (a billing 429 is an AiProviderException and fails below): back off, do not burn SQS attempts.
            var current = await PhotoAsync(tenantId, message.JobId, message.Index, ct) ?? photo;
            if (current.Backoffs >= Options.MaxBackoffs)
            {
                await FailAsync(session, current, JobFailure.ProviderError, ct);
                return;
            }
            var delay = OutfitImportRules.Backoff(current.Backoffs, Options.BackoffBaseSeconds, Options.MaxBackoffSeconds);
            current.Backoffs++;
            current.UpdatedAt = Now;
            await repository.SaveIfVersionAsync(current, current.Version, ct);
            AiTelemetry.Add("backoff_429", delay.TotalMilliseconds);
            logger.LogWarning("Outfit import photo {Holder}: OpenAI rate limit, retry in {Delay}s (back-off {Count})", holder, (int)delay.TotalSeconds, current.Backoffs);
            await RequeueAsync(message, delay, ct);
        }
        catch (Exception ex) when (!WorkerFailure.IsRetryable(ex, isLastAttempt))
        {
            logger.LogWarning(ex, "Outfit import photo {Holder} failed for tenant {TenantId}", holder, tenantId);
            var current = await PhotoAsync(tenantId, message.JobId, message.Index, ct) ?? photo;
            await FailAsync(session, current, JobFailure.ProviderError, ct);
        }
        finally
        {
            await ReleaseLeaseAsync(tenantId, OutfitImportLeaseEntity.InFlight, holder, ct);
        }
    }

    // ── A. detect ─────────────────────────────────────────────────────────────────────────────────────────────────

    private async Task<OutfitImportPhotoEntity?> DetectAsync(OutfitImportSessionEntity session, OutfitImportPhotoEntity photo, CancellationToken ct)
    {
        var tenantId = session.TenantId;
        var raw = StorageKeys.BelongsToTenant(photo.UploadKey, tenantId) ? await storage.ReadAsync(photo.UploadKey, MaxImageBytes, ct) : null;
        var clean = raw is null ? null : ImageMetadataStripper.Strip(raw);
        if (clean is null)
        {
            await FailAsync(session, photo, JobFailure.SourceDeleted, ct);
            return null;
        }

        var photoKey = StorageKeys.ImportPhoto(tenantId, session.Id, photo.Index, clean.Extension);
        await storage.PutAsync(photoKey, clean.Data, clean.ContentType, ct);
        var image = new ImageInput(clean.Data, clean.ContentType);
        var language = Localized.Language(session.Language);
        var found = ItemDetectionGuard.Filter(
            await detector.DetectItemsAsync(image, language, Options.UseFastTextModel, ct),
            Math.Min(wardrobeOptions.CurrentValue.MaxDetectedItems, OutfitImportRules.MaxPiecesPerPhoto));

        var size = cropper.Measure(image);
        var threshold = aiOptions.CurrentValue.VisionConfidenceThreshold;
        var pieces = new List<OutfitImportOccurrence>();
        using (AiTelemetry.Measure("crop"))
        {
            foreach (var item in found)
            {
                var fields = ItemDetectionGuard.Fields(item, threshold);
                if (fields.Category is not { } category || size is not { } pixels)
                    continue;
                var subcategory = ItemDetectionGuard.Subcategory(item, category);
                var crop = cropper.Crop(image, CropMath.Plan(item.Box, pixels, CropMath.IsSmall(item.Box, subcategory)));
                if (crop is null)
                    continue;
                var number = pieces.Count + 1;
                var cropKey = StorageKeys.ImportCrop(tenantId, session.Id, photo.Index, number);
                await storage.PutAsync(cropKey, crop.Data, crop.ContentType, ct);
                pieces.Add(new OutfitImportOccurrence
                {
                    Ref = $"{photo.Index}-{number}",
                    Name = fields.Name,
                    Category = category,
                    Subcategory = subcategory,
                    ColorIds = fields.ColorIds.ToList(),
                    Fabric = fields.Fabric,
                    Seasons = fields.Seasons.ToList(),
                    Box = item.Box,
                    Confidence = Math.Round(Math.Clamp(item.Confidence, 0, 1), 2),
                    CropKey = cropKey,
                });
            }
        }

        photo.PhotoKey = photoKey;
        photo.PhotoWidth = size?.Width;
        photo.PhotoHeight = size?.Height;
        if (pieces.Count == 0)
        {
            await FailAsync(session, photo, JobFailure.GuardRejected, ct);
            return null;
        }

        photo.Pieces = pieces;
        photo.Status = OutfitImportPhotoStatus.Detected;
        photo.UpdatedAt = Now;
        if (!await repository.SaveIfVersionAsync(photo, photo.Version, ct))
            return await PhotoAsync(tenantId, session.Id, photo.Index, ct); // another delivery got there first
        // The detection is the photo's AI recognition (a non-member's allowance: one per photo, like bulk add).
        await itemRecognition.CommitAsync(tenantId, OutfitImportPhotoEntity.RecognitionKey(session.Id, photo.Index), ct);
        await CountAsync(session, new Dictionary<string, long> { [OutfitImportSessionEntity.CounterDetected] = 1 }, ct);
        return photo;
    }

    // ── B + C. match against the wardrobe and the session's new pieces; D. look draft ─────────────────────────────

    private async Task MatchAsync(OutfitImportSessionEntity session, OutfitImportPhotoEntity detected, CancellationToken ct)
    {
        var tenantId = session.TenantId;
        // Re-read under the session's match lease: the stage may have been finished by another delivery meanwhile.
        var photo = await PhotoAsync(tenantId, session.Id, detected.Index, ct);
        if (photo is not { Status: OutfitImportPhotoStatus.Detected })
            return;

        var wardrobe = (await repository.GetAllAsync<ItemEntity>(ItemEntity.GetPk(tenantId), ct)).ToDictionary(i => i.Id, StringComparer.Ordinal);
        var sessionPieces = (await repository.GetAllAsync<OutfitImportPieceEntity>(OutfitImportPieceEntity.GetPk(tenantId), OutfitImportPieceEntity.SessionPrefix(session.Id), SkOperator.BeginsWith, ct))
            .ToDictionary(p => p.Id, StringComparer.Ordinal);
        var candidates = wardrobe.Values
            .Select(i => (Item: i, Key: OwnImageKey(i, tenantId)))
            .Where(x => x.Key is not null)
            .Select(x => new MatchCandidate(x.Item.Id, false, x.Item.Category, x.Item.Subcategory, x.Item.ColorIds, x.Key!, x.Item.CreatedAt))
            .Concat(sessionPieces.Values.Where(p => !p.SeenIn.Contains(photo.Index))
                .Select(p => new MatchCandidate(p.Id, true, p.Category, p.Subcategory, p.ColorIds, p.CropKey, p.CreatedAt)))
            .ToList();

        var thumbnails = new Dictionary<string, ImageInput?>(StringComparer.Ordinal);
        var options = Options;
        var matchCalls = 0;
        foreach (var piece in photo.Pieces)
        {
            piece.MatchItemId = null;
            piece.MatchConfidence = null;
            piece.PieceId = null;
            var shortlist = OutfitImportRules.Shortlist(piece.Category, piece.Subcategory, piece.ColorIds, candidates, options.MatchCandidates);
            MatchCandidate? chosen = null;
            if (shortlist.Count > 0 && piece.CropKey is { } cropKey && await ThumbnailAsync(cropKey, thumbnails, tenantId, ct) is { } crop)
            {
                var images = new List<ImageInput>();
                var shown = new List<MatchCandidate>();
                foreach (var candidate in shortlist)
                {
                    if (await ThumbnailAsync(candidate.ImageKey, thumbnails, tenantId, ct) is { } thumb)
                    {
                        images.Add(thumb);
                        shown.Add(candidate);
                    }
                }
                if (images.Count > 0)
                {
                    matchCalls++;
                    var hint = piece.Subcategory?.Replace('-', ' ') ?? piece.Category.ToString().ToLowerInvariant();
                    var answer = await matcher.MatchAsync(crop, images, hint, options.UseFastTextModel, ct);
                    if (answer.Index is { } index && index < shown.Count && answer.Confidence >= options.MatchConfidenceThreshold)
                    {
                        chosen = shown[index];
                        piece.MatchConfidence = Math.Round(answer.Confidence, 2);
                    }
                }
            }

            if (chosen is { IsSessionPiece: false })
            {
                piece.MatchItemId = chosen.Id;
            }
            else if (chosen is { IsSessionPiece: true } && sessionPieces.TryGetValue(chosen.Id, out var same))
            {
                // C: the same new piece as an earlier photo of the session — one piece, seen twice.
                piece.PieceId = same.Id;
                if (!same.SeenIn.Contains(photo.Index))
                    same.SeenIn.Add(photo.Index);
                await repository.SaveAsync(same, ct);
            }
            else
            {
                var created = new OutfitImportPieceEntity
                {
                    Id = Ulid.Deterministic(session.CreatedAt, $"{session.Id}:{piece.Ref}"),
                    TenantId = tenantId,
                    SessionId = session.Id,
                    FirstRef = piece.Ref,
                    Name = piece.Name,
                    Category = piece.Category,
                    Subcategory = piece.Subcategory,
                    ColorIds = piece.ColorIds.ToList(),
                    Fabric = piece.Fabric,
                    Seasons = piece.Seasons.ToList(),
                    CropKey = piece.CropKey!,
                    SeenIn = [photo.Index],
                    CreatedAt = Now,
                };
                await repository.SaveAsync(created, ct);
                sessionPieces[created.Id] = created;
                piece.PieceId = created.Id;
            }
        }

        // D. one piece per slot (the matched item's own category decides its slot).
        OutfitImportRules.AssignSlots(photo.Pieces, o => o.MatchItemId is { } id && wardrobe.TryGetValue(id, out var item) ? item.Category : o.Category);
        photo.Status = OutfitImportPhotoStatus.Ready;
        photo.Failure = null;
        photo.Timings = AiTelemetry.Current?.Snapshot();
        photo.AiCost = AiTelemetry.Current?.CostSnapshot();
        photo.UpdatedAt = Now;
        AiTelemetry.Add("match_calls", matchCalls);
        if (!await repository.SaveIfVersionAsync(photo, photo.Version, ct))
            return;
        await CountAsync(session, new Dictionary<string, long>
        {
            [OutfitImportSessionEntity.CounterMatched] = 1,
            [OutfitImportSessionEntity.CounterReady] = 1,
        }, ct);
    }

    /// <summary>The wardrobe item's own image (cleaned, else its original); library / shop pieces have none of their own.</summary>
    private static string? OwnImageKey(ItemEntity item, string tenantId)
    {
        var key = item.ImageKey ?? item.OriginalImageKey;
        return key is not null && StorageKeys.BelongsToTenant(key, tenantId) ? key : null;
    }

    /// <summary>A small JPEG of the image (long side OutfitImport:ThumbnailEdge) for the match call; cached per run.</summary>
    private async Task<ImageInput?> ThumbnailAsync(string key, Dictionary<string, ImageInput?> cache, string tenantId, CancellationToken ct)
    {
        if (cache.TryGetValue(key, out var cached))
            return cached;
        ImageInput? thumb = null;
        if (StorageKeys.BelongsToTenant(key, tenantId) && await storage.ReadAsync(key, MaxImageBytes, ct) is { } data)
        {
            var image = new ImageInput(data, key.EndsWith(".webp", StringComparison.Ordinal) ? "image/webp" : key.EndsWith(".png", StringComparison.Ordinal) ? "image/png" : "image/jpeg");
            var edge = Math.Max(128, Options.ThumbnailEdge);
            thumb = cropper.Measure(image) is { } size
                ? cropper.Crop(image, Fit(size, edge)) ?? image
                : null;
        }
        cache[key] = thumb;
        return thumb;
    }

    private static CropPlan Fit(PixelSize size, int edge)
    {
        var scale = Math.Min(1, (double)edge / Math.Max(size.Width, size.Height));
        return new CropPlan(0, 0, size.Width, size.Height, Math.Max(1, (int)Math.Round(size.Width * scale)), Math.Max(1, (int)Math.Round(size.Height * scale)));
    }

    // ── Outcome ───────────────────────────────────────────────────────────────────────────────────────────────────

    private async Task FailAsync(OutfitImportSessionEntity session, OutfitImportPhotoEntity photo, JobFailure failure, CancellationToken ct)
    {
        if (photo.Status is OutfitImportPhotoStatus.Ready or OutfitImportPhotoStatus.Failed)
            return;
        photo.Status = OutfitImportPhotoStatus.Failed;
        photo.Failure = failure;
        photo.Timings = AiTelemetry.Current?.Snapshot();
        photo.AiCost = AiTelemetry.Current?.CostSnapshot();
        photo.UpdatedAt = Now;
        if (!await repository.SaveIfVersionAsync(photo, photo.Version, ct))
            return;
        // A photo that gave nothing never costs a recognition (released whatever the stage; a no-op once committed).
        await itemRecognition.ReleaseAsync(session.TenantId, OutfitImportPhotoEntity.RecognitionKey(session.Id, photo.Index), ct);
        await CountAsync(session, new Dictionary<string, long> { [OutfitImportSessionEntity.CounterFailed] = 1 }, ct);
        logger.LogWarning("Outfit import photo {SessionId}#{Index} of tenant {TenantId} failed: {Failure}", session.Id, photo.Index, session.TenantId, failure);
    }

    /// <summary>Atomic counter update; the photo that finishes the session writes the "ready for review" inbox row (once).</summary>
    private async Task CountAsync(OutfitImportSessionEntity session, IReadOnlyDictionary<string, long> increments, CancellationToken ct)
    {
        var counters = await repository.AddCountersAsync(session.Pk, session.Sk, increments, ct);
        if (counters is null)
            return; // discarded meanwhile
        long Get(string name) => counters.TryGetValue(name, out var value) ? value : 0;
        var ready = Get(OutfitImportSessionEntity.CounterReady);
        var finished = ready + Get(OutfitImportSessionEntity.CounterFailed);
        var finishing = increments.ContainsKey(OutfitImportSessionEntity.CounterReady) || increments.ContainsKey(OutfitImportSessionEntity.CounterFailed);
        if (!finishing || finished != session.Count || ready == 0)
            return;
        await inbox.AddAsync(session.TenantId, NotificationType.OutfitImportReady, session.Id, new Dictionary<string, string>
        {
            ["sessionId"] = session.Id,
            ["lookCount"] = ready.ToString(System.Globalization.CultureInfo.InvariantCulture),
        }, Now, ct);
        logger.LogInformation("Outfit import {SessionId} of tenant {TenantId} ready for review ({Ready}/{Count})", session.Id, session.TenantId, ready, session.Count);
    }

    private async Task RequeueAsync(OutfitImportPhotoRequestedEvent message, TimeSpan delay, CancellationToken ct) =>
        await events.PublishAsync(message with { Attempt = message.Attempt + 1 }, delay, ct);

    private Task<OutfitImportPhotoEntity?> PhotoAsync(string tenantId, string sessionId, int index, CancellationToken ct) =>
        repository.GetAsync<OutfitImportPhotoEntity>(OutfitImportPhotoEntity.GetPk(tenantId), OutfitImportPhotoEntity.GetSk(sessionId, index), ct);

    // ── Leases (fairness cap, session match order) ────────────────────────────────────────────────────────────────

    private async Task<bool> TryLeaseAsync(string tenantId, string name, string holder, int cap, CancellationToken ct)
    {
        for (var attempt = 0; attempt < 6; attempt++)
        {
            var now = Now;
            var lease = await repository.GetAsync<OutfitImportLeaseEntity>(OutfitImportLeaseEntity.GetPk(tenantId), name, ct)
                        ?? new OutfitImportLeaseEntity { TenantId = tenantId, Name = name };
            var live = OutfitImportRules.Live(lease.Leases, now, except: holder);
            if (live.Count >= Math.Max(1, cap))
                return false;
            live.Add(new OutfitImportLease { Holder = holder, Until = now.AddSeconds(Math.Max(30, Options.LeaseSeconds)) });
            lease.Leases = live;
            lease.UpdatedAt = now;
            if (await repository.SaveIfVersionAsync(lease, lease.Version, ct))
                return true;
        }
        return false;
    }

    private async Task ReleaseLeaseAsync(string tenantId, string name, string holder, CancellationToken ct)
    {
        for (var attempt = 0; attempt < 6; attempt++)
        {
            var lease = await repository.GetAsync<OutfitImportLeaseEntity>(OutfitImportLeaseEntity.GetPk(tenantId), name, ct);
            if (lease is null || lease.Leases.All(l => l.Holder != holder))
                return;
            lease.Leases = OutfitImportRules.Live(lease.Leases, Now, except: holder);
            lease.UpdatedAt = Now;
            if (await repository.SaveIfVersionAsync(lease, lease.Version, ct))
                return;
        }
    }
}
