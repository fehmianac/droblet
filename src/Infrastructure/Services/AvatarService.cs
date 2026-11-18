using Domain.Entity;
using Domain.Extensions;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Infrastructure.Services;

/// <summary>
/// Profile picture. Same upload pattern as the body / face photos (presigned POST to uploads/tmp/, then activation), but
/// kept apart from them on purpose: own upload slots (AvatarUploadEntity — a photo upload id is unknown here and vice
/// versa), own row (AvatarEntity) and own S3 prefix (tenant/{id}/avatar/). Activation checks the magic bytes, the size and
/// the longest side, strips EXIF / XMP (location, device) and replaces the previous avatar. Keys and URLs are never logged.
/// </summary>
public sealed class AvatarService(
    IRepository repository,
    IObjectStorage storage,
    IOptionsMonitor<PhotoOptions> options,
    TimeProvider timeProvider,
    ILogger<AvatarService> logger) : IAvatarService
{
    private DateTime Now => timeProvider.GetUtcNow().UtcDateTime;

    public async Task<PhotoUploadSlot> CreateUploadAsync(string tenantId, string contentType, CancellationToken ct)
    {
        var settings = options.CurrentValue;
        var now = Now;
        var uploadId = Ulid.New(now);
        var key = StorageKeys.Upload(tenantId, uploadId);

        var upload = await storage.CreateUploadAsync(key, contentType, settings.AvatarMaxUploadBytes, TimeSpan.FromSeconds(settings.UploadUrlTtlSeconds), ct);
        await repository.SaveAsync(new AvatarUploadEntity { UploadId = uploadId, TenantId = tenantId, ContentType = contentType, S3Key = key, CreatedAt = now }, ct);
        return new PhotoUploadSlot(uploadId, upload, settings.AvatarMaxUploadBytes);
    }

    public async Task<ActivateAvatarOutcome> ActivateAsync(string tenantId, string uploadId, string clientMutationId, CancellationToken ct)
    {
        if (await repository.GetAsync<MutationReceiptEntity>(MutationReceiptEntity.GetPk(tenantId), MutationReceiptEntity.GetSk(clientMutationId), ct) is not null)
            return ActivateAvatarOutcome.AlreadyApplied;

        var upload = await repository.GetAsync<AvatarUploadEntity>(AvatarUploadEntity.GetPk(tenantId), AvatarUploadEntity.GetSk(uploadId), ct);
        if (upload is null || !StorageKeys.BelongsToTenant(upload.S3Key, tenantId))
            return ActivateAvatarOutcome.UploadNotFound;

        var settings = options.CurrentValue;
        var head = await storage.HeadAsync(upload.S3Key, ct);
        if (head is null)
            return ActivateAvatarOutcome.UploadMissing;
        if (head.SizeBytes > settings.AvatarMaxUploadBytes)
        {
            await DiscardAsync(upload, ct);
            return ActivateAvatarOutcome.TooLarge;
        }

        var raw = await storage.ReadAsync(upload.S3Key, settings.AvatarMaxUploadBytes, ct);
        var clean = raw is null ? null : ImageMetadataStripper.Strip(raw);
        if (clean is null || !settings.AllowedContentTypes.Contains(clean.ContentType) || !ImageDimensions.TryRead(clean.Data, out var width, out var height))
        {
            await DiscardAsync(upload, ct);
            return ActivateAvatarOutcome.UnsupportedImage;
        }
        if (Math.Max(width, height) > settings.AvatarMaxDimension)
        {
            await DiscardAsync(upload, ct);
            return ActivateAvatarOutcome.DimensionsTooLarge;
        }

        var now = Now;
        var avatar = new AvatarEntity { Id = Ulid.New(now), TenantId = tenantId, ContentType = clean.ContentType, Width = width, Height = height, CreatedAt = now };
        avatar.S3Key = StorageKeys.Avatar(tenantId, avatar.Id, clean.Extension);
        await storage.PutAsync(avatar.S3Key, clean.Data, clean.ContentType, ct);

        var previous = await repository.GetAsync<AvatarEntity>(AvatarEntity.GetPk(tenantId), AvatarEntity.GetSk(), ct);
        var result = await repository.TransactWriteAsync(
        [
            TransactWriteOperation.Create(new MutationReceiptEntity { TenantId = tenantId, ClientMutationId = clientMutationId, CreatedAt = now }),
            TransactWriteOperation.Put(avatar),
            TransactWriteOperation.Delete(upload.Pk, upload.Sk),
        ], ct);
        if (!result.Applied)
        {
            await storage.DeleteAsync(avatar.S3Key, ct);
            return ActivateAvatarOutcome.AlreadyApplied;
        }

        await storage.DeleteAsync(upload.S3Key, ct);
        if (previous is not null && StorageKeys.BelongsToTenant(previous.S3Key, tenantId))
            await storage.DeleteAsync(previous.S3Key, ct);
        logger.LogInformation("Activated avatar {AvatarId} for tenant {TenantId}", avatar.Id, tenantId);
        return ActivateAvatarOutcome.Activated;
    }

    public async Task DeleteAsync(string tenantId, CancellationToken ct)
    {
        var avatar = await repository.GetAsync<AvatarEntity>(AvatarEntity.GetPk(tenantId), AvatarEntity.GetSk(), ct);
        if (avatar is null)
            return;
        await repository.DeleteAsync(avatar.Pk, avatar.Sk, ct);
        // Whatever was left under the prefix (an older avatar after a failed cleanup) goes too.
        await storage.DeletePrefixAsync(StorageKeys.AvatarPrefix(tenantId), ct);
        logger.LogInformation("Deleted avatar for tenant {TenantId}", tenantId);
    }

    public async Task<AvatarView?> GetAsync(string tenantId, CancellationToken ct)
    {
        var avatar = await repository.GetAsync<AvatarEntity>(AvatarEntity.GetPk(tenantId), AvatarEntity.GetSk(), ct);
        if (avatar is null || !avatar.S3Key.StartsWith(StorageKeys.AvatarPrefix(tenantId), StringComparison.Ordinal))
            return null;
        var ttl = TimeSpan.FromSeconds(Math.Clamp(options.CurrentValue.AvatarReadUrlTtlSeconds, 60, 7 * 24 * 3600));
        return new AvatarView(await storage.CreateReadUrlAsync(avatar.S3Key, ttl, ct), Now.Add(ttl));
    }

    private async Task DiscardAsync(AvatarUploadEntity upload, CancellationToken ct)
    {
        await storage.DeleteAsync(upload.S3Key, ct);
        await repository.DeleteAsync(upload.Pk, upload.Sk, ct);
    }
}
