using Domain.Entity;
using Domain.Enum;
using Domain.Events;
using Domain.Extensions;
using Domain.Manager;
using Domain.Services;
using Domain.Services.Ai;
using Infrastructure.Workers;
using Microsoft.Extensions.Logging;

namespace TryOn.Services;

public interface ITryOnJobService
{
    Task ProcessAsync(TryOnRequestedEvent message, bool isLastAttempt, CancellationToken ct);
}

/// <summary>
/// "Üzerimde gör". Output goes only to tenant/{tenantId}/tryon/, only if the source body photo is still active at
/// write time (TryOnOutputPolicy), and never to a global cache. Any failure refunds the reserved credit.
/// </summary>
public sealed class TryOnJobService(
    IJobLifecycle jobs,
    IRepository repository,
    IObjectStorage storage,
    ITryOnRenderer renderer,
    TimeProvider timeProvider,
    ILogger<TryOnJobService> logger) : ITryOnJobService
{
    private const long MaxImageBytes = 15 * 1024 * 1024;

    public async Task ProcessAsync(TryOnRequestedEvent message, bool isLastAttempt, CancellationToken ct)
    {
        var job = await jobs.StartAsync(message.TenantId, message.JobId, ct);
        if (job is null)
            return;

        try
        {
            var body = await ActiveBodyPhotoAsync(message.TenantId, message.BodyPhotoId, ct);
            var bytes = body is null ? null : await storage.ReadAsync(body.S3Key, MaxImageBytes, ct);
            if (body is null || bytes is null)
            {
                await jobs.FailAsync(job, JobFailure.SourceDeleted, ct);
                return;
            }

            var output = await renderer.RenderAsync(new ImageInput(bytes, body.ContentType), [], ct);

            // The user may have deleted/replaced the body photo while the provider was working.
            if (await ActiveBodyPhotoAsync(message.TenantId, message.BodyPhotoId, ct) is null)
            {
                await jobs.FailAsync(job, JobFailure.SourceDeleted, ct);
                return;
            }

            var now = timeProvider.GetUtcNow().UtcDateTime;
            var image = new TryOnImageEntity
            {
                Id = Ulid.New(now),
                TenantId = message.TenantId,
                BodyPhotoId = message.BodyPhotoId,
                TargetKind = message.Target.Kind,
                TargetId = message.Target.Id,
                TargetVersion = message.Target.Version,
                JobId = job.Id,
                CreatedAt = now,
            };
            image.S3Key = $"{StorageKeys.TryOnPrefix(message.TenantId)}{image.Id}.webp";
            await storage.PutAsync(image.S3Key, output.Data, output.ContentType, ct);
            await repository.SaveAsync(image, ct);
            await jobs.CompleteAsync(job, $$"""{"tryOnImageId":"{{image.Id}}"}""", ct);
        }
        catch (Exception ex) when (!WorkerFailure.IsRetryable(ex, isLastAttempt))
        {
            logger.LogWarning(ex, "Try-on job {JobId} failed for tenant {TenantId}", job.Id, job.TenantId);
            await jobs.FailAsync(job, JobFailure.ProviderError, ct);
        }
    }

    private async Task<PhotoEntity?> ActiveBodyPhotoAsync(string tenantId, string photoId, CancellationToken ct)
    {
        var photo = await repository.GetAsync<PhotoEntity>(PhotoEntity.GetPk(tenantId), PhotoEntity.GetSk(PhotoKind.Body, photoId), ct);
        return photo is { Active: true } && StorageKeys.BelongsToTenant(photo.S3Key, tenantId) ? photo : null;
    }
}
