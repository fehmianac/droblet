using Domain.Entity;
using Domain.Enum;
using Domain.Events;
using Domain.Extensions;
using Domain.Manager;
using Domain.Services;
using Domain.Services.Ai;
using Domain.Services.Styling;
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
    ICatalogProductLookup products,
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

            // Garment images: the tenant's own item images or global catalog images — never another tenant's.
            var garments = await GarmentsAsync(job, ct);
            if (garments is null)
            {
                await jobs.FailAsync(job, JobFailure.SourceDeleted, ct);
                return;
            }

            var output = await renderer.RenderAsync(new ImageInput(bytes, body.ContentType), garments, ct);

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

    /// <summary>null = a piece of the outfit (or its image) no longer exists. A job without input renders the body photo alone.</summary>
    private async Task<IReadOnlyList<ImageInput>?> GarmentsAsync(JobEntity job, CancellationToken ct)
    {
        var pieces = StylingJson.TryDeserialize<TryOnJobInput>(job.Input)?.Pieces ?? [];
        var garments = new List<ImageInput>(pieces.Count);
        foreach (var piece in pieces)
        {
            ImageInput? image = null;
            if (piece.ItemId is not null)
            {
                var item = await repository.GetAsync<ItemEntity>(ItemEntity.GetPk(job.TenantId), ItemEntity.GetSk(piece.ItemId), ct);
                var key = item is { UseOriginalImage: true, OriginalImageKey: not null } ? item.OriginalImageKey : item?.ImageKey ?? item?.OriginalImageKey;
                if (key is not null && StorageKeys.BelongsToTenant(key, job.TenantId) && await storage.ReadAsync(key, MaxImageBytes, ct) is { } data)
                    image = new ImageInput(data, key.EndsWith(".webp", StringComparison.Ordinal) ? "image/webp" : key.EndsWith(".png", StringComparison.Ordinal) ? "image/png" : "image/jpeg");
                // A piece added from the ready library or the catalog has no own photo: its image is the global
                // https asset (GlobalImageKey), fetched with the same allow-listed downloader as catalog products.
                else if (key is null && item?.GlobalImageKey is { } global && global.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                    image = await products.ReadImageAsync(
                        new ProductSnapshot(item.Id, item.Name ?? "", null, null, item.Category, item.ColorIds, item.Fabric, item.Seasons, global, false), ct);
            }
            else if (piece.ProductId is not null && await products.GetAsync(piece.ProductId, ct) is { } product)
            {
                image = await products.ReadImageAsync(product, ct);
            }

            if (image is null)
                return null;
            garments.Add(image);
        }
        return garments;
    }

    private async Task<PhotoEntity?> ActiveBodyPhotoAsync(string tenantId, string photoId, CancellationToken ct)
    {
        var photo = await repository.GetAsync<PhotoEntity>(PhotoEntity.GetPk(tenantId), PhotoEntity.GetSk(PhotoKind.Body, photoId), ct);
        return photo is { Active: true } && StorageKeys.BelongsToTenant(photo.S3Key, tenantId) ? photo : null;
    }
}
