using System.Collections.Frozen;

namespace Domain.Services;

/// <summary>
/// Fixed reference vocabularies (AI_ENGINEER.md: "sabit enum'lar ve sezon → palet tablosu tek kaynaktan, src/Domain").
/// Prompts, JSON schemas, guards and validators are all generated from these — never copied by hand.
/// Ids are stable kebab-case and are never reused; the client owns nothing but the id.
/// </summary>
public sealed record ColorDefinition(string Id, string Family, string Hex, IReadOnlyDictionary<string, string> Name);

public static class ColorCatalog
{
    public static readonly IReadOnlyList<ColorDefinition> All =
    [
        new("black", "black", "#1C1A17", Localized.Of("Siyah", "Black")),
        new("charcoal", "grey", "#3B3B3D", Localized.Of("Antrasit", "Charcoal")),
        new("grey", "grey", "#8E8E90", Localized.Of("Gri", "Grey")),
        new("silver", "grey", "#C9CBCF", Localized.Of("Gümüş", "Silver")),
        new("white", "white", "#FFFFFF", Localized.Of("Beyaz", "White")),
        new("ivory", "white", "#F7F1E3", Localized.Of("Fildişi", "Ivory")),
        new("cream", "beige", "#F1E6CF", Localized.Of("Krem", "Cream")),
        new("beige", "beige", "#DCCAB0", Localized.Of("Bej", "Beige")),
        new("taupe", "beige", "#9B8B7E", Localized.Of("Vizon", "Taupe")),
        new("camel", "brown", "#C19A6B", Localized.Of("Camel", "Camel")),
        new("brown", "brown", "#7B5236", Localized.Of("Kahverengi", "Brown")),
        new("chocolate", "brown", "#4A2C1D", Localized.Of("Çikolata", "Chocolate")),
        new("red", "red", "#C8102E", Localized.Of("Kırmızı", "Red")),
        new("burgundy", "red", "#6D1A2B", Localized.Of("Bordo", "Burgundy")),
        new("rust", "orange", "#A8482A", Localized.Of("Kiremit", "Rust")),
        new("terracotta", "orange", "#C4673F", Localized.Of("Terrakota", "Terracotta")),
        new("orange", "orange", "#EB7A2B", Localized.Of("Turuncu", "Orange")),
        new("coral", "orange", "#F27C6B", Localized.Of("Mercan", "Coral")),
        new("peach", "orange", "#F6C3A4", Localized.Of("Şeftali", "Peach")),
        new("mustard", "yellow", "#C99A1B", Localized.Of("Hardal", "Mustard")),
        new("yellow", "yellow", "#F4D03F", Localized.Of("Sarı", "Yellow")),
        new("gold", "yellow", "#C9A227", Localized.Of("Altın", "Gold")),
        new("blush", "pink", "#EBC8C2", Localized.Of("Pudra", "Blush")),
        new("pink", "pink", "#EE8FB0", Localized.Of("Pembe", "Pink")),
        new("fuchsia", "pink", "#C81D77", Localized.Of("Fuşya", "Fuchsia")),
        new("lavender", "purple", "#C9BEE6", Localized.Of("Lavanta", "Lavender")),
        new("lilac", "purple", "#B79BC9", Localized.Of("Lila", "Lilac")),
        new("purple", "purple", "#6B3FA0", Localized.Of("Mor", "Purple")),
        new("plum", "purple", "#5B2A4D", Localized.Of("Mürdüm", "Plum")),
        new("icy-blue", "blue", "#D5E7F2", Localized.Of("Buz mavisi", "Icy blue")),
        new("sky-blue", "blue", "#8FBFE0", Localized.Of("Bebek mavisi", "Sky blue")),
        new("denim", "blue", "#4D6D9A", Localized.Of("Kot mavisi", "Denim blue")),
        new("cobalt", "blue", "#1F4EB4", Localized.Of("Saks mavisi", "Cobalt")),
        new("navy", "blue", "#1B2A49", Localized.Of("Lacivert", "Navy")),
        new("turquoise", "green", "#2BB5B0", Localized.Of("Turkuaz", "Turquoise")),
        new("teal", "green", "#1F6F73", Localized.Of("Petrol", "Teal")),
        new("mint", "green", "#BFE3CF", Localized.Of("Mint", "Mint")),
        new("sage", "green", "#A3B19B", Localized.Of("Adaçayı", "Sage")),
        new("khaki", "green", "#8A8558", Localized.Of("Haki", "Khaki")),
        new("olive", "green", "#6B6B3A", Localized.Of("Zeytin yeşili", "Olive")),
        new("emerald", "green", "#0F7B5F", Localized.Of("Zümrüt", "Emerald")),
        new("forest-green", "green", "#24452F", Localized.Of("Orman yeşili", "Forest green")),
    ];

    private static readonly FrozenDictionary<string, ColorDefinition> ById = All.ToFrozenDictionary(c => c.Id, StringComparer.Ordinal);

    public static IReadOnlyList<string> Ids { get; } = All.Select(c => c.Id).ToList();

    public static bool IsKnown(string? id) => id is not null && ById.ContainsKey(id);

    public static ColorDefinition? Find(string? id) => id is not null && ById.TryGetValue(id, out var color) ? color : null;

