using Domain.Entity;
using Domain.Enum;

namespace Domain.Domain;

public record StyleProfileDto(Segment Segment, IReadOnlyList<StyleTag> StyleTags, Budget Budget, long Version, DateTime UpdatedAt);

public static class StyleProfileDtoMapper
{
    public static StyleProfileDto ToDto(this StyleProfileEntity entity) =>
        new(entity.Segment, entity.StyleTags, entity.Budget, entity.Version, entity.UpdatedAt);
}
