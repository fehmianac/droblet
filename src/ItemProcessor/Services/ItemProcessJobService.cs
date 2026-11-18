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
            if (draft is not null)
            {
                draft.OriginalKey = originalKey;
                draft.Status = ItemDraftStatus.Processing;
                await SaveAsync(draft, ct);
            }

            var photo = new ImageInput(clean.Data, clean.ContentType);
            var language = Localized.Language(draft?.Language);
            var failure = message.Split
                ? await SplitAsync(job, draft, photo, language, ct)
                : await DescribeAsync(job, draft, photo, language, ct);
            if (failure is not null)
                await FinishAsync(job, draft, failure.Value, ct);
        }
        catch (Exception ex) when (!WorkerFailure.IsRetryable(ex, isLastAttempt))
        {
            logger.LogWarning(ex, "Item process job {JobId} failed for tenant {TenantId}", job.Id, job.TenantId);
            await FinishAsync(job, draft, JobFailure.ProviderError, ct);
        }
    }

    private async Task<JobFailure?> DescribeAsync(JobEntity job, ItemDraftEntity? draft, ImageInput photo, string language, CancellationToken ct)
    {
        var processed = await cleanup.CleanupAsync(photo, ct);
        var suggestion = await vision.DescribeAsync(processed, language, ct);
        if (!GarmentVisionGuard.HasGarment(suggestion))
            return JobFailure.GuardRejected;

        var fields = GarmentVisionGuard.Apply(suggestion, aiOptions.CurrentValue.VisionConfidenceThreshold);
        var draftId = draft?.Id ?? job.Id;
        var processedKey = StorageKeys.ItemImage(job.TenantId, draftId);
        await storage.PutAsync(processedKey, processed.Data, processed.ContentType, ct);

        if (draft is not null)
        {
            Apply(draft, fields, processedKey, language);
            await SaveAsync(draft, ct);
        }

        await jobs.CompleteAsync(job, StylingJson.Serialize(new { draftId, needsReview = fields.NeedsReview, flaggedFields = fields.FlaggedFields }), ct);
        return null;
    }

    private async Task<JobFailure?> SplitAsync(JobEntity job, ItemDraftEntity? source, ImageInput photo, string language, CancellationToken ct)
    {
        var pieces = (await splitter.DetectPiecesAsync(photo, language, ct))
            .Where(GarmentVisionGuard.HasGarment)
            .Take(Math.Max(1, wardrobeOptions.CurrentValue.MaxSplitPieces))
            .ToList();
        if (pieces.Count == 0)
            return JobFailure.GuardRejected;

        var threshold = aiOptions.CurrentValue.VisionConfidenceThreshold;
        var pieceIds = new List<string>();
        foreach (var piece in pieces)
        {
            var image = await splitter.ExtractPieceAsync(photo, piece, ct);
            var now = timeProvider.GetUtcNow().UtcDateTime;
            var draft = new ItemDraftEntity
            {
                Id = Ulid.New(now),
                TenantId = job.TenantId,
                Kind = ItemDraftKind.Piece,
                RequestId = source?.RequestId,
                JobId = job.Id,
                ParentDraftId = source?.Id,
                CreatedAt = now,
            };
            var key = StorageKeys.ItemImage(job.TenantId, draft.Id);
            await storage.PutAsync(key, image.Data, image.ContentType, ct);
            Apply(draft, GarmentVisionGuard.Apply(piece, threshold), key, language);
            await SaveAsync(draft, ct);
            pieceIds.Add(draft.Id);
        }

        if (source is not null)
        {
            source.Status = ItemDraftStatus.Ready; // consumed: its pieces are the drafts the user confirms
            await SaveAsync(source, ct);
        }

        await jobs.CompleteAsync(job, StylingJson.Serialize(new { draftId = source?.Id, pieceDraftIds = pieceIds }), ct);
        return null;
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

    private async Task FinishAsync(JobEntity job, ItemDraftEntity? draft, JobFailure failure, CancellationToken ct)
    {
        if (draft is not null)
        {
            draft.Status = ItemDraftStatus.Failed;
            await SaveAsync(draft, ct);
        }
        await jobs.FailAsync(job, failure, ct);
    }

    private Task SaveAsync(ItemDraftEntity draft, CancellationToken ct)
    {
        draft.UpdatedAt = timeProvider.GetUtcNow().UtcDateTime;
        return repository.SaveAsync(draft, ct);
    }
}
