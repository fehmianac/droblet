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
    /// <summary>
    /// The outfit photo of a "photo" try-on while its job runs (EXIF-stripped, content-addressed by its hash). Under
    /// uploads/tmp/, so the 1-day lifecycle removes it when the job never produced an image.
    /// </summary>
    public static string TryOnReferenceUpload(string tenantId, string referenceHash) => Upload(tenantId, $"tryonref-{Guard(referenceHash)}");
    /// <summary>The outfit photo kept with a finished "photo" try-on image ("Kaynak fotoğraf"); deleted with the image.</summary>
    public static string TryOnReference(string tenantId, string imageId, string extension) => $"{TryOnPrefix(tenantId)}{Guard(imageId)}-ref.{Guard(extension)}";
    /// <summary>AI flat-lay covers of saved looks (private, owner only; deleted with the look or when replaced).</summary>
    public static string LookCoverPrefix(string tenantId) => $"{TenantRoot(tenantId)}look-cover/";
    /// <summary><c>tenant/{tenantId}/look-cover/{lookId}-{slotsHash}.webp</c>: one image per look and set of pieces.</summary>
    public static string LookCover(string tenantId, string lookId, string slotsHash) => $"{LookCoverPrefix(tenantId)}{Guard(lookId)}-{Guard(slotsHash)}.webp";
    public static string ItemsPrefix(string tenantId) => $"{TenantRoot(tenantId)}items/";
    /// <summary>Cleaned (background removed) garment image of a draft / item.</summary>
    public static string ItemImage(string tenantId, string draftId) => $"{ItemsPrefix(tenantId)}{Guard(draftId)}.webp";
    /// <summary>
    /// Private downscaled copies of a cleaned image (<see cref="ItemImageRenditions"/>): <c>{draftId}-256.webp</c>,
    /// <c>{draftId}-768.webp</c> next to <c>{draftId}.webp</c>. They are the source of the public thumbnails.
    /// </summary>
    public static string ItemImageRendition(string cleanedImageKey, int width)
    {
        if (!cleanedImageKey.EndsWith(".webp", StringComparison.Ordinal) || cleanedImageKey.Contains("..", StringComparison.Ordinal))
            throw new ArgumentException("Not a cleaned item image key.", nameof(cleanedImageKey));
        return $"{cleanedImageKey[..^".webp".Length]}-{width}.webp";
    }
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

    // ── Public (Cloudflare → S3, docs/images.md) ──────────────────────────────────────────────────────────────────
    // Only cleaned wardrobe piece images (no person in them) and their thumbnails live here. The bucket policy allows an
    // anonymous GetObject on exactly public/{stage}/items/* (from Cloudflare's ranges); every other prefix stays private.
    // The stage is part of the key so one hostname (cdn.alatech.co) serves both stages: the URL path equals the key, and a
    // Cloudflare origin rule per path prefix (/public/dev/ → dev bucket, /public/prod/ → prod bucket) picks the bucket.

    /// <summary>"public/" — no private key starts with it.</summary>
    public const string PublicRoot = "public/";

    /// <summary>Stage of this process (Lambda env STAGE, set by the template; the Ops tool sets it too). Default dev.</summary>
    public static string Stage => Environment.GetEnvironmentVariable("STAGE") is { Length: > 0 } stage && stage.All(char.IsAsciiLetterLower) ? stage : "dev";

    /// <summary>The only publicly readable prefix of the photo bucket: <c>public/{stage}/items/</c>.</summary>
    public static string PublicItemsPrefix => $"{PublicRoot}{Stage}/items/";

    /// <summary>
    /// One tenant's public folder. The segment is a one-way hash of the tenant id (128 bits of SHA-256), so a URL never
    /// shows the tenant id; account deletion removes the whole folder by recomputing it.
    /// </summary>
    public static string PublicItemsRoot(string tenantId) => $"{PublicItemsPrefix}{TenantToken(Guard(tenantId))}/";

    /// <summary>
    /// A published rendition: <c>public/{stage}/items/{tenantHash}/{itemId}-{version}-{size}.webp</c>. <paramref name="version"/>
    /// is 128 random bits chosen per publication (unguessable, and a replaced image gets a new key, so caches never
    /// serve the old one). <paramref name="size"/>: "full", "768", "256".
    /// </summary>
    public static string PublicItemImage(string tenantId, string itemId, string version, string size) =>
        $"{PublicItemsRoot(tenantId)}{Guard(itemId)}-{Guard(version)}-{Guard(size)}.webp";

    /// <summary>True for a key under this tenant's public folder (keys are never accepted from a client).</summary>
    public static bool IsPublicItemKeyOf(string key, string tenantId) => key.StartsWith(PublicItemsRoot(tenantId), StringComparison.Ordinal);

    private static string TenantToken(string tenantId)
    {
        var hash = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes("droblet/public-items/" + tenantId));
        return Convert.ToHexStringLower(hash.AsSpan(0, 16));
    }

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
