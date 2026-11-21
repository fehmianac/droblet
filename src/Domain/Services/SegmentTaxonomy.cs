using Domain.Enum;

namespace Domain.Services;

/// <summary>A choice the app shows per segment (body type, style tag, sub-type) with its names (tr / en; the app may keep its own labels).</summary>
public sealed record TaxonomyLabel(string Tr, string En)
{
    public IReadOnlyDictionary<string, string> ToMap() => new Dictionary<string, string>(StringComparer.Ordinal) { ["tr"] = Tr, ["en"] = En };
}

/// <summary>
/// Per segment choices that are not configuration: body types (canvas 11, the face try-on path) and style tags
/// (onboarding / Profil › Stil). Women's lists are exactly the phase 1 lists. Sub-types: <see cref="SubcategoryCatalog"/>.
/// Teen has no lists of its own (never open) and uses the women's ones.
/// </summary>
public static class SegmentTaxonomy
{
    private static readonly IReadOnlyList<BodyType> WomenBodyTypes =
        [BodyType.Hourglass, BodyType.Pear, BodyType.Apple, BodyType.Rectangle, BodyType.InvertedTriangle, BodyType.Unsure];

    private static readonly IReadOnlyList<BodyType> MenBodyTypes =
        [BodyType.Rectangle, BodyType.InvertedTriangle, BodyType.Triangle, BodyType.Oval, BodyType.Trapezoid, BodyType.Unsure];

    private static readonly IReadOnlyList<StyleTag> WomenStyleTags =
    [
        StyleTag.Minimal, StyleTag.Classic, StyleTag.QuietLuxury, StyleTag.Street, StyleTag.Boho, StyleTag.Sporty, StyleTag.Romantic,
        StyleTag.OfficeChic, StyleTag.Colorful, StyleTag.Vintage,
    ];

    private static readonly IReadOnlyList<StyleTag> MenStyleTags =
    [
        StyleTag.Minimal, StyleTag.Classic, StyleTag.SmartCasual, StyleTag.Tailored, StyleTag.QuietLuxury, StyleTag.Street, StyleTag.Sporty,
        StyleTag.Vintage, StyleTag.Colorful,
    ];

    public static IReadOnlyList<BodyType> BodyTypes(Segment segment) => segment == Segment.Men ? MenBodyTypes : WomenBodyTypes;

    public static bool AllowsBodyType(Segment segment, BodyType bodyType) => BodyTypes(segment).Contains(bodyType);

    public static IReadOnlyList<StyleTag> StyleTags(Segment segment) => segment == Segment.Men ? MenStyleTags : WomenStyleTags;

    public static bool AllowsStyleTag(Segment segment, StyleTag tag) => StyleTags(segment).Contains(tag);

    /// <summary>Body type names; the men's wording differs for the shared ids (rectangle, inverted triangle = V shape).</summary>
    public static TaxonomyLabel BodyTypeLabel(Segment segment, BodyType bodyType) => (segment == Segment.Men, bodyType) switch
    {
        (false, BodyType.Hourglass) => new("Kum saati", "Hourglass"),
        (false, BodyType.Pear) => new("Armut", "Pear"),
        (false, BodyType.Apple) => new("Elma", "Apple"),
        (false, BodyType.Rectangle) => new("Dikdörtgen", "Rectangle"),
        (false, BodyType.InvertedTriangle) => new("Ters üçgen", "Inverted triangle"),
        (true, BodyType.Rectangle) => new("Dikdörtgen (düz)", "Rectangle (straight)"),
        (true, BodyType.InvertedTriangle) => new("Ters üçgen (V)", "Inverted triangle (V shape)"),
        (true, BodyType.Triangle) => new("Üçgen", "Triangle"),
        (true, BodyType.Oval) => new("Oval", "Oval"),
        (true, BodyType.Trapezoid) => new("Yamuk (atletik)", "Trapezoid (athletic)"),
        _ => new("Emin değilim", "Not sure"),
    };

    public static TaxonomyLabel StyleTagLabel(StyleTag tag) => tag switch
    {
        StyleTag.Minimal => new("Minimal", "Minimal"),
        StyleTag.Classic => new("Klasik", "Classic"),
        StyleTag.QuietLuxury => new("Sessiz lüks", "Quiet luxury"),
        StyleTag.Street => new("Sokak", "Street"),
        StyleTag.Boho => new("Bohem", "Boho"),
        StyleTag.Sporty => new("Sportif", "Sporty"),
        StyleTag.Romantic => new("Romantik", "Romantic"),
        StyleTag.OfficeChic => new("Ofis şıklığı", "Office chic"),
        StyleTag.Colorful => new("Renkli", "Colourful"),
        StyleTag.Vintage => new("Vintage", "Vintage"),
        StyleTag.SmartCasual => new("Smart casual", "Smart casual"),
        StyleTag.Tailored => new("Terzi kesim", "Tailored"),
        _ => new(tag.ToString(), tag.ToString()),
    };
}
