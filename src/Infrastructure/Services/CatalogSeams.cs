using Domain.Entity;
using Domain.Enum;
using Domain.Manager;
using Domain.Services;

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
