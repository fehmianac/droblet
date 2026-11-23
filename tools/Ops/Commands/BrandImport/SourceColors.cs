using Domain.Services;

namespace Ops.Commands.BrandImport;

/// <summary>
/// Colour names of the sites → catalog colour ids (Domain ColorCatalog). One Turkish / English dictionary for every
/// brand; a source adds the names only it uses through <see cref="IBrandCatalogSource.ExtraColors"/>. Keys are folded
/// (<see cref="SourceText.Fold"/>): lower case, Turkish letters as ASCII.
/// </summary>
internal static class SourceColors
{
    public const int MaxColors = 3;

    public static readonly IReadOnlyDictionary<string, string> Shared = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        // Turkish
        ["siyah"] = "black",
        ["antrasit"] = "charcoal", ["fume"] = "charcoal", ["koyu gri"] = "charcoal",
        ["gri"] = "grey", ["acik gri"] = "grey",
        ["gumus"] = "silver",
        ["beyaz"] = "white", ["optik beyaz"] = "white",
        ["ekru"] = "ivory", ["fildisi"] = "ivory", ["kirik beyaz"] = "ivory",
        ["krem"] = "cream",
        ["bej"] = "beige", ["tas"] = "beige", ["kum"] = "beige", ["naturel"] = "beige",
        ["vizon"] = "taupe",
        ["taba"] = "camel", ["karamel"] = "camel",
        ["kahve"] = "brown", ["kahverengi"] = "brown",
        ["cikolata"] = "chocolate", ["aci kahve"] = "chocolate", ["koyu kahve"] = "chocolate",
        ["kirmizi"] = "red",
        ["bordo"] = "burgundy",
        ["kiremit"] = "rust", ["tarcin"] = "rust",
        ["terrakota"] = "terracotta",
        ["turuncu"] = "orange", ["oranj"] = "orange",
        ["mercan"] = "coral", ["somon"] = "coral",
        ["seftali"] = "peach",
        ["hardal"] = "mustard",
        ["sari"] = "yellow",
        ["altin"] = "gold", ["dore"] = "gold",
        ["pudra"] = "blush",
        ["pembe"] = "pink",
        ["fusya"] = "fuchsia",
        ["lavanta"] = "lavender",
        ["lila"] = "lilac",
        ["mor"] = "purple",
        ["murdum"] = "plum",
        ["buz mavisi"] = "icy-blue",
        ["bebek mavisi"] = "sky-blue", ["acik mavi"] = "sky-blue",
        ["kot"] = "denim",
        ["mavi"] = "cobalt", ["saks"] = "cobalt",
        ["lacivert"] = "navy", ["koyu mavi"] = "navy",
        ["turkuaz"] = "turquoise",
        ["petrol"] = "teal",
        ["su yesili"] = "mint",
        ["adacayi"] = "sage",
        ["haki"] = "khaki",
        ["zeytin"] = "olive",
        ["yesil"] = "emerald", ["zumrut"] = "emerald",
        ["nefti"] = "forest-green", ["koyu yesil"] = "forest-green",
        // names the other Turkish stores use (Gap, Sarar, Beymen)
        ["kobalt"] = "cobalt",
        ["ten"] = "beige", ["deve tuyu"] = "camel", ["sutlu kahve"] = "taupe",
        ["visne"] = "burgundy", ["bakir"] = "rust", ["nar cicegi"] = "coral", ["gul kurusu"] = "blush",
        ["eflatun"] = "lilac", ["leylak"] = "lilac",
        ["limon"] = "yellow",
        ["cagla"] = "sage", ["yag yesili"] = "olive", ["acik yesil"] = "mint",
        ["acik kahverengi"] = "camel", ["acik kahve"] = "camel", ["acik pembe"] = "blush",

        // English (and the words both languages share)
        ["black"] = "black",
        ["charcoal"] = "charcoal", ["anthracite"] = "charcoal", ["dark grey"] = "charcoal", ["dark gray"] = "charcoal",
        ["grey"] = "grey", ["gray"] = "grey", ["light grey"] = "grey", ["light gray"] = "grey",
        ["silver"] = "silver",
        ["white"] = "white",
        ["ivory"] = "ivory", ["ecru"] = "ivory", ["off white"] = "ivory",
        ["cream"] = "cream",
        ["beige"] = "beige", ["sand"] = "beige", ["stone"] = "beige", ["natural"] = "beige", ["nude"] = "beige",
        ["taupe"] = "taupe", ["mink"] = "taupe",
        ["camel"] = "camel", ["tan"] = "camel", ["caramel"] = "camel",
        ["brown"] = "brown",
        ["chocolate"] = "chocolate", ["dark brown"] = "chocolate",
        ["red"] = "red",
        ["burgundy"] = "burgundy", ["bordeaux"] = "burgundy", ["wine"] = "burgundy",
        ["rust"] = "rust",
        ["terracotta"] = "terracotta",
        ["orange"] = "orange",
        ["coral"] = "coral", ["salmon"] = "coral",
        ["peach"] = "peach",
        ["mustard"] = "mustard",
        ["yellow"] = "yellow",
        ["gold"] = "gold",
        ["blush"] = "blush", ["powder"] = "blush",
        ["pink"] = "pink", ["rose"] = "pink",
        ["fuchsia"] = "fuchsia",
        ["lavender"] = "lavender",
        ["lilac"] = "lilac",
        ["purple"] = "purple", ["violet"] = "purple",
        ["plum"] = "plum",
        ["icy blue"] = "icy-blue", ["ice blue"] = "icy-blue",
        ["sky blue"] = "sky-blue", ["light blue"] = "sky-blue", ["baby blue"] = "sky-blue",
        ["indigo"] = "denim", ["denim"] = "denim",
        ["blue"] = "cobalt", ["cobalt"] = "cobalt",
        ["navy"] = "navy", ["dark blue"] = "navy",
        ["turquoise"] = "turquoise",
        ["teal"] = "teal",
        ["mint"] = "mint",
        ["sage"] = "sage",
        ["khaki"] = "khaki",
        ["olive"] = "olive",
        ["green"] = "emerald", ["emerald"] = "emerald",
        ["forest green"] = "forest-green", ["dark green"] = "forest-green",
    };

    /// <summary>
    /// The first name that gives a colour wins (sources list the exact colour before its family: "Bordo" before
    /// "KIRMIZI"); a name may hold several colours ("Saks-Gri", "SİYAH/BEYAZ"); a colour the catalog does not know
    /// becomes "other".
    /// </summary>
    public static IReadOnlyList<string> Normalize(IEnumerable<string?> names, IReadOnlyDictionary<string, string>? extra = null)
    {
        foreach (var name in names)
        {
            var ids = Lookup(name, extra);
            if (ids.Count > 0)
                return ids;
        }
        return [ColorCatalog.OtherId];
    }

    private static List<string> Lookup(string? text, IReadOnlyDictionary<string, string>? extra)
    {
        string? Find(string key) => extra is not null && extra.TryGetValue(key, out var own) ? own : Shared.GetValueOrDefault(key);

        var ids = new List<string>();
        foreach (var part in SourceText.Fold(text).Split(['-', '/', ',', '&', '+'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            // the whole part ("koyu yesil"), else its first known word ("koyu lacivert" → lacivert)
            var id = Find(part) ?? part.Split(' ', StringSplitOptions.RemoveEmptyEntries).Select(Find).FirstOrDefault(w => w is not null);
            if (id is not null && !ids.Contains(id) && ids.Count < MaxColors)
                ids.Add(id);
        }
        return ids;
    }
}
