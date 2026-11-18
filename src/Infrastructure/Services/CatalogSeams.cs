using System.Text.Json.Serialization;
using Domain.Entity;
using Domain.Enum;
using Domain.Manager;
using Domain.Services;
using Domain.Services.Ai;

namespace Infrastructure.Services;

/// <summary>
/// Ready-made library: the global "library#item" partition (written by the seed tool from seed/library/items.json).
/// Until that partition is seeded, the seed file embedded in this assembly is served, so onboarding step 04b works on
/// a fresh stage. Loaded once per container.
/// </summary>
public sealed class LibraryCatalog(IRepository repository) : ILibraryCatalog
{
    public const string SeedResourceName = "seed.library.items.json";

    private static readonly Lazy<IReadOnlyList<LibraryItemEntity>> EmbeddedSeed = new(LoadEmbeddedSeed);
    private IReadOnlyList<LibraryItemEntity>? _cache;

    public async Task<IReadOnlyList<LibraryItemEntity>> GetAllAsync(CancellationToken ct)
    {
        if (_cache is not null)
            return _cache;

        var stored = await repository.GetAllAsync<LibraryItemEntity>(LibraryItemEntity.GetPk(), ct);
        var items = stored.Count > 0 ? stored : EmbeddedSeed.Value;
        return _cache = items.Where(i => !i.Retired).ToList();
    }

    public static IReadOnlyList<LibraryItemEntity> LoadEmbeddedSeed()
    {
        using var stream = typeof(LibraryCatalog).Assembly.GetManifestResourceStream(SeedResourceName)
                           ?? throw new InvalidOperationException($"Embedded resource {SeedResourceName} is missing.");
        using var reader = new StreamReader(stream);
        var result = LibrarySeed.Parse(reader.ReadToEnd());
        return result.IsValid
            ? result.Items
            : throw new InvalidOperationException($"Library seed is invalid: {string.Join("; ", result.Errors)}");
    }
}

/// <summary>
/// Default ICatalogProductLookup until the catalog module registers its own: reads the documented global key
/// (pk "catalog#product", sk productId — BACKEND_ENGINEER.md §DynamoDB Key Patterns) through a tolerant projection.
/// Unknown category = the product cannot be placed in a slot, so it is treated as not found.
/// Product images live in the global asset bucket, which this side has no access to: ReadImageAsync returns null
/// (a try-on that needs a product image then fails with SourceDeleted and the credit is refunded).
/// </summary>
public sealed class RepositoryCatalogProductLookup(IRepository repository) : ICatalogProductLookup
{
    public async Task<ProductSnapshot?> GetAsync(string productId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(productId))
            return null;

        var record = await repository.GetAsync<CatalogProductRecord>(CatalogProductRecord.GetPk(), CatalogProductRecord.GetSk(productId), ct);
        if (record is null || !Enum.TryParse<ItemCategory>(record.Category, ignoreCase: true, out var category) || !Enum.IsDefined(category))
            return null;

        var seasons = (record.Seasons ?? [])
            .Select(s => Enum.TryParse<Season>(s, ignoreCase: true, out var season) && Enum.IsDefined(season) ? season : (Season?)null)
            .Where(s => s is not null).Select(s => s!.Value).ToList();

        return new ProductSnapshot(productId, record.Name ?? "", record.BrandId, record.BrandName, category,
            record.ColorIds ?? record.Colors ?? [], record.Fabric, seasons, record.ImageKey, record.Retired);
    }

    public Task<ImageInput?> ReadImageAsync(ProductSnapshot product, CancellationToken ct) => Task.FromResult<ImageInput?>(null);

    /// <summary>Read-only projection of the catalog product row; the catalog module owns the real entity.</summary>
    public sealed class CatalogProductRecord
    {
        [JsonPropertyName("name")] public string? Name { get; set; }
        [JsonPropertyName("brandId")] public string? BrandId { get; set; }
        [JsonPropertyName("brandName")] public string? BrandName { get; set; }
        [JsonPropertyName("category")] public string? Category { get; set; }
        [JsonPropertyName("colorIds")] public List<string>? ColorIds { get; set; }
        [JsonPropertyName("colors")] public List<string>? Colors { get; set; }
        [JsonPropertyName("fabric")] public string? Fabric { get; set; }
        [JsonPropertyName("seasons")] public List<string>? Seasons { get; set; }
        [JsonPropertyName("imageKey")] public string? ImageKey { get; set; }
        [JsonPropertyName("retired")] public bool Retired { get; set; }

        public static string GetPk() => "catalog#product";
        public static string GetSk(string productId) => productId;
    }
}
