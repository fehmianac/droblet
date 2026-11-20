using Domain.Entity;

namespace Domain.Services;

/// <summary>
/// Downscaled copies of a cleaned wardrobe piece image (docs/images.md). They are made once, when the cleaned image is
/// written (no AI: a plain resample), kept private next to it, and copied to the public prefix with it.
/// </summary>
public static class ItemImageRenditions
{
    /// <summary>Lists, grids, tiles.</summary>
    public const int Thumb = 256;
    /// <summary>Item detail and medium heroes.</summary>
    public const int Medium = 768;
    public static readonly IReadOnlyList<int> Widths = [Thumb, Medium];

    /// <summary>
    /// Public objects: one day in browser / Cloudflare caches. A replaced image gets a new key (random version), so a long
    /// lifetime never shows a stale image; a deleted one is purged when a Cloudflare token is configured, otherwise it
    /// can stay in an edge cache for at most this long.
    /// </summary>
    public const string PublicCacheControl = "public, max-age=86400";

    /// <summary>The private rendition keys of a cleaned image (they may not exist for images cleaned before renditions).</summary>
    public static IReadOnlyList<string> KeysOf(string cleanedKey) => Widths.Select(w => StorageKeys.ItemImageRendition(cleanedKey, w)).ToList();

    /// <summary>
    /// Writes the 256 / 768 px WebP renditions next to <paramref name="cleanedKey"/>. Returns the keys written (an image the
    /// thumbnailer cannot decode yields none: the item then shows its full image everywhere).
    /// </summary>
    public static async Task<IReadOnlyList<string>> WriteAsync(IObjectStorage storage, IImageThumbnailer thumbnailer, string cleanedKey, byte[] cleaned, CancellationToken ct)
    {
        var written = new List<string>(Widths.Count);
        foreach (var width in Widths)
        {
            if (thumbnailer.ToWebp(cleaned, width) is not { } data)
                continue;
            var key = StorageKeys.ItemImageRendition(cleanedKey, width);
            await storage.PutAsync(key, data, "image/webp", ct);
            written.Add(key);
        }
        return written;
    }
}

/// <summary>Image resampling without AI (SkiaSharp in the item worker and the Ops tool).</summary>
public interface IImageThumbnailer
{
    /// <summary>WebP whose longest side is at most <paramref name="maxSide"/> (never upscaled, alpha kept); null when the bytes cannot be decoded.</summary>
    byte[]? ToWebp(byte[] image, int maxSide);
}

/// <summary>Keys of one publication of an item's cleaned image.</summary>
public sealed record PublishedItemImage(string FullKey, string? MediumKey, string? ThumbKey)
{
    public IReadOnlyList<string> Keys => new[] { FullKey, MediumKey, ThumbKey }.OfType<string>().ToList();
}

/// <summary>
/// Copies an item's private cleaned image (and its renditions) to the public prefix under fresh random keys, and removes
/// public copies again. Never writes the item row: the caller stores the keys with its own (versioned) write, and removes
/// the copies it made when that write does not happen.
/// </summary>
public interface IItemImagePublisher
{
    /// <summary>
    /// Null when the item has no cleaned image of its own, is moderation-hidden, or the copy failed (logged; the item then
    /// keeps its presigned private image, and publish-item-images can publish it later).
    /// </summary>
    Task<PublishedItemImage?> PublishAsync(ItemEntity item, CancellationToken ct);

    /// <summary>Deletes public objects of the tenant (other keys are ignored) and purges them from the CDN when configured. Never throws.</summary>
    Task UnpublishAsync(string tenantId, IEnumerable<string?> keys, CancellationToken ct);
}

/// <summary>The three image URLs of an item for the app, plus a cache key that stays the same while the image does.</summary>
/// <param name="ExpiresAt">Null for public URLs; the presigned expiry otherwise.</param>
public sealed record ItemImageView(string? ImageUrl, string? MediumUrl, string? ThumbUrl, DateTime? ExpiresAt, string? CacheKey)
{
    public static readonly ItemImageView None = new(null, null, null, null, null);
}

public interface IItemImageUrls
{
    /// <summary>
    /// Public CDN URLs when the item is published and Photos:PublicBaseUrl is set; presigned GETs otherwise (the published
    /// copies, else the private cleaned / original image), then the global library / catalog image.
    /// </summary>
    Task<ItemImageView> GetAsync(ItemEntity item, CancellationToken ct);

    /// <summary>
    /// What other people may see (social closet, shared looks): the cleaned image only — never the original upload, even
    /// when the owner chose "Orijinale dön" — else the global library / catalog image.
    /// </summary>
    Task<ItemImageView> GetForOthersAsync(ItemEntity item, CancellationToken ct);
}

/// <summary>Removes deleted public objects from the CDN cache (Cloudflare). A no-op when it is not configured.</summary>
public interface ICdnCache
{
    Task PurgeAsync(IReadOnlyList<string> publicKeys, CancellationToken ct);
}

public static class ItemPublicImageExtensions
{
    public static IReadOnlyList<string> PublicImageKeys(this ItemEntity item) =>
        new[] { item.PublicImageKey, item.PublicMediumKey, item.PublicThumbKey }.OfType<string>().ToList();

    public static bool IsPublished(this ItemEntity item) => item.PublicImageKey is not null;

    public static void SetPublicImage(this ItemEntity item, PublishedItemImage? image)
    {
        item.PublicImageKey = image?.FullKey;
        item.PublicMediumKey = image?.MediumKey;
        item.PublicThumbKey = image?.ThumbKey;
    }
}
