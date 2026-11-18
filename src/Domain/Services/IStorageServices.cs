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
    Task DeleteAsync(string key, CancellationToken ct);
    Task DeletePrefixAsync(string prefix, CancellationToken ct);
}

public sealed record PhotoUploadSlot(string UploadId, PresignedUpload Upload, long MaxBytes);

public sealed record PhotoView(string Id, PhotoKind Kind, string ContentType, long SizeBytes, DateTime CreatedAt, string Url, DateTime UrlExpiresAt);

public enum ActivatePhotoOutcome { Activated, AlreadyApplied, UploadNotFound, KindMismatch, UploadMissing, UnsupportedImage, TooLarge }

public sealed record ActivatePhotoResult(ActivatePhotoOutcome Outcome, PhotoView? Photo = null);

public interface IPhotoService
{
    Task<PhotoUploadSlot> CreateUploadAsync(string tenantId, PhotoKind kind, string contentType, CancellationToken ct);
    Task<ActivatePhotoResult> ActivateAsync(string tenantId, PhotoKind kind, string uploadId, string clientMutationId, CancellationToken ct);
    Task<IReadOnlyList<PhotoView>> GetActiveAsync(string tenantId, CancellationToken ct);
    /// <summary>"Fotoğraflarımı ve üretilen görselleri sil": body + face photos, all try-on images, palette result.</summary>
    Task DeleteAllAsync(string tenantId, CancellationToken ct);
}
