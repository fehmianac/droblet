using Domain.Enum;

namespace Ops.Commands.BrandImport;

/// <summary>
/// Category words for the sites whose product URL has no category (gap.com.tr, sarar.com, beymen.com): the garment is
/// named in the product's own name or in the page's category text, and Turkish names end with it ("Keten Karışımı
/// Maxi Elbise", "Jean Pantolon", "Şort Etek", "Triko &amp; Kazak"). <see cref="Hint"/> gives the LAST such word of a
/// text — the word a source uses as the candidate's category hint and as the slug of its
/// <see cref="IBrandCatalogSource.CategorySlugs"/> table. Words are folded (lower case, Turkish letters as ASCII);
/// "t-shirt" is one word ("tshirt").
/// </summary>
internal static class SourceCategories
{
    /// <summary>Women: order inside a category is the order the picker takes the words in.</summary>
    public static readonly IReadOnlyList<(string Slug, ProductCategory Category)> Women =
    [
        ("elbise", ProductCategory.Dress), ("tulum", ProductCategory.Dress),
        ("bluz", ProductCategory.Blouse), ("tunik", ProductCategory.Blouse),
        ("gomlek", ProductCategory.Shirt),
        ("kazak", ProductCategory.Knitwear), ("triko", ProductCategory.Knitwear), ("hirka", ProductCategory.Knitwear), ("suveter", ProductCategory.Knitwear),
        ("tshirt", ProductCategory.Tshirt), ("tisort", ProductCategory.Tshirt),
        ("sweatshirt", ProductCategory.Sweatshirt), ("hoodie", ProductCategory.Sweatshirt),
        ("ceket", ProductCategory.Jacket), ("blazer", ProductCategory.Jacket), ("mont", ProductCategory.Jacket), ("yelek", ProductCategory.Jacket),
        ("kaban", ProductCategory.Coat), ("palto", ProductCategory.Coat), ("trenckot", ProductCategory.Coat), ("pardosu", ProductCategory.Coat),
        ("manto", ProductCategory.Coat), ("parka", ProductCategory.Coat),
        ("pantolon", ProductCategory.Trousers), ("jogger", ProductCategory.Trousers),
        ("jean", ProductCategory.Jeans),
        ("etek", ProductCategory.Skirt),
        ("sort", ProductCategory.Shorts), ("bermuda", ProductCategory.Shorts),
        ("ayakkabi", ProductCategory.Shoes), ("sneaker", ProductCategory.Shoes), ("sneakers", ProductCategory.Shoes), ("bot", ProductCategory.Shoes),
        ("cizme", ProductCategory.Shoes), ("loafer", ProductCategory.Shoes), ("babet", ProductCategory.Shoes), ("sandalet", ProductCategory.Shoes),
        ("terlik", ProductCategory.Shoes), ("espadril", ProductCategory.Shoes),
        ("canta", ProductCategory.Bag), ("cantasi", ProductCategory.Bag),
        ("mayo", ProductCategory.Swimwear), ("bikini", ProductCategory.Swimwear),
        ("esofman", ProductCategory.Activewear), ("tayt", ProductCategory.Activewear),
    ];

    /// <summary>Men: the same words without the women-only garments (dress, blouse, skirt …).</summary>
    public static readonly IReadOnlyList<(string Slug, ProductCategory Category)> Men =
    [
        ("gomlek", ProductCategory.Shirt),
        ("kazak", ProductCategory.Knitwear), ("triko", ProductCategory.Knitwear), ("hirka", ProductCategory.Knitwear), ("suveter", ProductCategory.Knitwear),
        ("tshirt", ProductCategory.Tshirt), ("tisort", ProductCategory.Tshirt),
        ("sweatshirt", ProductCategory.Sweatshirt), ("hoodie", ProductCategory.Sweatshirt),
        ("ceket", ProductCategory.Jacket), ("blazer", ProductCategory.Jacket), ("mont", ProductCategory.Jacket), ("yelek", ProductCategory.Jacket),
        ("kaban", ProductCategory.Coat), ("palto", ProductCategory.Coat), ("trenckot", ProductCategory.Coat), ("pardosu", ProductCategory.Coat),
        ("parka", ProductCategory.Coat),
        ("pantolon", ProductCategory.Trousers), ("jogger", ProductCategory.Trousers),
        ("jean", ProductCategory.Jeans),
        ("sort", ProductCategory.Shorts), ("bermuda", ProductCategory.Shorts),
        ("ayakkabi", ProductCategory.Shoes), ("sneaker", ProductCategory.Shoes), ("sneakers", ProductCategory.Shoes), ("bot", ProductCategory.Shoes),
        ("loafer", ProductCategory.Shoes), ("sandalet", ProductCategory.Shoes), ("terlik", ProductCategory.Shoes), ("espadril", ProductCategory.Shoes),
        ("canta", ProductCategory.Bag), ("cantasi", ProductCategory.Bag),
        ("mayo", ProductCategory.Swimwear),
        ("esofman", ProductCategory.Activewear),
    ];

    public static IReadOnlyList<(string Slug, ProductCategory Category)> For(CatalogSegment segment) => segment == CatalogSegment.Men ? Men : Women;

    private static readonly HashSet<string> Words = Women.Concat(Men).Select(w => w.Slug).ToHashSet(StringComparer.Ordinal);

    /// <summary>
    /// A text with one of these is not a catalog product whatever else it says: children's lines, underwear, nightwear,
    /// socks, suits and tuxedos (no category), small accessories ("deri çanta aksesuarı", "kemer"), home textiles.
    /// </summary>
    public static readonly IReadOnlySet<string> StopWords = new HashSet<string>(StringComparer.Ordinal)
    {
        "cocuk", "kids", "bebek", "baby", "babygap", "toddler",
        "boxer", "atlet", "sutyen", "kulot", "pijama", "gecelik", "sabahlik", "corap", "bornoz",
        "takim", "smokin", "damatlik",
        "aksesuar", "aksesuari", "kemer", "kravat", "papyon", "cuzdan", "kartlik", "sapka", "bere", "atki", "eldiven", "sal", "esarp", "mendil",
        "nevresim", "carsaf", "yastik", "havlusu", "pike", "battaniye",
    };

    /// <summary>
    /// The last category word of a name, a URL slug or a category path ("Erkek &gt; Dış Giyim &gt; Palto" → "palto");
    /// null when it has none or holds a stop word (<paramref name="stopped"/> tells the two apart).
    /// </summary>
    public static string? Hint(string? text, out bool stopped)
    {
        stopped = false;
        var folded = SourceText.Fold(text).Replace("t-shirt", "tshirt", StringComparison.Ordinal).Replace("t shirt", "tshirt", StringComparison.Ordinal);
        var words = folded.Split([' ', '-', '/', '>', '&', ',', '.', '(', ')', '_', '\''], StringSplitOptions.RemoveEmptyEntries);
        if (words.Any(StopWords.Contains))
        {
            stopped = true;
            return null;
        }
        return words.LastOrDefault(Words.Contains);
    }

    public static string? Hint(string? text) => Hint(text, out _);

    /// <summary>The page's category text decides; without a category word in it, the candidate's hint (from the URL) stands — unless the page names a stop word.</summary>
    public static string? HintOf(string? pageCategory, string? candidateHint) =>
        Hint(pageCategory, out var stopped) ?? (stopped ? null : candidateHint);
}
