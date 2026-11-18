using Domain.Entity;
using Domain.Enum;
using Domain.Extensions;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Infrastructure.Services;

/// <summary>
/// Body/face photos. Upload goes to uploads/tmp/{tenantId}/ via presigned POST; activation validates magic bytes,
/// strips EXIF/XMP and writes the clean copy under tenant/{tenantId}/{body|face}/. One active photo per kind:
/// replacing the body photo deletes try-on images derived from the old one. Keys and URLs are never logged.
/// </summary>
public sealed class PhotoService(
    IRepository repository,
    IObjectStorage storage,
    IOptionsMonitor<PhotoOptions> options,
    TimeProvider timeProvider,
    ILogger<PhotoService> logger) : IPhotoService
{
    private DateTime Now => timeProvider.GetUtcNow().UtcDateTime;

    public async Task<PhotoUploadSlot> CreateUploadAsync(string tenantId, PhotoKind kind, string contentType, CancellationToken ct)
    {
        var settings = options.CurrentValue;
        var now = Now;
        var uploadId = Ulid.New(now);
        var key = StorageKeys.Upload(tenantId, uploadId);

        var upload = await storage.CreateUploadAsync(key, contentType, settings.MaxUploadBytes, TimeSpan.FromSeconds(settings.UploadUrlTtlSeconds), ct);
        await repository.SaveAsync(new PhotoUploadEntity
        {
            UploadId = uploadId,
            TenantId = tenantId,
            Kind = kind,
            ContentType = contentType,
            S3Key = key,
            CreatedAt = now,
        }, ct);

        return new PhotoUploadSlot(uploadId, upload, settings.MaxUploadBytes);
    }

    public async Task<ActivatePhotoResult> ActivateAsync(string tenantId, PhotoKind kind, string uploadId, string clientMutationId, CancellationToken ct)
    {
        var receipt = await repository.GetAsync<MutationReceiptEntity>(MutationReceiptEntity.GetPk(tenantId), MutationReceiptEntity.GetSk(clientMutationId), ct);
        if (receipt is not null)
            return new ActivatePhotoResult(ActivatePhotoOutcome.AlreadyApplied, await GetActiveAsync(tenantId, kind, ct));

        var upload = await repository.GetAsync<PhotoUploadEntity>(PhotoUploadEntity.GetPk(tenantId), PhotoUploadEntity.GetSk(uploadId), ct);
        if (upload is null)
            return new ActivatePhotoResult(ActivatePhotoOutcome.UploadNotFound);
        if (upload.Kind != kind)
            return new ActivatePhotoResult(ActivatePhotoOutcome.KindMismatch);

        var settings = options.CurrentValue;
        var head = await storage.HeadAsync(upload.S3Key, ct);
        if (head is null)
            return new ActivatePhotoResult(ActivatePhotoOutcome.UploadMissing);
        if (head.SizeBytes > settings.MaxUploadBytes)
        {
            await DiscardUploadAsync(upload, ct);
            return new ActivatePhotoResult(ActivatePhotoOutcome.TooLarge);
        }

        var raw = await storage.ReadAsync(upload.S3Key, settings.MaxUploadBytes, ct);
        var clean = raw is null ? null : ImageMetadataStripper.Strip(raw);
        if (clean is null || !settings.AllowedContentTypes.Contains(clean.ContentType))
        {
            await DiscardUploadAsync(upload, ct);
            return new ActivatePhotoResult(ActivatePhotoOutcome.UnsupportedImage);
        }

        var now = Now;
        var photo = new PhotoEntity
        {
            Id = Ulid.New(now),
            TenantId = tenantId,
            Kind = kind,
            ContentType = clean.ContentType,
            SizeBytes = clean.Data.Length,
            Active = true,
            CreatedAt = now,
        };
        photo.S3Key = StorageKeys.Photo(tenantId, kind, photo.Id, clean.Extension);
        await storage.PutAsync(photo.S3Key, clean.Data, clean.ContentType, ct);

        var previous = await repository.GetAllAsync<PhotoEntity>(PhotoEntity.GetPk(tenantId), PhotoEntity.KindPrefix(kind), SkOperator.BeginsWith, ct);

        var operations = new List<TransactWriteOperation>
        {
            TransactWriteOperation.Create(new MutationReceiptEntity { TenantId = tenantId, ClientMutationId = clientMutationId, CreatedAt = now }),
            TransactWriteOperation.Put(photo),
            TransactWriteOperation.Delete(upload.Pk, upload.Sk),
        };
        operations.AddRange(previous.Select(p => TransactWriteOperation.Delete(p.Pk, p.Sk)));

        var result = await repository.TransactWriteAsync(operations, ct);
        if (!result.Applied)
        {
            await storage.DeleteAsync(photo.S3Key, ct);
            return new ActivatePhotoResult(ActivatePhotoOutcome.AlreadyApplied, await GetActiveAsync(tenantId, kind, ct));
        }

        await storage.DeleteAsync(upload.S3Key, ct);
        foreach (var old in previous)
            await storage.DeleteAsync(old.S3Key, ct);
        await CleanupDerivedAsync(tenantId, kind, previous.Select(p => p.Id).ToHashSet(), ct);

        logger.LogInformation("Activated {Kind} photo {PhotoId} for tenant {TenantId}", kind, photo.Id, tenantId);
        return new ActivatePhotoResult(ActivatePhotoOutcome.Activated, await ToViewAsync(photo, ct));
    }

    public async Task<IReadOnlyList<PhotoView>> GetActiveAsync(string tenantId, CancellationToken ct)
    {
        var photos = await repository.GetAllAsync<PhotoEntity>(PhotoEntity.GetPk(tenantId), ct);
        var views = new List<PhotoView>();
        foreach (var photo in photos.Where(p => p.Active && StorageKeys.BelongsToTenant(p.S3Key, tenantId)))
            views.Add(await ToViewAsync(photo, ct));
        return views;
    }

    public async Task DeleteAllAsync(string tenantId, CancellationToken ct)
    {
        // Pending photo uploads still sit in uploads/tmp/: remove those objects too.
        var uploads = await repository.GetAllAsync<PhotoUploadEntity>(PhotoUploadEntity.GetPk(tenantId), ct);
        foreach (var upload in uploads.Where(u => StorageKeys.BelongsToTenant(u.S3Key, tenantId)))
            await storage.DeleteAsync(upload.S3Key, ct);

        foreach (var prefix in DeletionPlan.PhotoS3Prefixes(tenantId))
            await storage.DeletePrefixAsync(prefix, ct);

        foreach (var pk in DeletionPlan.PhotoPartitionKeys(tenantId))
        {
            var keys = await repository.GetKeysAsync(pk, ct);
            if (keys.Count > 0)
                await repository.BatchDeleteKeysAsync(keys, ct);
        }

        logger.LogInformation("Deleted photos and generated images for tenant {TenantId}", tenantId);
    }

    public async Task<bool> DeleteAsync(string tenantId, PhotoKind kind, string photoId, CancellationToken ct)
    {
        var photos = await repository.GetAllAsync<PhotoEntity>(PhotoEntity.GetPk(tenantId), PhotoEntity.KindPrefix(kind), SkOperator.BeginsWith, ct);
        var photo = photos.FirstOrDefault(p => p.Active && string.Equals(p.Id, photoId, StringComparison.Ordinal));
        if (photo is null)
            return false;

        await repository.DeleteAsync(photo.Pk, photo.Sk, ct);
        if (StorageKeys.BelongsToTenant(photo.S3Key, tenantId))
            await storage.DeleteAsync(photo.S3Key, ct);

        if (kind == PhotoKind.Body)
        {
            // The try-on images rendered on this body photo go with it (same rule as replacing the photo).
            await CleanupDerivedAsync(tenantId, kind, [photo.Id], ct);
        }
        else
        {
            // Same as "delete my photos": the palette result derived from the face photo is removed, not just detached.
            var palette = await repository.GetAsync<PaletteResultEntity>(PaletteResultEntity.GetPk(tenantId), PaletteResultEntity.GetSk(), ct);
            if (palette is not null)
                await repository.DeleteAsync(palette.Pk, palette.Sk, ct);
        }

        logger.LogInformation("Deleted {Kind} photo {PhotoId} for tenant {TenantId}", kind, photo.Id, tenantId);
        return true;
    }

    private async Task<PhotoView?> GetActiveAsync(string tenantId, PhotoKind kind, CancellationToken ct) =>
        (await GetActiveAsync(tenantId, ct)).FirstOrDefault(p => p.Kind == kind);

    private async Task CleanupDerivedAsync(string tenantId, PhotoKind kind, HashSet<string> replacedIds, CancellationToken ct)
    {
        if (replacedIds.Count == 0)
            return;

        if (kind == PhotoKind.Body)
        {
            var tryOns = await repository.GetAllAsync<TryOnImageEntity>(TryOnImageEntity.GetPk(tenantId), ct);
            var stale = tryOns.Where(t => replacedIds.Contains(t.BodyPhotoId)).ToList();
            foreach (var image in stale.Where(t => StorageKeys.BelongsToTenant(t.S3Key, tenantId)))
                await storage.DeleteAsync(image.S3Key, ct);
            if (stale.Count > 0)
                await repository.BatchDeleteKeysAsync(stale.Select(t => (t.Pk, t.Sk)).ToList(), ct);
            return;
        }

        var palette = await repository.GetAsync<PaletteResultEntity>(PaletteResultEntity.GetPk(tenantId), PaletteResultEntity.GetSk(), ct);
        if (palette?.SourcePhotoId is { } source && replacedIds.Contains(source))
        {
            palette.SourcePhotoId = null;
            await repository.SaveAsync(palette, ct);
        }
    }

    private async Task DiscardUploadAsync(PhotoUploadEntity upload, CancellationToken ct)
    {
        await storage.DeleteAsync(upload.S3Key, ct);
        await repository.DeleteAsync(upload.Pk, upload.Sk, ct);
    }

    private async Task<PhotoView> ToViewAsync(PhotoEntity photo, CancellationToken ct)
    {
        var ttl = TimeSpan.FromSeconds(options.CurrentValue.ReadUrlTtlSeconds);
        var url = await storage.CreateReadUrlAsync(photo.S3Key, ttl, ct);
        return new PhotoView(photo.Id, photo.Kind, photo.ContentType, photo.SizeBytes, photo.CreatedAt, url, Now.Add(ttl));
    }
}
