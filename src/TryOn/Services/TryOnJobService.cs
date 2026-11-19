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
/// "Üzerimde gör". Output goes only to tenant/{tenantId}/tryon/, only if the source photo (body photo, or the face photo
/// on the face path) is still active at write time (TryOnOutputPolicy), and never to a global cache. Before a photo's
/// first render it passes the server-side photo check. Any failure refunds the reserved credit.
/// </summary>
public sealed class TryOnJobService(
    IJobLifecycle jobs,
    IRepository repository,
    IObjectStorage storage,
    ITryOnRenderer renderer,
    IPhotoInspector inspector,
    ICatalogProductLookup products,
    ILibraryCatalog library,
    Microsoft.Extensions.Options.IOptionsMonitor<Domain.Options.AiOptions> aiOptions,
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
            // Body path: the body photo. Face path (no body photo): the face photo + body type + height / size.
            var face = message.Source == TryOnSource.Face;
            var (kind, photoId) = face ? (PhotoKind.Face, message.FacePhotoId ?? "") : (PhotoKind.Body, message.BodyPhotoId);
            // Garment images (the tenant's own item images or global catalog images — never another tenant's) load in
            // parallel with the source photo and its photo check; the image edit starts only once the check passed.
            var garmentsRead = GarmentsAsync(job, ct);
            var source = await ActivePhotoAsync(message.TenantId, kind, photoId, ct);
            var bytes = source is null ? null : await storage.ReadAsync(source.S3Key, MaxImageBytes, ct);
            if (source is null || bytes is null)
            {
                await Observe(garmentsRead);
                await jobs.FailAsync(job, JobFailure.SourceDeleted, ct);
                return;
            }

            var photo = new ImageInput(bytes, source.ContentType);
            var inspection = InspectAsync(job, source, photo, ct);
            await Task.WhenAll(inspection, garmentsRead);
            if (inspection.Result is { } rejected)
            {
                await jobs.FailAsync(job, rejected, ct);
                return;
            }

            var garments = garmentsRead.Result;
            if (garments is null)
            {
                await jobs.FailAsync(job, JobFailure.SourceDeleted, ct);
                return;
            }

            // Ai:Image:TryOnPreview: a fast low-quality image first (the job completes with it), the full one replaces it after.
            var preview = aiOptions.CurrentValue.Image is { TryOnPreview: true } imageOptions ? imageOptions.PreviewQuality : null;
            var figure = new TryOnFigure(message.BodyType ?? BodyType.Unsure, message.HeightCm, message.Size);
            Task<ImageInput> Render(string? quality) => face
                ? renderer.RenderFromFaceAsync(photo, garments, figure, ct, quality)
                : renderer.RenderAsync(photo, garments, ct, quality);
            var output = await Render(preview);

            // The user may have deleted/replaced the source photo while the provider was working.
            if (await ActivePhotoAsync(message.TenantId, kind, photoId, ct) is null)
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
                Source = message.Source,
                SourcePhotoId = source.Id,
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

            if (preview is not null)
                await ReplacePreviewAsync(job, image, kind, photoId, () => Render(null), ct);
        }
        catch (Exception ex) when (!WorkerFailure.IsRetryable(ex, isLastAttempt))
        {
            logger.LogWarning(ex, "Try-on job {JobId} failed for tenant {TenantId}", job.Id, job.TenantId);
            await jobs.FailAsync(job, JobFailure.ProviderError, ct);
        }
    }

    /// <summary>
    /// After a preview: the full-quality render replaces the image under the same key (the next presigned GET serves it).
    /// Best effort — the job already completed with the preview; nothing is written when the source photo or the image is
    /// gone meanwhile.
    /// </summary>
    private async Task ReplacePreviewAsync(JobEntity job, TryOnImageEntity image, PhotoKind kind, string photoId, Func<Task<ImageInput>> render, CancellationToken ct)
    {
        try
        {
            var full = await render();
            if (await ActivePhotoAsync(job.TenantId, kind, photoId, ct) is null
                || await repository.GetAsync<TryOnImageEntity>(image.Pk, image.Sk, ct) is null)
                return;
            await storage.PutAsync(image.S3Key, full.Data, full.ContentType, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Try-on job {JobId}: the full-quality image did not replace the preview", job.Id);
        }
    }

    private static async Task Observe(Task task)
    {
        try
        {
            await task;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // The job fails for another reason; this read's own error does not matter.
        }
    }

    /// <summary>null = a piece of the outfit (or its image) no longer exists. A job without input renders the body photo alone.</summary>
    private async Task<IReadOnlyList<ImageInput>?> GarmentsAsync(JobEntity job, CancellationToken ct)
    {
        var pieces = StylingJson.TryDeserialize<TryOnJobInput>(job.Input)?.Pieces ?? [];
        // Every piece in parallel (DynamoDB + S3 / https downloads); the order of the pieces is kept.
        var images = await Task.WhenAll(pieces.Select(piece => GarmentAsync(job, piece, ct)));
        return images.Any(i => i is null) ? null : images.Select(i => i!).ToList();
    }

    private async Task<ImageInput?> GarmentAsync(JobEntity job, OutfitPiece piece, CancellationToken ct)
    {
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
                else if (key is null && item is not null && await GlobalImageAsync(item, ct) is { } global)
                    image = await products.ReadImageAsync(
                        new ProductSnapshot(item.Id, item.Name ?? "", null, null, item.Category, item.ColorIds, item.Fabric, item.Seasons, global, false), ct);
            }
            else if (piece.ProductId is not null && await products.GetAsync(piece.ProductId, ct) is { } product)
            {
                image = await products.ReadImageAsync(product, ct);
            }
            else if (piece.LibraryItemId is not null
                     && (await library.GetAllAsync(ct)).FirstOrDefault(l => l.Id == piece.LibraryItemId) is { } libraryItem
                     && LibraryItemImageRules.IsResolvable(libraryItem.ImageKey))
            {
                // A ready-library piece the stylist picked for a thin wardrobe (not added yet): its global https image.
                image = await products.ReadImageAsync(new ProductSnapshot(libraryItem.Id, libraryItem.Name.GetValueOrDefault("tr") ?? "", null, null,
                    libraryItem.Category, libraryItem.ColorIds, libraryItem.Fabric, libraryItem.Seasons, libraryItem.ImageKey, false), ct);
            }

            return image;
        }
    }

    /// <summary>
    /// The piece's global https image. Run-on-read fallback for pieces added from the library before its images existed
    /// (GlobalImageKey still the seed placeholder): the library item's current image is used instead. The stored piece is
    /// not rewritten here (a worker never writes user items); ops migrate-library-item-images fixes the rows once.
    /// </summary>
    private async Task<string?> GlobalImageAsync(ItemEntity item, CancellationToken ct)
    {
        if (LibraryItemImageRules.IsResolvable(item.GlobalImageKey))
            return item.GlobalImageKey;
        if (!LibraryItemImageRules.NeedsLibraryImage(item))
            return null;
        var source = await repository.GetAsync<LibraryItemEntity>(LibraryItemEntity.GetPk(), LibraryItemEntity.GetSk(item.LibraryItemId!), ct);
        return LibraryItemImageRules.CurrentImageFor(item, source);
    }

    private async Task<PhotoEntity?> ActivePhotoAsync(string tenantId, PhotoKind kind, string photoId, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(photoId))
            return null;
        var photo = await repository.GetAsync<PhotoEntity>(PhotoEntity.GetPk(tenantId), PhotoEntity.GetSk(kind, photoId), ct);
        return photo is { Active: true } && StorageKeys.BelongsToTenant(photo.S3Key, tenantId) ? photo : null;
    }

    /// <summary>
    /// The server-side photo check, once per photo before its first try-on (canvas 11 "Fotoğraf uygun değil"). A rejected
    /// photo is removed (the user is asked for another one) and the job fails with PhotoUnsuitable + the issue in the
    /// result, so no credit is charged. A photo of someone who appears to be under 18 fails the job (GuardRejected).
    /// Returns null when the photo may be used.
    /// </summary>
    private async Task<JobFailure?> InspectAsync(JobEntity job, PhotoEntity photo, ImageInput image, CancellationToken ct)
    {
        if (photo.InspectedAt is not null || !inspector.IsConfigured)
            return null;

        var inspection = await inspector.InspectAsync(image, photo.Kind, ct);
        if (inspection.AppearsMinor)
            return JobFailure.GuardRejected;

        if (TryOnRules.IssueOf(photo.Kind, inspection) is { } issue)
        {
            job.Result = StylingJson.Serialize(new { photoIssue = issue, photoKind = photo.Kind });
            await repository.DeleteAsync(photo.Pk, photo.Sk, ct);
            if (StorageKeys.BelongsToTenant(photo.S3Key, job.TenantId))
                await storage.DeleteAsync(photo.S3Key, ct);
            logger.LogInformation("Try-on job {JobId}: {Kind} photo rejected by the photo check ({Issue})", job.Id, photo.Kind, issue);
            return JobFailure.PhotoUnsuitable;
        }

        photo.InspectedAt = timeProvider.GetUtcNow().UtcDateTime;
        await repository.SaveAsync(photo, ct);
        return null;
    }
}
