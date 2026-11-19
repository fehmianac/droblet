using Domain.Entity;
using Domain.Enum;
using Domain.Events;
using Domain.Extensions;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Domain.Services.Ai;
using Domain.Services.Styling;
using Infrastructure.Workers;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace ItemProcessor.Services;

public interface IItemProcessJobService
{
    Task ProcessAsync(ItemProcessRequestedEvent message, bool isLastAttempt, CancellationToken ct);
}

/// <summary>
/// Item photo → drafts. One vision call per photo finds every wearable piece in it, jewellery included, each with a box
/// (ItemDetectionGuard decides what is kept). One piece: it is cropped (unless it fills the photo), its background is removed
/// and the photo's draft becomes a ready "single" draft — the review form opens directly. Two or more: the photo becomes a
/// draft group (kind Outfit) and each piece a "detected" draft whose image is the plain crop — no image-model call yet; the
/// background of a piece is removed only after the user selected it ("clean" jobs, one per piece, no recognition used), so
/// pieces the user drops cost nothing.
/// Never writes an Item: drafts become items only through the user's confirm endpoint.
/// On failure the EXIF-stripped original stays with the (Failed) draft so the user can fill the fields by hand.
/// Everything is written under the message's tenant prefix only; nothing here ever reaches a global cache.
/// </summary>
public sealed class ItemProcessJobService(
    IJobLifecycle jobs,
    IRepository repository,
    IObjectStorage storage,
    IItemDetector detector,
    IItemImageCleanup cleanup,
    IImageCropper cropper,
    IOptionsMonitor<AiOptions> aiOptions,
    IOptionsMonitor<WardrobeOptions> wardrobeOptions,
    TimeProvider timeProvider,
    ILogger<ItemProcessJobService> logger) : IItemProcessJobService
{
    private const long MaxImageBytes = 15 * 1024 * 1024;

    public async Task ProcessAsync(ItemProcessRequestedEvent message, bool isLastAttempt, CancellationToken ct)
    {
        var job = await jobs.StartAsync(message.TenantId, message.JobId, ct);
        if (job is null)
            return;

        var draft = await repository.GetAsync<ItemDraftEntity>(ItemDraftEntity.GetPk(message.TenantId), ItemDraftEntity.GetSk(message.DraftId), ct);
        if (draft is null)
        {
            // The user deleted the draft before the worker got to it: no AI call, nothing is written.
            await jobs.FailAsync(job, JobFailure.SourceDeleted, ct);
            return;
        }

        // Objects this run wrote for the draft; removed again if the draft turns out to be deleted meanwhile.
        var written = new List<string>();
        try
        {
            var outcome = message.Clean
                ? await CleanAsync(job, draft, written, ct)
                : await DetectAsync(job, draft, message, written, ct);
            if (outcome.WasDeleted)
                return;
            if (outcome.Failure is { } failure)
                await FinishAsync(job, draft, failure, ct);
        }
        catch (Exception ex) when (!WorkerFailure.IsRetryable(ex, isLastAttempt))
        {
            logger.LogWarning(ex, "Item {Kind} job {JobId} failed for tenant {TenantId}", job.Kind, job.Id, job.TenantId);
            await FinishAsync(job, draft, JobFailure.ProviderError, ct);
        }
    }

    /// <summary>Done (job completed), a failure for FinishAsync, or "the draft was deleted" (already cleaned up and failed).</summary>
    private readonly record struct Outcome(bool WasDeleted, JobFailure? Failure)
    {
        public static readonly Outcome Done = new(false, null);
        public static readonly Outcome DraftDeleted = new(true, null);
        public static Outcome Failed(JobFailure failure) => new(false, failure);
    }

    // ── Detection: one vision call per photo ───────────────────────────────────────────────────────────────────────

    private async Task<Outcome> DetectAsync(JobEntity job, ItemDraftEntity draft, ItemProcessRequestedEvent message, List<string> written, CancellationToken ct)
    {
        var raw = await storage.ReadAsync(StorageKeys.Upload(message.TenantId, message.DraftId), MaxImageBytes, ct);
        var clean = raw is null ? null : ImageMetadataStripper.Strip(raw);
        if (clean is null)
            return Outcome.Failed(JobFailure.SourceDeleted);

        // Keep the stripped original with the draft first: it survives a provider failure ("Orijinale dön", manual fill).
        var originalKey = StorageKeys.ItemOriginal(message.TenantId, message.DraftId, clean.Extension);
        await storage.PutAsync(originalKey, clean.Data, clean.ContentType, ct);
        written.Add(originalKey);
        draft.OriginalKey = originalKey;
        draft.Status = ItemDraftStatus.Processing;
        if (!await SaveExistingAsync(draft, ct))
        {
            await AbandonAsync(job, written, [], ct);
            return Outcome.DraftDeleted;
        }

        var photo = new ImageInput(clean.Data, clean.ContentType);
        var language = Localized.Language(draft.Language);
        // Ai:SpeculativeItemCleanup: the background removal of the whole photo starts together with the vision call. Most
        // photos hold one piece, and then its result is used as is (one model round trip less); for several pieces or a
        // small one (jewellery needs its crop) it is cancelled and the usual path runs — that image call is wasted.
        using var speculation = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var speculative = aiOptions.CurrentValue.SpeculativeItemCleanup
            ? cleanup.CleanupItemAsync(photo, null, null, speculation.Token)
            : null;
        IReadOnlyList<DetectedItem> items;
        try
        {
            items = ItemDetectionGuard.Filter(await detector.DetectItemsAsync(photo, language, ct), wardrobeOptions.CurrentValue.MaxDetectedItems);
        }
        catch
        {
            await CancelAsync(speculation, speculative);
            throw;
        }
        if (items.Count == 0)
        {
            await CancelAsync(speculation, speculative);
            return Outcome.Failed(JobFailure.GuardRejected);
        }

        var size = cropper.Measure(photo);
        draft.PhotoWidth = size?.Width;
        draft.PhotoHeight = size?.Height;
        if (items.Count > 1)
        {
            await CancelAsync(speculation, speculative);
            return await GroupAsync(job, draft, photo, size, items, language, written, ct);
        }
        return await SingleAsync(job, draft, photo, size, items[0], language, written, ct, speculation, speculative);
    }

    /// <summary>Stops a speculative cleanup that is not needed and waits for it, so its failure is never unobserved.</summary>
    private static async Task CancelAsync(CancellationTokenSource speculation, Task<ImageInput>? speculative)
    {
        if (speculative is null)
            return;
        await speculation.CancelAsync();
        try
        {
            await speculative;
        }
        catch (Exception)
        {
            // cancelled or failed: not used either way
        }
    }

    /// <summary>
    /// The speculative whole-photo cleanup stands in for the crop's cleanup when the one piece is not small (a small piece
    /// is cropped and enlarged first). A failed speculation falls back to the usual call.
    /// </summary>
    private async Task<ImageInput?> SpeculativeResultAsync(DetectedItem item, string? subcategory, CancellationTokenSource speculation, Task<ImageInput>? speculative)
    {
        if (speculative is null)
            return null;
        if (CropMath.IsSmall(item.Box, subcategory))
        {
            await CancelAsync(speculation, speculative);
            return null;
        }
        try
        {
            return await speculative;
        }
        catch (Exception ex) when (ex is AiProviderException or HttpRequestException)
        {
            logger.LogInformation("Item job: speculative cleanup failed ({Error}); cleaning the crop instead", ex.GetType().Name);
            return null;
        }
    }

    /// <summary>One piece: the review form opens directly, so its background is removed now (one image-model call).</summary>
    private async Task<Outcome> SingleAsync(JobEntity job, ItemDraftEntity draft, ImageInput photo, PixelSize? size, DetectedItem item, string language,
        List<string> written, CancellationToken ct, CancellationTokenSource? speculation = null, Task<ImageInput>? speculative = null)
    {
        var fields = ItemDetectionGuard.Fields(item, aiOptions.CurrentValue.VisionConfidenceThreshold);
        var subcategory = ItemDetectionGuard.Subcategory(item, fields.Category);
        var processed = speculation is null ? null : await SpeculativeResultAsync(item, subcategory, speculation, speculative);
        if (processed is null)
        {
            var input = size is { } pixels && !CropMath.UseWholePhoto(item.Box)
                ? cropper.Crop(photo, CropMath.Plan(item.Box, pixels, CropMath.IsSmall(item.Box, subcategory))) ?? photo
                : photo;
            processed = await cleanup.CleanupItemAsync(input, item.Garment.Category, subcategory, ct);
        }

        var processedKey = StorageKeys.ItemImage(job.TenantId, draft.Id);
        await storage.PutAsync(processedKey, processed.Data, processed.ContentType, ct);
        written.Add(processedKey);

        Apply(draft, fields, subcategory, item, language);
        draft.Kind = ItemDraftKind.Single;
        draft.ItemCount = 1;
        draft.ProcessedKey = processedKey;
        draft.Status = ItemDraftStatus.Ready;
        if (!await SaveExistingAsync(draft, ct))
        {
            await AbandonAsync(job, written, [], ct);
            return Outcome.DraftDeleted;
        }

        await jobs.CompleteAsync(job, StylingJson.Serialize(new { draftId = draft.Id, itemCount = 1, needsReview = fields.NeedsReview, flaggedFields = fields.FlaggedFields }), ct);
        return Outcome.Done;
    }

    /// <summary>Two or more pieces: a draft group. Each piece gets its plain crop only — no image-model call before the user selects it.</summary>
    private async Task<Outcome> GroupAsync(JobEntity job, ItemDraftEntity source, ImageInput photo, PixelSize? size, IReadOnlyList<DetectedItem> items,
        string language, List<string> written, CancellationToken ct)
    {
        if (size is not { } pixels)
            return Outcome.Failed(JobFailure.ProviderError); // the photo could not be decoded: nothing to crop

        var threshold = aiOptions.CurrentValue.VisionConfidenceThreshold;
        var pieces = new List<ItemDraftEntity>();
        try
        {
            await CutPiecesAsync();
        }
        catch
        {
            // A retried message cuts the pieces again: never leave half a group behind.
            foreach (var piece in pieces)
                await repository.DeleteAsync(piece.Pk, piece.Sk, ct);
            throw;
        }

        if (pieces.Count == 0)
            return Outcome.Failed(JobFailure.ProviderError);

        source.Kind = ItemDraftKind.Outfit;
        source.ItemCount = pieces.Count;
        source.Status = ItemDraftStatus.Ready; // the group: its pieces are what the user selects and confirms
        if (!await SaveExistingAsync(source, ct))
        {
            // The photo was deleted while its pieces were being cut out: the pieces go with it.
            await AbandonAsync(job, written, pieces, ct);
            return Outcome.DraftDeleted;
        }

        await jobs.CompleteAsync(job, StylingJson.Serialize(new
        {
            draftId = source.Id, groupId = source.Id, itemCount = pieces.Count, pieceDraftIds = pieces.Select(d => d.Id).ToList(),
        }), ct);
        return Outcome.Done;

        async Task CutPiecesAsync()
        {
            for (var index = 0; index < items.Count; index++)
            {
                var item = items[index];
                var fields = ItemDetectionGuard.Fields(item, threshold);
                var subcategory = ItemDetectionGuard.Subcategory(item, fields.Category);
                var crop = cropper.Crop(photo, CropMath.Plan(item.Box, pixels, CropMath.IsSmall(item.Box, subcategory)));
                if (crop is null)
                    continue;

                var now = timeProvider.GetUtcNow().UtcDateTime;
                var piece = new ItemDraftEntity
                {
                    Id = Ulid.New(now.AddMilliseconds(index)),
                    TenantId = job.TenantId,
                    Kind = ItemDraftKind.Piece,
                    Status = ItemDraftStatus.Detected,
                    RequestId = source.RequestId,
                    JobId = job.Id,
                    ParentDraftId = source.Id,
                    Index = pieces.Count + 1,
                    CreatedAt = now,
                    UpdatedAt = now,
                };
                var cropKey = StorageKeys.ItemOriginal(job.TenantId, piece.Id, "jpg");
                await storage.PutAsync(cropKey, crop.Data, crop.ContentType, ct);
                written.Add(cropKey);
                piece.OriginalKey = cropKey;
                Apply(piece, fields, subcategory, item, language);
                await repository.SaveAsync(piece, ct); // a new row: there is nothing the user could have deleted
                pieces.Add(piece);
            }
        }
    }

    // ── Background removal of a piece the user selected ─────────────────────────────────────────────────────────

    private async Task<Outcome> CleanAsync(JobEntity job, ItemDraftEntity piece, List<string> written, CancellationToken ct)
    {
        // The Api hands the crop over in the temporary upload slot of the piece (this worker may read nothing else).
        var crop = await storage.ReadAsync(StorageKeys.Upload(job.TenantId, piece.Id), MaxImageBytes, ct);
        if (crop is null)
            return Outcome.Failed(JobFailure.SourceDeleted);

        var hint = piece.Category is { } category && System.Enum.TryParse<ItemCategoryHint>(category.ToString(), out var parsed) ? parsed : (ItemCategoryHint?)null;
        var processed = await cleanup.CleanupItemAsync(new ImageInput(crop, "image/jpeg"), hint, piece.Subcategory, ct);
        var processedKey = StorageKeys.ItemImage(job.TenantId, piece.Id);
        await storage.PutAsync(processedKey, processed.Data, processed.ContentType, ct);
        written.Add(processedKey);

        piece.ProcessedKey = processedKey;
        piece.Status = ItemDraftStatus.Ready;
        piece.Failure = null;
        if (!await SaveExistingAsync(piece, ct))
        {
            await AbandonAsync(job, written, [], ct);
            return Outcome.DraftDeleted;
        }

        await jobs.CompleteAsync(job, StylingJson.Serialize(new { draftId = piece.Id }), ct);
        return Outcome.Done;
    }

    private static void Apply(ItemDraftEntity draft, GarmentDraftFields fields, string? subcategory, DetectedItem item, string language)
    {
        draft.Name = fields.Name;
        draft.Language = fields.Name is null ? null : language;
        draft.Category = fields.Category;
        draft.Subcategory = subcategory;
        draft.ColorIds = fields.ColorIds.ToList();
        draft.Fabric = fields.Fabric;
        draft.Seasons = fields.Seasons.ToList();
        draft.FlaggedFields = fields.FlaggedFields.ToList();
        draft.NeedsReview = fields.NeedsReview;
        draft.Box = item.Box;
        draft.Confidence = Math.Round(Math.Clamp(item.Confidence, 0, 1), 2);
        draft.Failure = null;
    }

    private async Task FinishAsync(JobEntity job, ItemDraftEntity draft, JobFailure failure, CancellationToken ct)
    {
        draft.Status = ItemDraftStatus.Failed;
        draft.Failure = failure;
        await SaveExistingAsync(draft, ct); // a deleted draft stays deleted
        await jobs.FailAsync(job, failure, ct);
    }

    /// <summary>The draft was deleted mid-processing: remove what this run wrote for it and close the job (no quota, no credit is consumed).</summary>
    private async Task AbandonAsync(JobEntity job, IReadOnlyList<string> writtenKeys, IReadOnlyList<ItemDraftEntity> pieceDrafts, CancellationToken ct)
    {
        foreach (var key in writtenKeys.Where(k => StorageKeys.BelongsToTenant(k, job.TenantId)))
            await storage.DeleteAsync(key, ct);
        foreach (var piece in pieceDrafts)
            await repository.DeleteAsync(piece.Pk, piece.Sk, ct);
        logger.LogInformation("Item job {JobId}: the draft was deleted during processing; nothing was kept", job.Id);
        await jobs.FailAsync(job, JobFailure.SourceDeleted, ct);
    }

    /// <summary>
    /// Conditional write (attribute_exists): false = the user deleted the draft in the meantime. An unconditional put
    /// here would bring the deleted draft — and its photo — back.
    /// </summary>
    private async Task<bool> SaveExistingAsync(ItemDraftEntity draft, CancellationToken ct)
    {
        draft.UpdatedAt = timeProvider.GetUtcNow().UtcDateTime;
        return (await repository.TransactWriteAsync([TransactWriteOperation.PutExisting(draft)], ct)).Applied;
    }
}
