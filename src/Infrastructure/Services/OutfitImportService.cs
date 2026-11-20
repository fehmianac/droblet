using System.Text.Json;
using System.Text.Json.Serialization;
using Domain.Constant;
using Domain.Domain;
using Domain.Entity;
using Domain.Enum;
using Domain.Events;
using Domain.Extensions;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Infrastructure.Services;

/// <summary>
/// "Kombinlerini içe aktar" on the Api side: the session with one presigned POST per photo, the upload confirmations that
/// queue each photo (outfit-import queue, worker OutfitImportJobService), the review read, the commit and the discard.
/// Nothing becomes an item or a look before the commit, and only the new pieces the user kept get the (image-model)
/// background removal. A non-member's photos use the AI recognition allowance like bulk add (one per photo, reserved here,
/// counted when the photo's detection completes, given back when it fails or the session is discarded).
/// Image keys and URLs are never logged.
/// </summary>
public sealed class OutfitImportService(
    IRepository repository,
    IObjectStorage storage,
    IEventManager events,
    IEntitlementService entitlements,
    IItemRecognitionQuotaService itemRecognition,
    IWardrobeService wardrobe,
    IOptionsMonitor<PhotoOptions> photoOptions,
    IOptionsMonitor<OutfitImportOptions> importOptions,
    TimeProvider timeProvider,
    ILogger<OutfitImportService> logger,
    IAiUsageGuard aiLimits,
    IItemImageUrls imageUrls) : IOutfitImportService
{
    private static readonly JsonSerializerOptions ResultJson = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) } };

    private DateTime Now => timeProvider.GetUtcNow().UtcDateTime;

    // ── Session ───────────────────────────────────────────────────────────────────────────────────────────────────

    public async Task<ServiceResult<OutfitImportCreatedDto>> CreateAsync(string tenantId, CreateOutfitImportCommand command, string? requestLanguage, CancellationToken ct)
    {
        var snapshot = await entitlements.GetAsync(tenantId, ct);
        var maxPhotos = snapshot.OutfitImportMaxPhotos ?? EntitlementOptions.DefaultOutfitImportMaxPhotos;
        if (command.Count < 1 || command.Count > maxPhotos)
            return ServiceResult.Invalid<OutfitImportCreatedDto>(ErrorCodes.OutfitImportTooManyPhotos);
        var decision = EntitlementPolicy.Check(snapshot.Active.Tier, Capability.ItemProcessing, snapshot.Credits);
        if (!decision.Allowed)
            return ServiceResult.Forbidden<OutfitImportCreatedDto>(decision.Reason ?? ErrorCodes.PremiumRequired);

        // Replay of the same request (or "fresh upload slots" after the presigned forms expired): the same session.
        if (await GetSessionAsync(tenantId, command.RequestId, ct) is { } existing)
            return ServiceResult.Ok(await CreatedAsync(existing, maxPhotos, ct));

        var keys = Enumerable.Range(1, command.Count).Select(i => OutfitImportPhotoEntity.RecognitionKey(command.RequestId, i)).ToList();
        if (!await aiLimits.AllowAsync(tenantId, AiCap.ItemRecognition, command.Count, ct))
            return ServiceResult.TooManyRequests<OutfitImportCreatedDto>(ErrorCodes.AiLimitReached);
        var grant = await itemRecognition.ReserveAsync(tenantId, keys, ct);
        if (grant.Granted == 0)
        {
            return grant.DenyReason == ErrorCodes.PremiumRequired
                ? ServiceResult.Forbidden<OutfitImportCreatedDto>(ErrorCodes.PremiumRequired)
                : ServiceResult.PaymentRequired<OutfitImportCreatedDto>(ErrorCodes.ItemRecognitionLimitReached);
        }

        var now = Now;
        var count = Math.Min(grant.Granted, command.Count);
        var session = new OutfitImportSessionEntity
        {
            Id = command.RequestId,
            TenantId = tenantId,
            Status = OutfitImportStatus.Open,
            Count = count,
            Requested = command.Count,
            Language = await LanguageAsync(tenantId, requestLanguage, ct),
            CreatedAt = now,
            UpdatedAt = now,
        };
        if (!(await repository.TransactWriteAsync([TransactWriteOperation.Create(session)], ct)).Applied)
        {
            // A concurrent replay created it first.
            var winner = await GetSessionAsync(tenantId, command.RequestId, ct);
            return winner is null ? ServiceResult.NotFound<OutfitImportCreatedDto>(ErrorCodes.OutfitImportNotFound) : ServiceResult.Ok(await CreatedAsync(winner, maxPhotos, ct));
        }

        var photos = Enumerable.Range(1, count).Select(index => new OutfitImportPhotoEntity
        {
            TenantId = tenantId,
            SessionId = session.Id,
            Index = index,
            Status = OutfitImportPhotoStatus.Pending,
            UploadKey = StorageKeys.ImportUpload(tenantId, session.Id, index),
            LookId = Ulid.Deterministic(now, $"{session.Id}:look:{index}"),
            CreatedAt = now,
            UpdatedAt = now,
            Version = 1,
        }).ToList();
        await repository.BatchWriteAsync(photos.Cast<Domain.Entity.Base.IEntity>().ToList(), ct);

        logger.LogInformation("Outfit import {SessionId} for tenant {TenantId}: {Count} photo slot(s) ({Skipped} skipped: recognition allowance)",
            session.Id, tenantId, count, command.Count - count);
        return ServiceResult.Created(await CreatedAsync(session, maxPhotos, ct, photos));
    }

    private async Task<OutfitImportCreatedDto> CreatedAsync(OutfitImportSessionEntity session, int maxPhotos, CancellationToken ct, IReadOnlyList<OutfitImportPhotoEntity>? photos = null)
    {
        photos ??= await PhotosAsync(session.TenantId, session.Id, ct);
        var uploads = new List<OutfitImportUploadDto>();
        if (session.Status == OutfitImportStatus.Open)
        {
            var maxBytes = photoOptions.CurrentValue.MaxUploadBytes;
            var ttl = TimeSpan.FromSeconds(Math.Max(60, importOptions.CurrentValue.UploadUrlTtlSeconds));
            foreach (var photo in photos.Where(p => p.Status == OutfitImportPhotoStatus.Pending))
            {
                var upload = await storage.CreateUploadAsync(photo.UploadKey, "image/jpeg", maxBytes, ttl, ct);
                uploads.Add(new OutfitImportUploadDto(photo.Index, upload.Url, upload.Fields, upload.ExpiresAt, maxBytes));
            }
        }
        var dto = await ToDtoAsync(session, photos, ct);
        return new OutfitImportCreatedDto(dto, uploads, Math.Max(0, session.Requested - session.Count), maxPhotos,
            (await itemRecognition.GetAsync(session.TenantId, ct)).ToDto());
    }

    public async Task<IReadOnlyList<OutfitImportDto>> GetOpenAsync(string tenantId, CancellationToken ct)
    {
        var nowSeconds = Now.ToUnixTimeSeconds();
        var sessions = (await repository.GetAllAsync<OutfitImportSessionEntity>(OutfitImportSessionEntity.GetPk(tenantId), ct))
            .Where(s => s.Status == OutfitImportStatus.Open && s.Ttl > nowSeconds)
            .OrderByDescending(s => s.CreatedAt)
            .ToList();
        var result = new List<OutfitImportDto>(sessions.Count);
        foreach (var session in sessions)
            result.Add(await ToDtoAsync(session, await PhotosAsync(tenantId, session.Id, ct), ct));
        return result;
    }

    public async Task<OutfitImportDto?> GetAsync(string tenantId, string sessionId, CancellationToken ct)
    {
        var session = await GetSessionAsync(tenantId, sessionId, ct);
        return session is null ? null : await ToDtoAsync(session, await PhotosAsync(tenantId, sessionId, ct), ct);
    }

    // ── Upload confirmation ───────────────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// The app uploaded photo <paramref name="index"/>: the object must exist; the photo is queued once (versioned write —
    /// a repeated confirm or a concurrent one answers the session without queueing again).
    /// </summary>
    public async Task<ServiceResult<OutfitImportDto>> MarkUploadedAsync(string tenantId, string sessionId, int index, CancellationToken ct)
    {
        var session = await GetSessionAsync(tenantId, sessionId, ct);
        if (session is null)
            return ServiceResult.NotFound<OutfitImportDto>(ErrorCodes.OutfitImportNotFound);
        if (session.Status == OutfitImportStatus.Committed)
            return ServiceResult.Conflict<OutfitImportDto>(null, ErrorCodes.OutfitImportCommitted);

        var photo = await repository.GetAsync<OutfitImportPhotoEntity>(OutfitImportPhotoEntity.GetPk(tenantId), OutfitImportPhotoEntity.GetSk(sessionId, index), ct);
        if (photo is null)
            return ServiceResult.NotFound<OutfitImportDto>(ErrorCodes.OutfitImportPhotoNotFound);

        if (photo.Status == OutfitImportPhotoStatus.Pending)
        {
            if (!StorageKeys.BelongsToTenant(photo.UploadKey, tenantId) || await storage.HeadAsync(photo.UploadKey, ct) is null)
                return ServiceResult.Invalid<OutfitImportDto>(ErrorCodes.UploadMissing);
            photo.Status = OutfitImportPhotoStatus.Uploaded;
            photo.UpdatedAt = Now;
            if (await repository.SaveIfVersionAsync(photo, photo.Version, ct))
            {
                await repository.AddCountersAsync(session.Pk, session.Sk, new Dictionary<string, long> { [OutfitImportSessionEntity.CounterUploaded] = 1 }, ct);
                await events.PublishAsync(new OutfitImportPhotoRequestedEvent(tenantId, sessionId, index), ct);
            }
        }

        session = await GetSessionAsync(tenantId, sessionId, ct) ?? session;
        return ServiceResult.Ok(await ToDtoAsync(session, await PhotosAsync(tenantId, sessionId, ct), ct));
    }

    // ── Commit ────────────────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Creates the kept new pieces as wardrobe items (WardrobeService: receipt per piece, so a replay never creates twice),
    /// queues one background removal per created item, then one look per kept photo (deterministic id, cover = the photo).
    /// A replay of a committed session answers the stored result.
    /// </summary>
    public async Task<ServiceResult<OutfitImportCommitResultDto>> CommitAsync(string tenantId, string sessionId, CommitOutfitImportCommand command, CancellationToken ct)
    {
        var session = await GetSessionAsync(tenantId, sessionId, ct);
        if (session is null)
            return ServiceResult.NotFound<OutfitImportCommitResultDto>(ErrorCodes.OutfitImportNotFound);
        if (session.Status == OutfitImportStatus.Committed)
            return ServiceResult.Ok(StoredResult(session) ?? new OutfitImportCommitResultDto([], [], 0, 0, 0));

        var photos = await PhotosAsync(tenantId, sessionId, ct);
        if (!OutfitImportRules.CanCommit(OutfitImportRules.Phase(session.Status, photos.Select(p => p.Status).ToList())))
            return ServiceResult.Conflict<OutfitImportCommitResultDto>(null, ErrorCodes.OutfitImportNotReady);

        var ready = photos.Where(p => p.Status == OutfitImportPhotoStatus.Ready).ToList();
        var choices = (command.Looks ?? []).GroupBy(l => l.PhotoIndex).ToDictionary(g => g.Key, g => g.Last());
        var occurrences = ready.SelectMany(p => p.Pieces.Select(o => (Photo: p, Piece: o))).ToDictionary(x => x.Piece.Ref, StringComparer.Ordinal);
        foreach (var choice in choices.Values)
        {
            if (photos.All(p => p.Index != choice.PhotoIndex) || (choice.Pieces ?? []).Any(c => !occurrences.ContainsKey(c.Ref)))
                return ServiceResult.Invalid<OutfitImportCommitResultDto>(ErrorCodes.OutfitImportUnknownRef);
        }

        bool LookKept(OutfitImportPhotoEntity photo) => !choices.TryGetValue(photo.Index, out var choice) || choice.Keep;
        bool PieceKept(OutfitImportPhotoEntity photo, OutfitImportOccurrence piece) =>
            LookKept(photo) && (!choices.TryGetValue(photo.Index, out var choice) || (choice.Pieces ?? []).LastOrDefault(c => c.Ref == piece.Ref)?.Keep != false);

        var kept = ready.Where(LookKept).ToDictionary(p => p.Index, p => p.Pieces.Where(o => PieceKept(p, o)).ToList());
        var sessionPieces = (await repository.GetAllAsync<OutfitImportPieceEntity>(OutfitImportPieceEntity.GetPk(tenantId), OutfitImportPieceEntity.SessionPrefix(sessionId), SkOperator.BeginsWith, ct))
            .ToDictionary(p => p.Id, StringComparer.Ordinal);
        var wardrobeItems = (await repository.GetAllAsync<ItemEntity>(ItemEntity.GetPk(tenantId), ct)).ToDictionary(i => i.Id, StringComparer.Ordinal);

        // 1. New pieces kept in at least one kept look → items (+ background removal).
        var itemResults = new List<OutfitImportItemResultDto>();
        var created = new Dictionary<string, ItemCategory>(StringComparer.Ordinal);
        var cleanupJobs = 0;
        var newPieceIds = kept.Values.SelectMany(list => list).Where(o => o.MatchItemId is null && o.PieceId is not null)
            .Select(o => o.PieceId!).Distinct(StringComparer.Ordinal).ToList();
        foreach (var pieceId in newPieceIds)
        {
            if (!sessionPieces.TryGetValue(pieceId, out var piece))
                continue;
            var result = await wardrobe.CreateImportedItemAsync(tenantId, new ImportedItemCommand(
                $"oi-{sessionId}-{pieceId}", pieceId, piece.Name, piece.Category, piece.Subcategory, piece.ColorIds, piece.Fabric,
                OutfitImportRules.SeasonsOrAll(piece.Seasons), piece.CropKey), ct);
            itemResults.Add(new OutfitImportItemResultDto(pieceId, result.Outcome, result.Code, result.Item?.Id));
            if (result.Item is null)
                continue;
            created[pieceId] = result.Item.Category;
            if (result.Outcome == ItemCreateOutcome.Created && await QueueCleanupAsync(session, pieceId, piece, ct))
                cleanupJobs++;
        }

        // 2. One look per kept photo: its kept pieces, one per slot (re-assigned among what is left).
        var lookResults = new List<OutfitImportLookResultDto>();
        foreach (var photo in ready)
        {
            if (!kept.TryGetValue(photo.Index, out var pieces))
            {
                lookResults.Add(new OutfitImportLookResultDto(photo.Index, "skipped", "not_kept", null));
                continue;
            }
            lookResults.Add(await CreateLookAsync(session, photo, pieces, wardrobeItems, created, ct));
        }

        var commit = new OutfitImportCommitResultDto(lookResults, itemResults,
            lookResults.Count(l => l.Outcome == "created"), itemResults.Count(i => i.Outcome == ItemCreateOutcome.Created), cleanupJobs);

        session.Status = OutfitImportStatus.Committed;
        session.CommittedAt = Now;
        session.UpdatedAt = Now;
        session.Result = JsonSerializer.Serialize(commit, ResultJson);
        if (!await repository.SaveIfVersionAsync(session, session.Version, ct))
        {
            var current = await GetSessionAsync(tenantId, sessionId, ct);
            if (current?.Status == OutfitImportStatus.Committed)
                return ServiceResult.Ok(StoredResult(current) ?? commit);
        }

        await CleanUpAfterCommitAsync(tenantId, sessionId, photos, sessionPieces.Values, lookResults, created.Keys, ct);
        logger.LogInformation("Outfit import {SessionId} of tenant {TenantId} committed: {Looks} look(s), {Items} new item(s), {Jobs} cleanup job(s)",
            sessionId, tenantId, commit.CreatedLookCount, commit.CreatedItemCount, cleanupJobs);
        return ServiceResult.Ok(commit);
    }

    private async Task<OutfitImportLookResultDto> CreateLookAsync(OutfitImportSessionEntity session, OutfitImportPhotoEntity photo, List<OutfitImportOccurrence> pieces,
        IReadOnlyDictionary<string, ItemEntity> wardrobeItems, IReadOnlyDictionary<string, ItemCategory> created, CancellationToken ct)
    {
        // Only pieces that exist as items now: a match whose item was deleted meanwhile, or a new piece that was not created, is left out.
        var usable = pieces
            .Select(o => (Piece: o, ItemId: o.MatchItemId ?? o.PieceId, Category: o.MatchItemId is { } m
                ? wardrobeItems.TryGetValue(m, out var item) ? item.Category : (ItemCategory?)null
                : o.PieceId is { } p && created.TryGetValue(p, out var category) ? category : null))
            .Where(x => x.ItemId is not null && x.Category is not null)
            .GroupBy(x => x.ItemId!, StringComparer.Ordinal).Select(g => g.First())
            .ToList();
        var copies = usable.Select(x => new OutfitImportOccurrence { Ref = x.Piece.Ref, Confidence = x.Piece.Confidence, Category = x.Category!.Value }).ToList();
        OutfitImportRules.AssignSlots(copies, o => o.Category);
        var slots = copies.Where(c => c.Slot is not null)
            .Select(c => (Slot: c.Slot!.Value, ItemId: usable.First(u => u.Piece.Ref == c.Ref).ItemId!, c.Category))
            .ToList();

        var errors = OutfitSlotRules.Validate(slots.Select(s => new SlotPiece(s.Slot, s.ItemId, null, s.Category)).ToList());
        if (errors.Count > 0)
            return new OutfitImportLookResultDto(photo.Index, "skipped", errors[0], null);

        var now = Now;
        var look = new LookEntity
        {
            Id = photo.LookId,
            TenantId = session.TenantId,
            Slots = slots.OrderBy(s => s.Slot).Select(s => new LookSlotValue { Slot = s.Slot, ItemId = s.ItemId }).ToList(),
            Source = LookSource.Import,
            CoverImageKey = photo.PhotoKey is { } key && StorageKeys.BelongsToTenant(key, session.TenantId) ? key : null,
            CreatedAt = now.AddMilliseconds(photo.Index), // keeps the photo order in "Looklar" (newest first)
            UpdatedAt = now,
        };
        // A replayed commit finds the look already there (same id): nothing is written twice.
        await repository.SaveIfVersionAsync(look, 0, ct);
        return new OutfitImportLookResultDto(photo.Index, "created", null, look.Id);
    }

    /// <summary>Background removal of a created item: its crop is handed to the worker in the upload slot of the item id.</summary>
    private async Task<bool> QueueCleanupAsync(OutfitImportSessionEntity session, string itemId, OutfitImportPieceEntity piece, CancellationToken ct)
    {
        var tenantId = session.TenantId;
        if (!StorageKeys.BelongsToTenant(piece.CropKey, tenantId) || await storage.ReadAsync(piece.CropKey, photoOptions.CurrentValue.MaxUploadBytes, ct) is not { } crop)
            return false;
        await storage.PutAsync(StorageKeys.Upload(tenantId, itemId), crop, "image/jpeg", ct);
        var now = Now;
        var job = new JobEntity
        {
            Id = Ulid.Deterministic(session.CreatedAt, $"{session.Id}:clean:{itemId}"),
            TenantId = tenantId,
            Kind = JobKind.ItemClean,
            // AI usage counters: this cleanup belongs to the outfit import (import_cleanup), not a multi-item photo.
            Input = $$"""{"usageSource":"{{AiUsageOperations.OutfitImportSource}}"}""",
            Status = JobStatus.Queued,
            CreatedAt = now,
            UpdatedAt = now,
        };
        if (!(await repository.TransactWriteAsync([TransactWriteOperation.Create(job)], ct)).Applied)
            return false; // queued by an earlier run of this commit
        await events.PublishAsync(new ItemProcessRequestedEvent(tenantId, job.Id, itemId, Clean: true, ItemId: itemId), ct);
        return true;
    }

    /// <summary>
    /// After the commit only what the new items and looks use stays: the crops of created items (their image until cleaned)
    /// and the photos of created looks (their cover). The originals go too (the bucket rule would remove them after 7 days).
    /// </summary>
    private async Task CleanUpAfterCommitAsync(string tenantId, string sessionId, IReadOnlyList<OutfitImportPhotoEntity> photos,
        IEnumerable<OutfitImportPieceEntity> pieces, IReadOnlyList<OutfitImportLookResultDto> looks, IEnumerable<string> createdPieceIds, CancellationToken ct)
    {
        var keep = new HashSet<string>(StringComparer.Ordinal);
        var createdSet = createdPieceIds.ToHashSet(StringComparer.Ordinal);
        foreach (var piece in pieces.Where(p => createdSet.Contains(p.Id)))
            keep.Add(piece.CropKey);
        foreach (var look in looks.Where(l => l.Outcome == "created"))
            if (photos.FirstOrDefault(p => p.Index == look.PhotoIndex)?.PhotoKey is { } cover)
                keep.Add(cover);

        foreach (var key in await storage.ListKeysAsync(StorageKeys.ImportPrefix(tenantId, sessionId), ct))
            if (!keep.Contains(key) && StorageKeys.BelongsToTenant(key, tenantId))
                await storage.DeleteAsync(key, ct);
        await Storage.ImportUploadsCleanup.DeletePrefixAsync(storage, StorageKeys.ImportUploadPrefix(tenantId, sessionId), logger, ct);

        // Photos never uploaded held a recognition: it is given back.
        foreach (var photo in photos.Where(p => p.Status == OutfitImportPhotoStatus.Pending))
            await itemRecognition.ReleaseAsync(tenantId, OutfitImportPhotoEntity.RecognitionKey(sessionId, photo.Index), ct);
    }

    // ── Discard ───────────────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// "Vazgeç": the session, its photos and pieces go; recognitions of photos not processed yet are given back (a photo the
    /// worker is on finds the session gone and stops). Before a commit every object of the session goes; after it only the
    /// originals (the crops and covers left are used by the new items and looks).
    /// </summary>
    public async Task<bool> DiscardAsync(string tenantId, string sessionId, CancellationToken ct)
    {
        var session = await GetSessionAsync(tenantId, sessionId, ct);
        if (session is null)
            return false;

        var photos = await PhotosAsync(tenantId, sessionId, ct);
        await repository.DeleteAsync(session.Pk, session.Sk, ct);
        foreach (var photo in photos.Where(p => p.Status is OutfitImportPhotoStatus.Pending or OutfitImportPhotoStatus.Uploaded or OutfitImportPhotoStatus.Detected))
            await itemRecognition.ReleaseAsync(tenantId, OutfitImportPhotoEntity.RecognitionKey(sessionId, photo.Index), ct);

        var keys = photos.Select(p => (p.Pk, p.Sk)).ToList();
        keys.AddRange((await repository.GetAllAsync<OutfitImportPieceEntity>(OutfitImportPieceEntity.GetPk(tenantId), OutfitImportPieceEntity.SessionPrefix(sessionId), SkOperator.BeginsWith, ct))
            .Select(p => (p.Pk, p.Sk)));
        keys.Add((OutfitImportLeaseEntity.GetPk(tenantId), OutfitImportLeaseEntity.MatchLock(sessionId)));
        await repository.BatchDeleteKeysAsync(keys, ct);

        await Storage.ImportUploadsCleanup.DeletePrefixAsync(storage, StorageKeys.ImportUploadPrefix(tenantId, sessionId), logger, ct);
        if (session.Status != OutfitImportStatus.Committed)
            await storage.DeletePrefixAsync(StorageKeys.ImportPrefix(tenantId, sessionId), ct);
        logger.LogInformation("Outfit import {SessionId} of tenant {TenantId} discarded ({Status})", sessionId, tenantId, session.Status);
        return true;
    }

    // ── Read model ────────────────────────────────────────────────────────────────────────────────────────────────

    private async Task<OutfitImportDto> ToDtoAsync(OutfitImportSessionEntity session, IReadOnlyList<OutfitImportPhotoEntity> photos, CancellationToken ct)
    {
        var tenantId = session.TenantId;
        var ttl = TimeSpan.FromSeconds(photoOptions.CurrentValue.ReadUrlTtlSeconds);
        var expires = Now.Add(ttl);
        var pieces = photos.Any(p => p.Pieces.Count > 0)
            ? (await repository.GetAllAsync<OutfitImportPieceEntity>(OutfitImportPieceEntity.GetPk(tenantId), OutfitImportPieceEntity.SessionPrefix(session.Id), SkOperator.BeginsWith, ct))
                .ToDictionary(p => p.Id, StringComparer.Ordinal)
            : [];
        var matched = photos.SelectMany(p => p.Pieces).Where(o => o.MatchItemId is not null).Select(o => o.MatchItemId!).ToHashSet(StringComparer.Ordinal);
        var items = matched.Count == 0
            ? new Dictionary<string, ItemEntity>(StringComparer.Ordinal)
            : (await repository.GetAllAsync<ItemEntity>(ItemEntity.GetPk(tenantId), ct)).Where(i => matched.Contains(i.Id)).ToDictionary(i => i.Id, StringComparer.Ordinal);

        async Task<string?> Url(string? key) => key is not null && StorageKeys.BelongsToTenant(key, tenantId) ? await storage.CreateReadUrlAsync(key, ttl, ct) : null;

        var photoDtos = new List<OutfitImportPhotoDto>(photos.Count);
        foreach (var photo in photos.OrderBy(p => p.Index))
        {
            var pieceDtos = new List<OutfitImportPieceDto>(photo.Pieces.Count);
            foreach (var o in photo.Pieces)
            {
                string? imageUrl;
                if (o.MatchItemId is { } itemId && items.TryGetValue(itemId, out var item))
                {
                    imageUrl = (await imageUrls.GetAsync(item, ct)).ThumbUrl;
                }
                else
                {
                    imageUrl = await Url(o.CropKey);
                }
                var alsoIn = o.PieceId is { } pieceId && pieces.TryGetValue(pieceId, out var piece)
                    ? piece.SeenIn.Where(i => i != photo.Index).Distinct().Order().ToList()
                    : [];
                pieceDtos.Add(new OutfitImportPieceDto(o.Ref, o.MatchItemId is not null ? OutfitImportPieceKind.Match : OutfitImportPieceKind.New,
                    o.MatchItemId, o.MatchItemId is null ? o.PieceId : null, o.MatchItemId is { } m && items.TryGetValue(m, out var own) ? own.Name ?? o.Name : o.Name,
                    o.MatchItemId is { } m2 && items.TryGetValue(m2, out var own2) ? own2.Category : o.Category, o.Subcategory, o.ColorIds, o.Slot, imageUrl,
                    o.MatchConfidence, alsoIn));
            }
            photoDtos.Add(new OutfitImportPhotoDto(photo.Index, photo.Status, photo.Failure, await Url(photo.PhotoKey), photo.LookId, pieceDtos));
        }

        var allPieces = photos.SelectMany(p => p.Pieces).ToList();
        return new OutfitImportDto(
            session.Id,
            OutfitImportRules.Phase(session.Status, photos.Select(p => p.Status).ToList()),
            session.Count,
            session.Requested,
            new OutfitImportCountersDto(session.Uploaded, session.Detected, session.Matched, session.Ready, session.Failed),
            photoDtos,
            allPieces.Where(o => o.MatchItemId is null && o.PieceId is not null).Select(o => o.PieceId!).Distinct(StringComparer.Ordinal).Count(),
            allPieces.Where(o => o.MatchItemId is not null).Select(o => o.MatchItemId!).Distinct(StringComparer.Ordinal).Count(),
            session.CreatedAt,
            session.CreatedAt.AddDays(OutfitImportSessionEntity.RetentionDays),
            expires,
            StoredResult(session));
    }

    private static OutfitImportCommitResultDto? StoredResult(OutfitImportSessionEntity session) =>
        session.Result is { Length: > 0 } json ? JsonSerializer.Deserialize<OutfitImportCommitResultDto>(json, ResultJson) : null;

    private Task<OutfitImportSessionEntity?> GetSessionAsync(string tenantId, string sessionId, CancellationToken ct) =>
        repository.GetAsync<OutfitImportSessionEntity>(OutfitImportSessionEntity.GetPk(tenantId), OutfitImportSessionEntity.GetSk(sessionId), ct);

    private async Task<IReadOnlyList<OutfitImportPhotoEntity>> PhotosAsync(string tenantId, string sessionId, CancellationToken ct) =>
        (await repository.GetAllAsync<OutfitImportPhotoEntity>(OutfitImportPhotoEntity.GetPk(tenantId), OutfitImportPhotoEntity.SessionPrefix(sessionId), SkOperator.BeginsWith, ct))
        .OrderBy(p => p.Index).ToList();

    private async Task<string> LanguageAsync(string tenantId, string? requestLanguage, CancellationToken ct) =>
        Localized.Language((await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(tenantId), ct))?.Language, requestLanguage);
}
