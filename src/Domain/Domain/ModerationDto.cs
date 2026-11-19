using Domain.Entity.Base;
using Domain.Enum;

namespace Domain.Domain;

/// <summary>
/// Read-only, owner-only: a moderator removed this content (report resolved as contentRemoved), so nobody else sees it.
/// Null when the content is not hidden. Owner edits never clear it; only an admin restore does.
/// </summary>
public record ModerationDto(bool Hidden, ReportReason? Reason);

public static class ModerationDtoMapper
{
    public static ModerationDto? ToModerationDto(this IModeratedEntity entity) =>
        entity.ModerationHiddenAt is null ? null : new ModerationDto(true, entity.ModerationReason);
}
