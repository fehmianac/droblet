using System.Text.Json;
using System.Text.RegularExpressions;
using Domain.Entity;
using Domain.Enum;
using Domain.Services.Ai;
using Domain.Services.Styling;

namespace Domain.Services;

/// <summary>Global ready-made library ("hazır ürün kütüphanesi"). Read-only for users.</summary>
public interface ILibraryCatalog
{
    Task<IReadOnlyList<LibraryItemEntity>> GetAllAsync(CancellationToken ct);
}

public sealed record LibrarySeedItem(
    string? Id,
    IReadOnlyDictionary<string, string>? Name,
    ItemCategory? Category,
    IReadOnlyList<string>? ColorIds,
    string? Fabric,
    IReadOnlyList<Season>? Seasons,
    string? ImageKey,
    int SortOrder = 0,
    bool Retired = false);

public sealed record LibrarySeedFile(int Version, IReadOnlyList<LibrarySeedItem>? Items);

public sealed record LibrarySeedResult(IReadOnlyList<LibraryItemEntity> Items, IReadOnlyList<string> Errors)
{
    public bool IsValid => Errors.Count == 0;
}

/// <summary>
/// Seed format of seed/library/items.json (versioned in the repo; never typed into a console):
/// { "version": 1, "items": [ { "id": "lib-white-tshirt", "name": { "tr": "…", "en": "…" }, "category": "top",
///   "colorIds": ["white"], "fabric": "cotton", "seasons": ["spring","summer"], "imageKey": "library/….webp",
///   "sortOrder": 10, "retired": false } ] }
/// Ids are kebab-case, start with "lib-", are never reused and never removed (retire instead).
/// name is a language map; "tr" is mandatory (fallback), other languages are data only; colours and fabric come from the fixed vocabularies; at least one season.
/// </summary>
public static partial class LibrarySeed
{
    public const int SupportedVersion = 1;

    public static LibrarySeedResult Parse(string json)
    {
        LibrarySeedFile? file;
        try
        {
            file = JsonSerializer.Deserialize<LibrarySeedFile>(json, StylingJson.Options);
        }
        catch (JsonException ex)
        {
            return new LibrarySeedResult([], [$"invalid json: {ex.Message}"]);
        }

        var errors = new List<string>();
        if (file is null || file.Version != SupportedVersion)
            errors.Add($"version must be {SupportedVersion}");

        var items = new List<LibraryItemEntity>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var (item, index) in (file?.Items ?? []).Select((item, index) => (item, index)))
        {
            var label = item.Id ?? $"#{index}";
            void Error(string message) => errors.Add($"{label}: {message}");

            if (item.Id is null || !IdPattern().IsMatch(item.Id))
                Error("id must match lib-[a-z0-9-]+");
            else if (!seen.Add(item.Id))
                Error("duplicate id");
            if (item.Name is null || !item.Name.TryGetValue(Localized.Default, out var fallbackName) || string.IsNullOrWhiteSpace(fallbackName)
                || item.Name.Any(n => Localized.Normalize(n.Key) != n.Key && n.Key.Length != 2 || string.IsNullOrWhiteSpace(n.Value)))
                Error("name must be a language map with a non-empty \"tr\" entry");
            if (item.Category is not { } category || !System.Enum.IsDefined(category))
                Error("category is required");
            if (item.ColorIds is not { Count: > 0 } || item.ColorIds.Any(c => !ColorCatalog.IsKnown(c)))
                Error("colorIds must be known colour ids (at least one)");
            if (item.Fabric is not null && !FabricCatalog.IsKnown(item.Fabric))
                Error("unknown fabric");
            if (item.Seasons is not { Count: > 0 } || item.Seasons.Any(s => !System.Enum.IsDefined(s)))
                Error("at least one season is required");

            items.Add(new LibraryItemEntity
            {
                Id = item.Id ?? "",
                Name = item.Name?.ToDictionary(n => n.Key, n => n.Value, StringComparer.Ordinal) ?? [],
                Category = item.Category ?? default,
                ColorIds = item.ColorIds?.ToList() ?? [],
                Fabric = item.Fabric,
                Seasons = item.Seasons?.ToList() ?? [],
                ImageKey = item.ImageKey,
                SortOrder = item.SortOrder,
                Retired = item.Retired,
            });
        }

        if (items.Count == 0)
            errors.Add("items must not be empty");
        return new LibrarySeedResult(items, errors);
    }

    [GeneratedRegex("^lib-[a-z0-9]+(-[a-z0-9]+)*$")]
    private static partial Regex IdPattern();
}
