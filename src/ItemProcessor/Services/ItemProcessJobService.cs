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
/// Garment photo -> cleaned image + attribute suggestions on the ItemDraft (GarmentVisionGuard decides what is kept
/// and what is flagged). "Split" jobs cut one outfit photo into one draft per piece.
/// Never writes an Item: drafts become items only through the user's confirm endpoint.
/// On failure the EXIF-stripped original stays with the (Failed) draft so the user can fill the fields by hand.
/// Everything is written under the message's tenant prefix only; nothing here ever reaches a global cache.
/// </summary>
public sealed class ItemProcessJobService(
    IJobLifecycle jobs,
    IRepository repository,
    IObjectStorage storage,
    IImageCleanup cleanup,
    IGarmentVision vision,
    IOutfitSplitter splitter,
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
            var raw = await storage.ReadAsync(StorageKeys.Upload(message.TenantId, message.DraftId), MaxImageBytes, ct);
            var clean = raw is null ? null : ImageMetadataStripper.Strip(raw);
            if (clean is null)
            {
                await FinishAsync(job, draft, JobFailure.SourceDeleted, ct);
                return;
            }

            // Keep the stripped original with the draft first: it survives a provider failure ("Orijinale dön", manual fill).
            var originalKey = StorageKeys.ItemOriginal(message.TenantId, message.DraftId, clean.Extension);
            await storage.PutAsync(originalKey, clean.Data, clean.ContentType, ct);
            written.Add(originalKey);
            draft.OriginalKey = originalKey;
            draft.Status = ItemDraftStatus.Processing;
            if (!await SaveExistingAsync(draft, ct))
            {
                await AbandonAsync(job, written, [], ct);
                return;
            }

            var photo = new ImageInput(clean.Data, clean.ContentType);
            var language = Localized.Language(draft.Language);
            var outcome = message.Split
                ? await SplitAsync(job, draft, photo, language, written, ct)
                : await DescribeAsync(job, draft, photo, language, written, ct);
            if (outcome.WasDeleted)
                return;
            if (outcome.Failure is { } failure)
                await FinishAsync(job, draft, failure, ct);
        }
        catch (Exception ex) when (!WorkerFailure.IsRetryable(ex, isLastAttempt))
        {
            logger.LogWarning(ex, "Item process job {JobId} failed for tenant {TenantId}", job.Id, job.TenantId);
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

    private async Task<Outcome> DescribeAsync(JobEntity job, ItemDraftEntity draft, ImageInput photo, string language, List<string> written, CancellationToken ct)
    {
        var processed = await cleanup.CleanupAsync(photo, ct);
        var suggestion = await vision.DescribeAsync(processed, language, ct);
        if (!GarmentVisionGuard.HasGarment(suggestion))
            return Outcome.Failed(JobFailure.GuardRejected);

        var fields = GarmentVisionGuard.Apply(suggestion, aiOptions.CurrentValue.VisionConfidenceThreshold);
        var processedKey = StorageKeys.ItemImage(job.TenantId, draft.Id);
        await storage.PutAsync(processedKey, processed.Data, processed.ContentType, ct);
        written.Add(processedKey);

        Apply(draft, fields, processedKey, language);
        if (!await SaveExistingAsync(draft, ct))
        {
            await AbandonAsync(job, written, [], ct);
            return Outcome.DraftDeleted;
        }

        await jobs.CompleteAsync(job, StylingJson.Serialize(new { draftId = draft.Id, needsReview = fields.NeedsReview, flaggedFields = fields.FlaggedFields }), ct);
        return Outcome.Done;
    }

    private async Task<Outcome> SplitAsync(JobEntity job, ItemDraftEntity source, ImageInput photo, string language, List<string> written, CancellationToken ct)
    {
        var pieces = (await splitter.DetectPiecesAsync(photo, language, ct))
            .Where(GarmentVisionGuard.HasGarment)
            .Take(Math.Max(1, wardrobeOptions.CurrentValue.MaxSplitPieces))
            .ToList();
        if (pieces.Count == 0)
            return Outcome.Failed(JobFailure.GuardRejected);

        var threshold = aiOptions.CurrentValue.VisionConfidenceThreshold;
        var pieceDrafts = new List<ItemDraftEntity>();
        foreach (var piece in pieces)
        {
            var image = await splitter.ExtractPieceAsync(photo, piece, ct);
            var now = timeProvider.GetUtcNow().UtcDateTime;
            var draft = new ItemDraftEntity
            {
                Id = Ulid.New(now),
                TenantId = job.TenantId,
                Kind = ItemDraftKind.Piece,
                RequestId = source.RequestId,
                JobId = job.Id,
                ParentDraftId = source.Id,
                CreatedAt = now,
                UpdatedAt = now,
            };
            var key = StorageKeys.ItemImage(job.TenantId, draft.Id);
            await storage.PutAsync(key, image.Data, image.ContentType, ct);
            written.Add(key);
            Apply(draft, GarmentVisionGuard.Apply(piece, threshold), key, language);
            await repository.SaveAsync(draft, ct); // a new row: there is nothing the user could have deleted
            pieceDrafts.Add(draft);
        }

        source.Status = ItemDraftStatus.Ready; // consumed: its pieces are the drafts the user confirms
        if (!await SaveExistingAsync(source, ct))
        {
            // The outfit photo was deleted while its pieces were being cut out: the pieces go with it.
            await AbandonAsync(job, written, pieceDrafts, ct);
            return Outcome.DraftDeleted;
        }

        await jobs.CompleteAsync(job, StylingJson.Serialize(new { draftId = source.Id, pieceDraftIds = pieceDrafts.Select(d => d.Id).ToList() }), ct);
        return Outcome.Done;
    }

    private static void Apply(ItemDraftEntity draft, GarmentDraftFields fields, string processedKey, string language)
    {
        draft.ProcessedKey = processedKey;
        draft.Name = fields.Name;
        draft.Language = fields.Name is null ? null : language;
        draft.Category = fields.Category;
        draft.ColorIds = fields.ColorIds.ToList();
        draft.Fabric = fields.Fabric;
        draft.Seasons = fields.Seasons.ToList();
        draft.FlaggedFields = fields.FlaggedFields.ToList();
        draft.NeedsReview = fields.NeedsReview;
        draft.Status = ItemDraftStatus.Ready;
    }

    private async Task FinishAsync(JobEntity job, ItemDraftEntity draft, JobFailure failure, CancellationToken ct)
    {
        draft.Status = ItemDraftStatus.Failed;
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
        logger.LogInformation("Item process job {JobId}: the draft was deleted during processing; nothing was kept", job.Id);
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
