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
    /// <summary>
    /// Profile picture. Its own prefix, never under body/ or face/: the avatar is shown to followers, the body and face
    /// photos never leave their owner (and "delete my photos" does not touch the avatar).
    /// </summary>
    public static string AvatarPrefix(string tenantId) => $"{TenantRoot(tenantId)}avatar/";
    public static string Avatar(string tenantId, string avatarId, string extension) => $"{AvatarPrefix(tenantId)}{Guard(avatarId)}.{extension}";
    public static string TryOnPrefix(string tenantId) => $"{TenantRoot(tenantId)}tryon/";
    public static string ItemsPrefix(string tenantId) => $"{TenantRoot(tenantId)}items/";
    /// <summary>Cleaned (background removed) garment image of a draft / item.</summary>
    public static string ItemImage(string tenantId, string draftId) => $"{ItemsPrefix(tenantId)}{Guard(draftId)}.webp";
    /// <summary>EXIF-stripped original garment photo ("Orijinale dön").</summary>
    public static string ItemOriginal(string tenantId, string draftId, string extension) => $"{ItemsPrefix(tenantId)}{Guard(draftId)}-original.{extension}";

    /// <summary>"Verilerimi indir" ZIPs. Outside tenant/ so the export never includes an older export; bucket lifecycle: 7 days.</summary>
    public static string ExportsRoot(string tenantId) => $"exports/{Guard(tenantId)}/";
    public static string Export(string tenantId, string exportId) => $"{ExportsRoot(tenantId)}{Guard(exportId)}.zip";

    /// <summary>"Kombinlerini içe aktar" originals as uploaded (presigned POST). Bucket lifecycle: 7 days.</summary>
    public static string ImportUploadsRoot(string tenantId) => $"uploads/import/{Guard(tenantId)}/";
    public static string ImportUploadPrefix(string tenantId, string sessionId) => $"{ImportUploadsRoot(tenantId)}{Guard(sessionId)}/";
    public static string ImportUpload(string tenantId, string sessionId, int index) => $"{ImportUploadPrefix(tenantId, sessionId)}{index}";

    /// <summary>Worker output of an import session: the EXIF-stripped photo (a committed look's cover) and the piece crops.</summary>
    public static string ImportPrefix(string tenantId, string sessionId) => $"{TenantRoot(tenantId)}import/{Guard(sessionId)}/";
    public static string ImportPhoto(string tenantId, string sessionId, int index, string extension) => $"{ImportPrefix(tenantId, sessionId)}{index}.{extension}";
    public static string ImportCrop(string tenantId, string sessionId, int index, int piece) => $"{ImportPrefix(tenantId, sessionId)}{index}-{piece}.jpg";

    public static bool BelongsToTenant(string key, string tenantId) =>
        key.StartsWith(TenantRoot(tenantId), StringComparison.Ordinal)
        || key.StartsWith(UploadsRoot(tenantId), StringComparison.Ordinal)
        || key.StartsWith(ImportUploadsRoot(tenantId), StringComparison.Ordinal);

    private static string Guard(string segment)
    {
        if (string.IsNullOrWhiteSpace(segment) || segment.Contains('/') || segment.Contains("..", StringComparison.Ordinal))
            throw new ArgumentException("Invalid key segment.", nameof(segment));
        return segment;
    }
}
