using Domain.Enum;

namespace Domain.Entity.Base;

/// <summary>
/// UGC a moderator can remove (look, item, the profile's public fields). The flag hides the content from every other
/// tenant; the owner keeps seeing it with a read-only <c>moderation</c> field. Set and cleared only by the moderation service.
/// </summary>
public interface IModeratedEntity : IVersionedEntity
{
    DateTime? ModerationHiddenAt { get; set; }
    string? ModerationReportId { get; set; }
    ReportReason? ModerationReason { get; set; }
}

public static class ModeratedEntityExtensions
{
    public static bool IsModerationHidden(this IModeratedEntity entity) => entity.ModerationHiddenAt is not null;
}
