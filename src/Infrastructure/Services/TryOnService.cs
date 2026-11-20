using Domain.Constant;
using Domain.Domain;
using Domain.Entity;
using Domain.Enum;
using Domain.Events;
using Domain.Extensions;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Domain.Services.Styling;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Infrastructure.Services;

/// <summary>
/// E6 "Üzerimde gör" (Api side). One image = one credit, reserved on enqueue and committed / refunded by the worker.
/// Path (owner decision 4): the active body photo when there is one; otherwise the face photo + body type + height / size
/// ("yüz yolu", TryOnRules). The cache identity is the subject (body photo, or the face subject key) + target (an outfit is identified by the sorted set of its pieces), so the same
/// combination is never rendered — or charged — twice, whichever screen asks for it. Images are strictly tenant-private:
/// owner prefix only, short-lived presigned GET only, never a global cache.
/// Photo try-on ("Kombini ayırmadan üzerimde gör"): the target is a photo of someone wearing a whole outfit (an item upload
/// / draft of 12, or an outfit import photo). Its EXIF-stripped bytes are hashed (TryOnRules.ReferenceHash) — the hash is
/// the target id, so the same photo from any screen is one image — and copied to uploads/tmp/ for the job.
/// </summary>
public sealed class TryOnService(
    IRepository repository,
    IObjectStorage storage,
    IEventManager events,
    IEntitlementService entitlements,
    ICreditService credits,
    ICatalogProductLookup products,
    IEditLookLookup editLooks,
    ILibraryCatalog library,
    IOptionsMonitor<PhotoOptions> photoOptions,
    TimeProvider timeProvider,
    ILogger<TryOnService> logger) : ITryOnService
{
    /// <param name="Reference">Photo try-on: the outfit photo (EXIF-stripped); no pieces then.</param>
    private sealed record Resolved(TryOnTarget Target, IReadOnlyList<OutfitPiece> Pieces, StrippedImage? Reference = null);

    /// <summary>What a try-on renders on: Key = cache / credit subject (body photo id or the face subject key).</summary>
    private sealed record Subject(TryOnSource Source, string Key, PhotoEntity Photo, BodyType? BodyType, int? HeightCm, ClothingSize? Size);

    private DateTime Now => timeProvider.GetUtcNow().UtcDateTime;

    public async Task<ServiceResult<TryOnStartDto>> StartAsync(string tenantId, StartTryOnCommand command, CancellationToken ct)
    {
        var body = await SubjectAsync(tenantId, ct);
        if (body is null)
            return ServiceResult.Invalid<TryOnStartDto>(ErrorCodes.BodyPhotoRequired);

        var (resolved, error) = await ResolveAsync(tenantId, command.Target, ct);
        if (resolved is null)
            return error is ErrorCodes.TryOnTargetEmpty or ErrorCodes.TryOnReferenceInvalid
                ? ServiceResult.Invalid<TryOnStartDto>(error)
                : ServiceResult.NotFound<TryOnStartDto>(error);

        return await StartResolvedAsync(tenantId, body, resolved, command.RequestId, ct);
    }

    public async Task<ServiceResult<TryOnImageDto>> FindAsync(string tenantId, TryOnTargetInput target, CancellationToken ct)
    {
        var body = await SubjectAsync(tenantId, ct);
        var (resolved, error) = await ResolveAsync(tenantId, target, ct);
        if (resolved is null)
            return ServiceResult.NotFound<TryOnImageDto>(error);

        var image = body is null ? null : await CachedAsync(tenantId, body.Key, resolved.Target, ct);
        return image is null ? ServiceResult.NotFound<TryOnImageDto>() : ServiceResult.Ok(await ToDtoAsync(image, ct));
    }

    public async Task<TryOnImageDto?> GetAsync(string tenantId, string imageId, CancellationToken ct)
    {
        var image = (await repository.GetAllAsync<TryOnImageEntity>(TryOnImageEntity.GetPk(tenantId), ct)).FirstOrDefault(i => i.Id == imageId);
        return image is null || !StorageKeys.BelongsToTenant(image.S3Key, tenantId) ? null : await ToDtoAsync(image, ct);
    }

    public async Task<ServiceResult<TryOnQuoteDto>> QuoteWeekAsync(string tenantId, string weekStart, CancellationToken ct)
    {
        var body = await SubjectAsync(tenantId, ct);
        if (body is null)
            return ServiceResult.Invalid<TryOnQuoteDto>(ErrorCodes.BodyPhotoRequired);
        var (quote, _) = await QuoteAsync(tenantId, body, weekStart, ct);
        return ServiceResult.Ok(quote);
    }

    public async Task<ServiceResult<TryOnBatchDto>> StartWeekAsync(string tenantId, TryOnWeekCommand command, CancellationToken ct)
    {
        var body = await SubjectAsync(tenantId, ct);
        if (body is null)
            return ServiceResult.Invalid<TryOnBatchDto>(ErrorCodes.BodyPhotoRequired);

        var (quote, days) = await QuoteAsync(tenantId, body, command.WeekStart, ct);
        if (quote.RequiredCredits > 0)
        {
            // The user confirmed a number ("7 kredi harcanacak"): never charge a different one.
            if (quote.RequiredCredits != command.ExpectedCredits)
                return ServiceResult.Conflict<TryOnBatchDto>(null, ErrorCodes.CreditQuoteChanged);

            var decision = await entitlements.CheckAsync(tenantId, Capability.TryOn, ct);
            if (!decision.Allowed && decision.Reason == ErrorCodes.PremiumRequired)
                return ServiceResult.Forbidden<TryOnBatchDto>(ErrorCodes.PremiumRequired);
            if (!quote.Sufficient)
                return ServiceResult.PaymentRequired<TryOnBatchDto>(ErrorCodes.CreditsExhausted);
        }

        var started = new List<(string JobId, string Key)>();
        var items = new List<TryOnBatchItemDto>();
        var charged = 0;
        foreach (var (date, lookId, resolved) in days)
        {
            var result = await StartResolvedAsync(tenantId, body, resolved, Ulid.New(Now), ct, started);
            if (!result.IsSuccess)
            {
                // All or nothing: a batch that cannot be completed gives back what it reserved in this call.
                foreach (var (jobId, key) in started)
                {
                    await credits.RefundAsync(tenantId, key, ct);
                    await repository.DeleteAsync(JobEntity.GetPk(tenantId), JobEntity.GetSk(jobId), ct);
                }
                return new ServiceResult<TryOnBatchDto>(result.Kind, null, result.Code);
            }

            charged = started.Count;
            items.Add(new TryOnBatchItemDto(date, lookId, result.Value!.Status, result.Value.Image, result.Value.Job));
        }

        return ServiceResult.Accepted(new TryOnBatchDto(charged, items));
    }

    // ── Core ──────────────────────────────────────────────────────────────────────────────────────────────────────

    private async Task<ServiceResult<TryOnStartDto>> StartResolvedAsync(string tenantId, Subject body, Resolved resolved, string requestId,
        CancellationToken ct, List<(string JobId, string Key)>? started = null)
    {
        var target = resolved.Target;
        if (await CachedAsync(tenantId, body.Key, target, ct) is { } cached)
            return ServiceResult.Ok(new TryOnStartDto(StartStatus.Cached, await ToDtoAsync(cached, ct), null));

        var key = CreditLedger.TryOnIdempotencyKey(body.Key, target.Kind, target.Id, target.Version);

        // Same outfit already being rendered (another screen, a retry): hand back that job — no second credit.
        if (await InFlightAsync(tenantId, key, ct) is { } running)
            return ServiceResult.Accepted(new TryOnStartDto(StartStatus.Queued, null, running.ToDto()));

        if (await repository.GetAsync<JobEntity>(JobEntity.GetPk(tenantId), JobEntity.GetSk(requestId), ct) is { } sameRequest)
        {
            return sameRequest.Kind == JobKind.TryOn
                ? ServiceResult.Accepted(new TryOnStartDto(StartStatus.Queued, null, sameRequest.ToDto()))
                : ServiceResult.Conflict<TryOnStartDto>(null, ErrorCodes.RequestIdReused);
        }

        var decision = await entitlements.CheckAsync(tenantId, Capability.TryOn, ct);
        if (!decision.Allowed)
        {
            return decision.Reason == ErrorCodes.CreditsExhausted
                ? ServiceResult.PaymentRequired<TryOnStartDto>(ErrorCodes.CreditsExhausted)
                : ServiceResult.Forbidden<TryOnStartDto>(decision.Reason ?? ErrorCodes.PremiumRequired);
        }

        // Photo try-on: the outfit photo goes where the worker reads it (content-addressed, so a retry rewrites the same key).
        string? referenceKey = null;
        if (resolved.Reference is { } reference)
        {
            referenceKey = StorageKeys.TryOnReferenceUpload(tenantId, target.Id);
            await storage.PutAsync(referenceKey, reference.Data, reference.ContentType, ct);
        }

        var input = new TryOnJobInput(resolved.Pieces, referenceKey, resolved.Reference?.ContentType);
        var job = JobStarter.New(tenantId, requestId, JobKind.TryOn, StylingJson.Serialize(input), Now, key);
        await repository.SaveAsync(job, ct);

        var reservation = await credits.ReserveAsync(tenantId, key, job.Id, ct);
        if (reservation.Outcome != ReserveOutcome.Reserved)
        {
            await repository.DeleteAsync(job.Pk, job.Sk, ct);
            if (reservation.Outcome == ReserveOutcome.Insufficient)
                return ServiceResult.PaymentRequired<TryOnStartDto>(ErrorCodes.CreditsExhausted);
            // Lost a race against an identical request: join its job.
            return await InFlightAsync(tenantId, key, ct) is { } other
                ? ServiceResult.Accepted(new TryOnStartDto(StartStatus.Queued, null, other.ToDto()))
                : ServiceResult.Conflict<TryOnStartDto>(null, ErrorCodes.RequestIdReused);
        }

        try
        {
            await events.PublishAsync(body.Source == TryOnSource.Face
                ? new TryOnRequestedEvent(tenantId, job.Id, target, body.Key, key, TryOnSource.Face, body.Photo.Id, body.BodyType ?? BodyType.Unsure, body.HeightCm, body.Size)
                : new TryOnRequestedEvent(tenantId, job.Id, target, body.Key, key), ct);
        }
        catch
        {
            // Nothing will ever process this job: the credit must not stay reserved.
            await credits.RefundAsync(tenantId, key, CancellationToken.None);
            await repository.DeleteAsync(job.Pk, job.Sk, CancellationToken.None);
            throw;
        }

        started?.Add((job.Id, key));
        logger.LogInformation("Queued try-on job {JobId} ({Kind}, {Source} path) for tenant {TenantId}", job.Id, target.Kind, body.Source, tenantId);
        return ServiceResult.Accepted(new TryOnStartDto(StartStatus.Queued, null, job.ToDto()));
    }

    private async Task<(TryOnQuoteDto Quote, List<(string Date, string LookId, Resolved Resolved)> Days)> QuoteAsync(
        string tenantId, Subject body, string weekStart, CancellationToken ct)
    {
        var start = CalendarDay.Parse(weekStart);
        var end = CalendarDay.ToText(start.AddDays(6));
        var planned = (await repository.GetAllAsync<PlanDayEntity>(PlanDayEntity.GetPk(tenantId), weekStart, SkOperator.GreaterThanOrEqual, ct))
            .Where(d => d.LookId is not null && string.CompareOrdinal(d.Date, end) <= 0)
            .OrderBy(d => d.Date, StringComparer.Ordinal);

        var days = new List<(string, string, Resolved)>();
        var items = new List<TryOnQuoteItemDto>();
        var toCharge = new HashSet<string>(StringComparer.Ordinal);
        foreach (var day in planned)
        {
            var (resolved, _) = await ResolveAsync(tenantId, new TryOnTargetInput(TryOnTargetKind.Look, day.LookId!), ct);
            if (resolved is null)
                continue;

            var cached = await CachedAsync(tenantId, body.Key, resolved.Target, ct);
            var key = CreditLedger.TryOnIdempotencyKey(body.Key, resolved.Target.Kind, resolved.Target.Id, resolved.Target.Version);
            // The same outfit planned on two days is one image; an outfit already being rendered is already paid for.
            if (cached is null && await InFlightAsync(tenantId, key, ct) is null)
                toCharge.Add(key);
            days.Add((day.Date, day.LookId!, resolved));
            items.Add(new TryOnQuoteItemDto(day.Date, day.LookId!, cached is not null, cached?.Id));
        }

        var remaining = (await entitlements.GetAsync(tenantId, ct)).Credits.TotalRemaining;
        var quote = new TryOnQuoteDto(weekStart, toCharge.Count, items.Count(i => i.Cached), remaining, remaining >= toCharge.Count, items);
        return (quote, days);
    }

    /// <summary>Target -> renderable pieces, strictly inside the caller's tenant (items, looks, own stylist jobs) or the global catalog.</summary>
    private async Task<(Resolved? Resolved, string? Error)> ResolveAsync(string tenantId, TryOnTargetInput target, CancellationToken ct)
    {
        switch (target.Kind)
        {
            case TryOnTargetKind.Item:
            {
                var item = await repository.GetAsync<ItemEntity>(ItemEntity.GetPk(tenantId), ItemEntity.GetSk(target.Id), ct);
                return item is null
                    ? (null, ErrorCodes.TargetNotFound)
                    : (new Resolved(new TryOnTarget(TryOnTargetKind.Item, item.Id, item.UseOriginalImage ? 1 : 0), [new OutfitPiece(item.Id, null)]), null);
            }
            case TryOnTargetKind.Product:
            {
                var product = await products.GetAsync(target.Id, ct);
                return product is null or { Retired: true }
                    ? (null, ErrorCodes.TargetNotFound)
                    : (new Resolved(new TryOnTarget(TryOnTargetKind.Product, product.Id, 0), [new OutfitPiece(null, product.Id)]), null);
            }
            case TryOnTargetKind.Look:
            {
                var look = await repository.GetAsync<LookEntity>(LookEntity.GetPk(tenantId), LookEntity.GetSk(target.Id), ct);
                return look is null
                    ? (null, ErrorCodes.TargetNotFound)
                    : await OutfitAsync(tenantId, look.Slots.Select(s => new OutfitPiece(s.ItemId, s.ProductId)), ct);
            }
            case TryOnTargetKind.Suggestion:
            {
                var job = await JobStarter.CompletedAsync(repository, tenantId, target.Id, JobKind.StylistOutfit, ct);
                var suggestion = StylingJson.TryDeserialize<OutfitResult>(job?.Result)?.Suggestions.FirstOrDefault(s => s.Index == (target.Index ?? 0));
                return suggestion is null
                    ? (null, ErrorCodes.TargetNotFound)
                    : await OutfitAsync(tenantId, suggestion.Slots.Select(s => new OutfitPiece(s.ItemId, s.ProductId))
                        .Concat(suggestion.Missing.Where(m => m.ProductId is not null || m.LibraryItemId is not null)
                            .Select(m => new OutfitPiece(null, m.ProductId, m.LibraryItemId))), ct);
            }
            case TryOnTargetKind.EditLook:
            {
                var productIds = await editLooks.GetProductIdsAsync(target.Id, ct);
                return productIds is null
                    ? (null, ErrorCodes.TargetNotFound)
                    : await OutfitAsync(tenantId, productIds.Select(id => new OutfitPiece(null, id)), ct);
            }
            case TryOnTargetKind.Photo or TryOnTargetKind.ImportPhoto:
                return await ReferenceAsync(tenantId, target, ct);
            case TryOnTargetKind.TripDay:
            {
                // "{tripId}/{date}": the day's look on the trip detail. Same outfit rule as a look, so the image is shared.
                var separator = target.Id.IndexOf('/');
                if (separator <= 0 || separator == target.Id.Length - 1)
                    return (null, ErrorCodes.TargetNotFound);
                var day = await repository.GetAsync<TripDayEntity>(TripDayEntity.GetPk(tenantId),
                    TripDayEntity.GetSk(target.Id[..separator], target.Id[(separator + 1)..]), ct);
                return day is null
                    ? (null, ErrorCodes.TargetNotFound)
                    : await OutfitAsync(tenantId, day.Slots.Select(s => new OutfitPiece(s.ItemId, s.ProductId)), ct);
            }
            default:
                return (null, ErrorCodes.TargetNotFound);
        }
    }

    /// <summary>
    /// Photo try-on: the outfit photo, strictly from the caller's own uploads — an item upload or item draft (12, its original
    /// once the item processor took the upload), or an outfit import photo (session id + index). Not an image → 422
    /// tryon_reference_invalid; gone → 404 target_not_found.
    /// </summary>
    private async Task<(Resolved?, string?)> ReferenceAsync(string tenantId, TryOnTargetInput target, CancellationToken ct)
    {
        var candidates = new List<string>();
        if (target.Kind == TryOnTargetKind.ImportPhoto)
        {
            if (target.Index is not { } index)
                return (null, ErrorCodes.TargetNotFound);
            var photo = await repository.GetAsync<OutfitImportPhotoEntity>(OutfitImportPhotoEntity.GetPk(tenantId), OutfitImportPhotoEntity.GetSk(target.Id, index), ct);
            if (photo is not null)
                candidates.AddRange(new[] { photo.PhotoKey, photo.UploadKey }.OfType<string>());
        }
        else if (await repository.GetAsync<ItemUploadEntity>(ItemUploadEntity.GetPk(tenantId), ItemUploadEntity.GetSk(target.Id), ct) is { } upload)
        {
            candidates.Add(upload.S3Key);
        }
        else if (await repository.GetAsync<ItemDraftEntity>(ItemDraftEntity.GetPk(tenantId), ItemDraftEntity.GetSk(target.Id), ct) is { } draft)
        {
            candidates.Add(StorageKeys.Upload(tenantId, draft.Id));
            if (draft.OriginalKey is not null)
                candidates.Add(draft.OriginalKey);
        }

        var settings = photoOptions.CurrentValue;
        foreach (var key in candidates.Where(k => StorageKeys.BelongsToTenant(k, tenantId)))
        {
            var raw = await storage.ReadAsync(key, settings.MaxUploadBytes, ct);
            if (raw is null)
                continue;
            var clean = ImageMetadataStripper.Strip(raw);
            if (clean is null || !settings.AllowedContentTypes.Contains(clean.ContentType))
                return (null, ErrorCodes.TryOnReferenceInvalid);
            return (new Resolved(new TryOnTarget(TryOnTargetKind.Photo, TryOnRules.ReferenceHash(clean.Data), 0), [], clean), null);
        }
        return (null, ErrorCodes.TargetNotFound);
    }

    /// <summary>Drops pieces that no longer exist (deleted item, retired product); what is left is the outfit's identity.</summary>
    private async Task<(Resolved?, string?)> OutfitAsync(string tenantId, IEnumerable<OutfitPiece> candidates, CancellationToken ct)
    {
        var pieces = new List<OutfitPiece>();
        List<ItemEntity>? owned = null;
        foreach (var piece in candidates)
        {
            if (piece.ItemId is null && piece.LibraryItemId is not null)
            {
                // A library piece the stylist picked: the user's own copy once added ("Gardıroba ekle"), else the library image.
                owned ??= (await repository.GetAllAsync<ItemEntity>(ItemEntity.GetPk(tenantId), ct)).ToList();
                if (owned.FirstOrDefault(i => string.Equals(i.LibraryItemId, piece.LibraryItemId, StringComparison.Ordinal)) is { } copy)
                    pieces.Add(new OutfitPiece(copy.Id, null));
                else if ((await library.GetAllAsync(ct)).Any(l => l.Id == piece.LibraryItemId))
                    pieces.Add(new OutfitPiece(null, null, piece.LibraryItemId));
            }
            else if (piece.ItemId is not null)
            {
                if (await repository.GetAsync<ItemEntity>(ItemEntity.GetPk(tenantId), ItemEntity.GetSk(piece.ItemId), ct) is not null)
                    pieces.Add(new OutfitPiece(piece.ItemId, null));
            }
            else if (piece.ProductId is not null && await products.GetAsync(piece.ProductId, ct) is { Retired: false })
            {
                pieces.Add(new OutfitPiece(null, piece.ProductId));
            }
        }

        return pieces.Count == 0
            ? (null, ErrorCodes.TryOnTargetEmpty)
            : (new Resolved(new TryOnTarget(TryOnTargetKind.Look, TryOnFingerprint.Of(pieces), 0), pieces), null);
    }

    private async Task<JobEntity?> InFlightAsync(string tenantId, string key, CancellationToken ct)
    {
        var reservation = await repository.GetAsync<CreditReservationEntity>(CreditReservationEntity.GetPk(tenantId), CreditReservationEntity.GetSk(key), ct);
        return reservation?.JobId is null
            ? null
            : await repository.GetAsync<JobEntity>(JobEntity.GetPk(tenantId), JobEntity.GetSk(reservation.JobId), ct);
    }

    private async Task<TryOnImageEntity?> CachedAsync(string tenantId, string bodyPhotoId, TryOnTarget target, CancellationToken ct)
    {
        var image = await repository.GetAsync<TryOnImageEntity>(TryOnImageEntity.GetPk(tenantId),
            TryOnImageEntity.GetSk(bodyPhotoId, target.Kind, target.Id, target.Version), ct);
        return image is not null && StorageKeys.BelongsToTenant(image.S3Key, tenantId) ? image : null;
    }

    public async Task<TryOnSource?> PathAsync(string tenantId, CancellationToken ct) => (await SubjectAsync(tenantId, ct))?.Source;

    /// <summary>The body photo when there is one (preferred); else the face photo with the body profile (face path); else null.</summary>
    private async Task<Subject?> SubjectAsync(string tenantId, CancellationToken ct)
    {
        var photos = (await repository.GetAllAsync<PhotoEntity>(PhotoEntity.GetPk(tenantId), ct))
            .Where(p => p.Active && StorageKeys.BelongsToTenant(p.S3Key, tenantId))
            .ToList();
        var body = photos.FirstOrDefault(p => p.Kind == PhotoKind.Body);
        var face = photos.FirstOrDefault(p => p.Kind == PhotoKind.Face);
        switch (TryOnRules.PathFor(body is not null, face is not null))
        {
            case TryOnSource.Body:
                return new Subject(TryOnSource.Body, body!.Id, body, null, null, null);
            case TryOnSource.Face:
                var profile = await repository.GetAsync<BodyProfileEntity>(BodyProfileEntity.GetPk(tenantId), BodyProfileEntity.GetSk(), ct);
                return new Subject(TryOnSource.Face, TryOnRules.FaceSubjectKey(face!.Id, profile?.BodyType, profile?.HeightCm, profile?.Size),
                    face, profile?.BodyType, profile?.HeightCm, profile?.Size);
            default:
                return null;
        }
    }

    private async Task<TryOnImageDto> ToDtoAsync(TryOnImageEntity image, CancellationToken ct)
    {
        var ttl = TimeSpan.FromSeconds(photoOptions.CurrentValue.ReadUrlTtlSeconds);
        var reference = image.ReferenceKey is { } referenceKey && StorageKeys.BelongsToTenant(referenceKey, image.TenantId)
            ? await storage.CreateReadUrlAsync(referenceKey, ttl, ct)
            : null;
        return new TryOnImageDto(image.Id, await storage.CreateReadUrlAsync(image.S3Key, ttl, ct), Now.Add(ttl), image.CreatedAt, image.Source, reference);
    }
}
