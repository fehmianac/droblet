using Domain.Enum;
using Domain.Options;
using Domain.Services;

namespace Domain.Domain;

/// <param name="Available">Segments a user may choose now (Segments:Available); the others are shown as "Yakında".</param>
/// <param name="All">Every segment the app knows (women, men, teen), in display order.</param>
public record SegmentsDto(IReadOnlyList<Segment> Available, IReadOnlyList<Segment> All);

/// <summary>Teen mode (docs/api/teen.md §2): whether 16–17 may sign up, the age limits, whether teen try-on exists at all.</summary>
public record TeenConfigDto(bool Enabled, int MinimumAge, int AdultAge, bool TryOnEnabled)
{
    public static TeenConfigDto From(TeenOptions? options) =>
        new(options?.Enabled == true, AgeRules.MinimumAge, AgeRules.AdultAge, options?.TryOnEnabled == true);
}

public record ChoiceDto(string Id, string Name);

public record SubcategoryDto(string Id, ItemCategory Category, string Name);

/// <summary>
/// GET v1/config: what the app needs to render the segment-dependent choices. Per segment lists are keyed by the segment's
/// wire name ("women", "men"); names are in the request language (the app may keep its own labels by id).
/// </summary>
public record AppConfigDto(
    SegmentsDto Segments,
    IReadOnlyDictionary<string, IReadOnlyList<ChoiceDto>> BodyTypes,
    IReadOnlyDictionary<string, IReadOnlyList<ChoiceDto>> StyleTags,
    IReadOnlyDictionary<string, IReadOnlyList<SubcategoryDto>> Subcategories,
    TeenConfigDto? Teen = null)
{
    /// <summary>Segments with their own lists (teen is never open and has none).</summary>
    public static readonly IReadOnlyList<Segment> ListedSegments = [Segment.Women, Segment.Men];

    public static string WireName(Segment segment) => segment.ToString().ToLowerInvariant();

    /// <param name="wireName">The camelCase wire name of an enum value (the API's enum naming).</param>
    public static AppConfigDto Build(SegmentOptions options, string language, Func<System.Enum, string> wireName)
    {
        string Pick(TaxonomyLabel label) => language == "en" ? label.En : label.Tr;
        return new AppConfigDto(
            new SegmentsDto(SegmentPolicy.Available(options), System.Enum.GetValues<Segment>()),
            ListedSegments.ToDictionary(WireName, s => (IReadOnlyList<ChoiceDto>)SegmentTaxonomy.BodyTypes(s)
                .Select(b => new ChoiceDto(wireName(b), Pick(SegmentTaxonomy.BodyTypeLabel(s, b)))).ToList()),
            ListedSegments.ToDictionary(WireName, s => (IReadOnlyList<ChoiceDto>)SegmentTaxonomy.StyleTags(s)
                .Select(t => new ChoiceDto(wireName(t), Pick(SegmentTaxonomy.StyleTagLabel(t)))).ToList()),
            ListedSegments.ToDictionary(WireName, s => (IReadOnlyList<SubcategoryDto>)SubcategoryCatalog.ForSegment(s)
                .Select(e => new SubcategoryDto(e.Id, e.Category, Pick(e.Name))).ToList()));
    }
}
