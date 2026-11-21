using Domain.Enum;
using Domain.Options;

namespace Domain.Services;

/// <summary>
/// Which segments a user may choose (README §9.1). Configuration: Segments:Available (SegmentOptions). A closed segment is
/// shown as "Yakında" by the app and rejected server-side (422 segment_not_available). Teen is never open here.
/// </summary>
public static class SegmentPolicy
{
    /// <summary>Phase 1 default when nothing is configured.</summary>
    public static readonly IReadOnlyList<Segment> Default = [Segment.Women];

    /// <summary>The open segments in enum order (women before men); Teen and unknown names are dropped; an empty result falls back to women.</summary>
    public static IReadOnlyList<Segment> Available(SegmentOptions? options)
    {
        var names = options?.Available ?? [];
        var open = System.Enum.GetValues<Segment>()
            .Where(s => s != Segment.Teen && names.Any(n => string.Equals(n?.Trim(), s.ToString(), StringComparison.OrdinalIgnoreCase)))
            .ToList();
        return open.Count > 0 ? open : Default;
    }

    public static bool IsAvailable(Segment segment, SegmentOptions? options) => Available(options).Contains(segment);

    /// <summary>Does a library piece / catalog product for <paramref name="item"/> belong in the lists of a <paramref name="user"/>? Unisex = everyone.</summary>
    public static bool Shows(CatalogSegment item, Segment user) => item switch
    {
        CatalogSegment.Unisex => true,
        CatalogSegment.Women => user is Segment.Women,
        CatalogSegment.Men => user is Segment.Men,
        _ => false,
    };

    /// <summary>The user's segment; women when it was never chosen (every account from before the men launch).</summary>
    public static Segment Of(Segment? stored) => stored ?? Segment.Women;
}
