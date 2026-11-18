using System.Text.Json;
using Domain.Enum;
using Domain.Events;
using Domain.Services;
using Domain.Services.Ai;
using Infrastructure.Serialization;
using Infrastructure.Workers;
using Microsoft.Extensions.Logging;

namespace ItemProcessor.Services;

public interface IItemProcessJobService
{
    Task ProcessAsync(ItemProcessRequestedEvent message, bool isLastAttempt, CancellationToken ct);
}

/// <summary>
/// Garment photo -> cleaned image + attribute suggestions (a draft). Never writes an Item: drafts become items only
/// through the user's confirm endpoint (E2).
/// </summary>
public sealed class ItemProcessJobService(
    IJobLifecycle jobs,
    IObjectStorage storage,
    IImageCleanup cleanup,
    IGarmentVision vision,
    ILogger<ItemProcessJobService> logger) : IItemProcessJobService
{
    private const long MaxImageBytes = 15 * 1024 * 1024;

    public async Task ProcessAsync(ItemProcessRequestedEvent message, bool isLastAttempt, CancellationToken ct)
    {
        var job = await jobs.StartAsync(message.TenantId, message.JobId, ct);
        if (job is null)
            return;

        try
        {
            var raw = await storage.ReadAsync(StorageKeys.Upload(message.TenantId, message.DraftId), MaxImageBytes, ct);
            var clean = raw is null ? null : ImageMetadataStripper.Strip(raw);
            if (clean is null)
            {
                await jobs.FailAsync(job, JobFailure.SourceDeleted, ct);
                return;
            }

            var processed = await cleanup.CleanupAsync(new ImageInput(clean.Data, clean.ContentType), ct);
            var suggestion = await vision.DescribeAsync(processed, ct);

            var processedKey = $"{StorageKeys.ItemsPrefix(message.TenantId)}{message.DraftId}.webp";
            await storage.PutAsync(processedKey, processed.Data, processed.ContentType, ct);
            await jobs.CompleteAsync(job, JsonSerializer.Serialize(new { draftId = message.DraftId, suggestion }, MessageSerializer.Options), ct);
        }
        catch (Exception ex) when (!WorkerFailure.IsRetryable(ex, isLastAttempt))
        {
            logger.LogWarning(ex, "Item process job {JobId} failed for tenant {TenantId}", job.Id, job.TenantId);
            await jobs.FailAsync(job, JobFailure.ProviderError, ct);
        }
    }
}
