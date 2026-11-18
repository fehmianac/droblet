using Domain.Enum;

namespace Domain.Services;

/// <summary>README §9.1: phase 1 is women only. Men and Teen chips show "Yakında" and are rejected server-side (422).</summary>
public static class SegmentPolicy
{
    private static readonly HashSet<Segment> Available = [Segment.Women];

    public static bool IsAvailable(Segment segment) => Available.Contains(segment);
}