    public static string? FamilyOf(string? id) => Find(id)?.Family;
}

public static class FabricCatalog
{
    public static readonly IReadOnlyList<string> Ids =
    [
        "cotton", "linen", "wool", "cashmere", "silk", "satin", "chiffon", "viscose", "polyester", "denim",
        "leather", "suede", "knit", "velvet", "tweed", "nylon", "fleece", "down",
    ];

    private static readonly FrozenSet<string> Known = Ids.ToFrozenSet(StringComparer.Ordinal);

    public static bool IsKnown(string? id) => id is not null && Known.Contains(id);
}

/// <summary>
/// Season type -> palette. The model only ever picks the season type id (AI rule 14: palette colours never come from
/// the model); flattering / avoid tones are read from this table. Lists never intersect (unit-tested).
/// The table is a first draft that the style consultant (domain expert) has to validate before launch.
/// </summary>
public sealed record SeasonTypeDefinition(string Id, IReadOnlyDictionary<string, string> Name, IReadOnlyList<string> FlatteringColorIds, IReadOnlyList<string> AvoidColorIds);

public static class SeasonTypeCatalog
{
    public static readonly IReadOnlyList<SeasonTypeDefinition> All =
    [
        new("light-spring", Localized.Of("Açık İlkbahar", "Light Spring"),
            ["ivory", "cream", "peach", "coral", "blush", "mint", "sky-blue", "turquoise", "camel", "yellow", "gold"],
            ["black", "charcoal", "burgundy", "plum", "chocolate"]),
        new("warm-spring", Localized.Of("Sıcak İlkbahar", "Warm Spring"),
            ["cream", "camel", "coral", "peach", "orange", "yellow", "gold", "turquoise", "emerald", "olive"],
            ["black", "icy-blue", "fuchsia", "lavender", "silver", "grey"]),
        new("bright-spring", Localized.Of("Parlak İlkbahar", "Bright Spring"),
            ["ivory", "coral", "red", "fuchsia", "turquoise", "cobalt", "emerald", "yellow", "navy"],
            ["taupe", "sage", "khaki", "mustard", "grey", "beige"]),
        new("light-summer", Localized.Of("Açık Yaz", "Light Summer"),
            ["white", "blush", "pink", "lavender", "lilac", "sky-blue", "icy-blue", "mint", "grey", "silver"],
            ["black", "orange", "rust", "mustard", "terracotta", "chocolate"]),
        new("cool-summer", Localized.Of("Soğuk Yaz", "Cool Summer"),
            ["white", "grey", "navy", "denim", "sky-blue", "lavender", "pink", "plum", "silver", "burgundy"],
            ["orange", "rust", "mustard", "camel", "gold", "terracotta", "olive"]),
        new("soft-summer", Localized.Of("Yumuşak Yaz", "Soft Summer"),
            ["taupe", "grey", "sage", "denim", "lilac", "blush", "plum", "navy", "charcoal"],
            ["orange", "yellow", "fuchsia", "cobalt", "black", "gold"]),
        new("soft-autumn", Localized.Of("Yumuşak Sonbahar", "Soft Autumn"),
            ["cream", "beige", "taupe", "camel", "olive", "sage", "khaki", "terracotta", "peach", "teal"],
            ["black", "fuchsia", "cobalt", "icy-blue", "white", "silver"]),
        new("warm-autumn", Localized.Of("Sıcak Sonbahar", "Warm Autumn"),
            ["cream", "camel", "rust", "terracotta", "mustard", "olive", "forest-green", "brown", "chocolate", "gold", "orange", "teal"],
            ["icy-blue", "fuchsia", "lavender", "silver", "black", "pink", "grey"]),
        new("deep-autumn", Localized.Of("Koyu Sonbahar", "Deep Autumn"),
            ["cream", "chocolate", "brown", "burgundy", "forest-green", "olive", "rust", "mustard", "teal", "navy", "gold"],
            ["icy-blue", "lavender", "blush", "pink", "lilac", "silver"]),
        new("deep-winter", Localized.Of("Koyu Kış", "Deep Winter"),
            ["black", "charcoal", "white", "burgundy", "emerald", "navy", "cobalt", "plum", "red", "forest-green", "silver"],
            ["peach", "camel", "mustard", "beige", "orange", "khaki"]),
        new("cool-winter", Localized.Of("Soğuk Kış", "Cool Winter"),
            ["black", "white", "grey", "navy", "cobalt", "icy-blue", "fuchsia", "emerald", "plum", "silver", "red"],
            ["orange", "rust", "mustard", "camel", "gold", "terracotta", "olive", "peach"]),
        new("bright-winter", Localized.Of("Parlak Kış", "Bright Winter"),
            ["black", "white", "fuchsia", "cobalt", "emerald", "red", "icy-blue", "turquoise", "purple", "silver"],
            ["beige", "taupe", "sage", "khaki", "mustard", "rust", "camel"]),
    ];

    private static readonly FrozenDictionary<string, SeasonTypeDefinition> ById = All.ToFrozenDictionary(s => s.Id, StringComparer.Ordinal);

    public static IReadOnlyList<string> Ids { get; } = All.Select(s => s.Id).ToList();

    public static SeasonTypeDefinition? Find(string? id) => id is not null && ById.TryGetValue(id, out var season) ? season : null;
}
