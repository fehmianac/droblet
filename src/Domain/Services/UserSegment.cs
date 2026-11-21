using Domain.Entity;
using Domain.Enum;
using Domain.Manager;

namespace Domain.Services;

/// <summary>
/// The user's segment as the lists see it: the style profile's segment (the source of truth, Profil › Stil), women when the
/// user never chose one. Changing it re-filters the library and the catalog on the next read; the wardrobe is never touched.
/// </summary>
public static class UserSegment
{
    public static async Task<Segment> UserSegmentAsync(this IRepository repository, string tenantId, CancellationToken ct)
    {
        var style = await repository.GetAsync<StyleProfileEntity>(StyleProfileEntity.GetPk(tenantId), StyleProfileEntity.GetSk(), ct);
        return style?.Segment ?? Segment.Women;
    }
}
