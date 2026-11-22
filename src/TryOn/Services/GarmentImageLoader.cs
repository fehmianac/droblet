using Domain.Entity;
using Domain.Extensions;
using Domain.Manager;
using Domain.Services;
using Domain.Services.Ai;

namespace TryOn.Services;

/// <summary>
/// The image of one outfit piece, shared by the try-on and the look cover jobs: the tenant's own item image (the original
/// when the user chose it, only under that tenant's prefix — never another tenant's), a library / catalog piece's global
/// https image, a catalog product's image (store slot) or a ready-library piece the stylist picked. null = no image.
/// </summary>
public sealed class GarmentImageLoader(IRepository repository, IObjectStorage storage, ICatalogProductLookup products, ILibraryCatalog library)
{
    public const long MaxImageBytes = 15 * 1024 * 1024;

    public async Task<ImageInput?> LoadAsync(string tenantId, OutfitPiece piece, CancellationToken ct)
    {
        ImageInput? image = null;
        if (piece.ItemId is not null)
        {
            var item = await repository.GetAsync<ItemEntity>(ItemEntity.GetPk(tenantId), ItemEntity.GetSk(piece.ItemId), ct);
            var key = item is { UseOriginalImage: true, OriginalImageKey: not null } ? item.OriginalImageKey : item?.ImageKey ?? item?.OriginalImageKey;
            if (key is not null && StorageKeys.BelongsToTenant(key, tenantId) && await storage.ReadAsync(key, MaxImageBytes, ct) is { } data)
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
}
