using Domain.Entity;
using Domain.Enum;
using Domain.Events;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Domain.Services.Ai;
using Infrastructure.Workers;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace TryOn.Services;

public interface ILookCoverJobService
{
    Task ProcessAsync(LookCoverRequestedEvent message, bool isLastAttempt, CancellationToken ct);
}

/// <summary>
/// AI flat-lay cover of a saved look (canvas 21c, owner decision 2026-11-22). Renders only while the look still has the
/// pieces the cover was requested for (else the job completes as stale, no AI call), from the pieces' own images (item
/// images under the tenant prefix, global library / catalog images — never another tenant's, never a photo of a person).
/// The image goes to tenant/{tenantId}/look-cover/ and is recorded on LookCoverEntity — never on the look itself, so the
/// look's version (the app's edit base) is untouched. No credit; the cost is counted under look_cover. Any failure is
/// quiet: the cover row is marked Failed and the app keeps its drawn cover.
/// </summary>
public sealed class LookCoverJobService(
    IJobLifecycle jobs,
    IRepository repository,
    IObjectStorage storage,
    ILookCoverRenderer renderer,
    ICatalogProductLookup products,
    ILibraryCatalog library,
    IOptionsMonitor<AiOptions> aiOptions,
    TimeProvider timeProvider,
    ILogger<LookCoverJobService> logger) : ILookCoverJobService
{
    private const int MaxVersionRetries = 4;
    private readonly GarmentImageLoader garmentImages = new(repository, storage, products, library);

    public async Task ProcessAsync(LookCoverRequestedEvent message, bool isLastAttempt, CancellationToken ct)
    {
        var job = await jobs.StartAsync(message.TenantId, message.JobId, ct);
        if (job is null)
            return;

        try
        {
            var look = await LookAsync(message, ct);
            if (!IsCurrentRequest(look, message) || (await CoverAsync(message, ct))?.JobId != job.Id)
            {
                // Deleted, its pieces changed since, or a newer job owns the cover (pieces changed and changed back): nothing to render.
                await jobs.CompleteAsync(job, """{"stale":true}""", ct);
                return;
            }

            if (!aiOptions.CurrentValue.LookCover.Enabled || !renderer.IsConfigured)
            {
                logger.LogInformation("Look cover job {JobId}: skipped (look cover or AI off)", job.Id);
                await FailAsync(job, message, JobFailure.ProviderError, ct);
                return;
            }

            // Pieces without an image (deleted item, retired product) are left out; with none left there is nothing to lay out.
            var images = (await Task.WhenAll(look!.Slots.Select(s => garmentImages.LoadAsync(message.TenantId, new OutfitPiece(s.ItemId, s.ProductId), ct))))
                .OfType<ImageInput>().ToList();
            if (images.Count == 0)
            {
                await FailAsync(job, message, JobFailure.SourceDeleted, ct);
                return;
            }

            var output = await renderer.RenderFlatlayAsync(images, ct);
            var key = StorageKeys.LookCover(message.TenantId, message.LookId, message.SlotsHash);
            await storage.PutAsync(key, output.Data, output.ContentType, ct);

            if (await SetReadyAsync(message, key, ct))
            {
                await jobs.CompleteAsync(job, """{"ready":true}""", ct);
                return;
            }

            // The look was deleted or its pieces changed while the image was made: the image is nobody's.
            if ((await CoverAsync(message, ct))?.ImageKey != key)
                await storage.DeleteAsync(key, ct);
            await jobs.CompleteAsync(job, """{"stale":true}""", ct);
        }
        catch (Exception ex) when (!WorkerFailure.IsRetryable(ex, isLastAttempt))
        {
            logger.LogWarning(ex, "Look cover job {JobId} failed for tenant {TenantId}", job.Id, job.TenantId);
            await FailAsync(job, message, JobFailure.ProviderError, ct);
        }
    }

    private Task<LookEntity?> LookAsync(LookCoverRequestedEvent message, CancellationToken ct) =>
        repository.GetAsync<LookEntity>(LookEntity.GetPk(message.TenantId), LookEntity.GetSk(message.LookId), ct);

    private Task<LookCoverEntity?> CoverAsync(LookCoverRequestedEvent message, CancellationToken ct) =>
        repository.GetAsync<LookCoverEntity>(LookCoverEntity.GetPk(message.TenantId), LookCoverEntity.GetSk(message.LookId), ct);

    /// <summary>The look still exists, may have an AI cover and has exactly the pieces of this request.</summary>
    private static bool IsCurrentRequest(LookEntity? look, LookCoverRequestedEvent message) =>
        look is not null && LookCoverRules.IsEligible(look) && LookCoverRules.SlotsHash(look.Slots) == message.SlotsHash;

    /// <summary>
    /// Records the image when the look still has these pieces (re-read after the render); the previous image is deleted
    /// once the new one is recorded. False = the look or its cover row is gone, or the pieces changed.
    /// </summary>
    private async Task<bool> SetReadyAsync(LookCoverRequestedEvent message, string key, CancellationToken ct)
    {
        for (var attempt = 0; attempt < MaxVersionRetries; attempt++)
        {
            var cover = await CoverAsync(message, ct);
            if (cover is null || cover.SlotsHash != message.SlotsHash || !IsCurrentRequest(await LookAsync(message, ct), message))
                return false;

            var previous = cover.ImageKey;
            cover.Status = LookCoverStatus.Ready;
            cover.ImageKey = key;
            cover.ImageHash = message.SlotsHash;
            cover.UpdatedAt = timeProvider.GetUtcNow().UtcDateTime;
            // Versioned on the cover row only: a deleted row (look deleted) is never brought back.
            if (await repository.SaveIfVersionAsync(cover, cover.Version, ct))
            {
                if (previous is not null && previous != key && StorageKeys.BelongsToTenant(previous, message.TenantId))
                    await storage.DeleteAsync(previous, ct);
                return true;
            }
        }
        throw new InvalidOperationException($"Look cover of job {message.JobId} could not be recorded (concurrent writes).");
    }

    /// <summary>Fails the job and marks the cover row Failed when it is still this job's request (best effort).</summary>
    private async Task FailAsync(JobEntity job, LookCoverRequestedEvent message, JobFailure failure, CancellationToken ct)
    {
        try
        {
            for (var attempt = 0; attempt < MaxVersionRetries; attempt++)
            {
                var cover = await CoverAsync(message, ct);
                if (cover is null || cover.JobId != job.Id || cover.Status != LookCoverStatus.Pending)
                    break;
                cover.Status = LookCoverStatus.Failed;
                cover.UpdatedAt = timeProvider.GetUtcNow().UtcDateTime;
                if (await repository.SaveIfVersionAsync(cover, cover.Version, ct))
                    break;
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Look cover job {JobId}: cover row not marked failed", job.Id);
        }
        await jobs.FailAsync(job, failure, ct);
    }
}
