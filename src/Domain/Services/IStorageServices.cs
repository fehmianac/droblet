using Domain.Enum;

namespace Domain.Services;

public sealed record PresignedUpload(string Url, IReadOnlyDictionary<string, string> Fields, DateTime ExpiresAt);

public sealed record StoredObjectInfo(long SizeBytes, string? ContentType);

/// <summary>Private photo bucket. Keys are always built by StorageKeys from the caller's tenant.</summary>
public interface IObjectStorage
{
    /// <summary>Presigned POST restricted to exact key, exact Content-Type and 1..maxBytes.</summary>
    Task<PresignedUpload> CreateUploadAsync(string key, string contentType, long maxBytes, TimeSpan ttl, CancellationToken ct);
    Task<string> CreateReadUrlAsync(string key, TimeSpan ttl, CancellationToken ct);
    Task<StoredObjectInfo?> HeadAsync(string key, CancellationToken ct);
    Task<byte[]?> ReadAsync(string key, long maxBytes, CancellationToken ct);
    Task PutAsync(string key, byte[] data, string contentType, CancellationToken ct);
    /// <summary>Server-side copy inside the bucket (SSE-S3) with the given Content-Type / Cache-Control. False when the source is missing.</summary>
    Task<bool> CopyAsync(string sourceKey, string destinationKey, string contentType, string? cacheControl, CancellationToken ct);
    Task DeleteAsync(string key, CancellationToken ct);
    Task DeletePrefixAsync(string prefix, CancellationToken ct);
    /// <summary>Every key under a folder prefix (data export).</summary>
    Task<IReadOnlyList<string>> ListKeysAsync(string prefix, CancellationToken ct);
    /// <summary>Streams an object (null when missing). The caller disposes the stream.</summary>
    Task<Stream?> OpenReadAsync(string key, CancellationToken ct);
    /// <summary>Uploads a local file (multipart for large files), SSE-S3.</summary>
    Task PutFileAsync(string key, string filePath, string contentType, CancellationToken ct);
    /// <summary>Presigned GET that downloads as <paramref name="fileName"/> (Content-Disposition: attachment).</summary>
    Task<string> CreateDownloadUrlAsync(string key, string fileName, TimeSpan ttl, CancellationToken ct);
}

public sealed record PhotoUploadSlot(string UploadId, PresignedUpload Upload, long MaxBytes);

public sealed record PhotoView(string Id, PhotoKind Kind, string ContentType, long SizeBytes, DateTime CreatedAt, string Url, DateTime UrlExpiresAt);

public enum ActivatePhotoOutcome { Activated, AlreadyApplied, UploadNotFound, KindMismatch, UploadMissing, UnsupportedImage, TooLarge }

public sealed record ActivatePhotoResult(ActivatePhotoOutcome Outcome, PhotoView? Photo = null);

public sealed record AvatarView(string Url, DateTime UrlExpiresAt);

public enum ActivateAvatarOutcome { Activated, AlreadyApplied, UploadNotFound, UploadMissing, UnsupportedImage, TooLarge, DimensionsTooLarge }

/// <summary>Profile picture: separate from body / face photos in storage keys, partitions and upload slots.</summary>
public interface IAvatarService
{
    Task<PhotoUploadSlot> CreateUploadAsync(string tenantId, string contentType, CancellationToken ct);
    /// <summary>Validates (magic bytes, size, longest side ≤ Photos:AvatarMaxDimension), strips metadata, replaces the previous avatar. Idempotent by clientMutationId.</summary>
    Task<ActivateAvatarOutcome> ActivateAsync(string tenantId, string uploadId, string clientMutationId, CancellationToken ct);
    Task DeleteAsync(string tenantId, CancellationToken ct);
    /// <summary>Short-lived presigned GET of the current avatar; null when there is none.</summary>
    Task<AvatarView?> GetAsync(string tenantId, CancellationToken ct);
}

public interface IPhotoService
{
    Task<PhotoUploadSlot> CreateUploadAsync(string tenantId, PhotoKind kind, string contentType, CancellationToken ct);
    Task<ActivatePhotoResult> ActivateAsync(string tenantId, PhotoKind kind, string uploadId, string clientMutationId, CancellationToken ct);
    Task<IReadOnlyList<PhotoView>> GetActiveAsync(string tenantId, CancellationToken ct);
    /// <summary>"Fotoğraflarımı ve üretilen görselleri sil": body + face photos, all try-on images, palette result.</summary>
    Task DeleteAllAsync(string tenantId, CancellationToken ct);
    /// <summary>
    /// Deletes the active photo of one kind (screen 29 list) and what was derived from it: body → the try-on images
    /// generated with it; face → the palette result. False when <paramref name="photoId"/> is not that kind's active photo.
    /// </summary>
    Task<bool> DeleteAsync(string tenantId, PhotoKind kind, string photoId, CancellationToken ct);
}
