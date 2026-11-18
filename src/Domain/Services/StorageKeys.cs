using Domain.Enum;

namespace Domain.Services;

/// <summary>
/// The only place S3 keys are built. tenantId always comes from IApiContext (or the worker message),
/// never from a client-supplied key or path.
/// </summary>
public static class StorageKeys
{
    public static string UploadsRoot(string tenantId) => $"uploads/tmp/{Guard(tenantId)}/";
    public static string Upload(string tenantId, string uploadId) => $"{UploadsRoot(tenantId)}{Guard(uploadId)}";

    public static string TenantRoot(string tenantId) => $"tenant/{Guard(tenantId)}/";
    public static string PhotoPrefix(string tenantId, PhotoKind kind) =>
        $"{TenantRoot(tenantId)}{(kind == PhotoKind.Body ? "body" : "face")}/";
    public static string Photo(string tenantId, PhotoKind kind, string photoId, string extension) =>
        $"{PhotoPrefix(tenantId, kind)}{Guard(photoId)}.{extension}";
    public static string TryOnPrefix(string tenantId) => $"{TenantRoot(tenantId)}tryon/";
    public static string ItemsPrefix(string tenantId) => $"{TenantRoot(tenantId)}items/";
    /// <summary>Cleaned (background removed) garment image of a draft / item.</summary>
    public static string ItemImage(string tenantId, string draftId) => $"{ItemsPrefix(tenantId)}{Guard(draftId)}.webp";
    /// <summary>EXIF-stripped original garment photo ("Orijinale dön").</summary>
    public static string ItemOriginal(string tenantId, string draftId, string extension) => $"{ItemsPrefix(tenantId)}{Guard(draftId)}-original.{extension}";

    public static bool BelongsToTenant(string key, string tenantId) =>
        key.StartsWith(TenantRoot(tenantId), StringComparison.Ordinal)
        || key.StartsWith(UploadsRoot(tenantId), StringComparison.Ordinal);

    private static string Guard(string segment)
    {
        if (string.IsNullOrWhiteSpace(segment) || segment.Contains('/') || segment.Contains("..", StringComparison.Ordinal))
            throw new ArgumentException("Invalid key segment.", nameof(segment));
        return segment;
    }
}
