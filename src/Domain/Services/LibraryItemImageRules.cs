using Domain.Entity;

namespace Domain.Services;

/// <summary>
/// Wardrobe pieces added from the ready library carry the library item's image as GlobalImageKey, copied at the time
/// they were added. Before the library images were generated (ops generate-library-images) that value was the seed's
/// relative placeholder ("library/white-tshirt.webp") with no file behind it; only an absolute https URL is a real image.
/// Used by the one-off ops migration (migrate-library-item-images) and by the try-on worker's run-on-read fallback.
/// </summary>
public static class LibraryItemImageRules
{
    /// <summary>A global image the downloaders can fetch: an absolute https URL. Anything else is a placeholder.</summary>
    public static bool IsResolvable(string? globalImageKey) =>
        globalImageKey is not null && globalImageKey.StartsWith("https://", StringComparison.OrdinalIgnoreCase);

    /// <summary>A library item without a real image yet (the men's starter set until Ops generate-library-images --only runs): the app shows the garment placeholder.</summary>
    public static bool NeedsImage(LibraryItemEntity item) => !IsResolvable(item.ImageKey);

    /// <summary>A library-sourced piece whose global image is still a placeholder (or missing).</summary>
    public static bool NeedsLibraryImage(ItemEntity item) =>
        !string.IsNullOrWhiteSpace(item.LibraryItemId) && !IsResolvable(item.GlobalImageKey);

    /// <summary>
    /// The library item's current image for <paramref name="item"/>, or null when nothing should change: the piece is not
    /// from the library, already has a real image, or the library item has no image yet (or another id).
    /// </summary>
    public static string? CurrentImageFor(ItemEntity item, LibraryItemEntity? source) =>
        NeedsLibraryImage(item)
        && source is not null
        && string.Equals(source.Id, item.LibraryItemId, StringComparison.Ordinal)
        && IsResolvable(source.ImageKey)
        && !string.Equals(source.ImageKey, item.GlobalImageKey, StringComparison.Ordinal)
            ? source.ImageKey
            : null;
}
