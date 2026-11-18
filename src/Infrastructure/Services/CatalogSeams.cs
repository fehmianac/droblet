using Domain.Entity;
using Domain.Enum;
using Domain.Manager;
using Domain.Services;

namespace Infrastructure.Services;

/// <summary>
/// Ready-made library: the global "library#item" partition (written by the seed tool from seed/library/items.json).
/// Until that partition is seeded, the seed file embedded in this assembly is served, so onboarding step 04b works on
/// a fresh stage. Cached per container for <see cref="CacheLifetime"/> (the admin panel edits the partition).
/// </summary>
public sealed class LibraryCatalog(IRepository repository) : ILibraryCatalog
{
    public const string SeedResourceName = "seed.library.items.json";
    public static readonly TimeSpan CacheLifetime = TimeSpan.FromSeconds(60);

    private static readonly Lazy<IReadOnlyList<LibraryItemEntity>> EmbeddedSeed = new(LoadEmbeddedSeed);
    private (IReadOnlyList<LibraryItemEntity> Items, long LoadedAt)? _cache;

    /// <summary>The embedded seed (served while the partition is empty; copied into it on the first admin write).</summary>
    public static IReadOnlyList<LibraryItemEntity> Seed => EmbeddedSeed.Value;

    public async Task<IReadOnlyList<LibraryItemEntity>> GetAllAsync(CancellationToken ct)
    {
        if (_cache is { } cache && Environment.TickCount64 - cache.LoadedAt < CacheLifetime.TotalMilliseconds)
            return cache.Items;

        var stored = await repository.GetAllAsync<LibraryItemEntity>(LibraryItemEntity.GetPk(), ct);
        var items = (stored.Count > 0 ? stored : EmbeddedSeed.Value).Where(i => !i.Retired).ToList();
        _cache = (items, Environment.TickCount64);
        return items;
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
