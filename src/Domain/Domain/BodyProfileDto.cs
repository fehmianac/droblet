using Domain.Entity;
using Domain.Enum;

namespace Domain.Domain;

public record BodyProfileDto(int HeightCm, decimal? WeightKg, ClothingSize Size, long Version, DateTime UpdatedAt);

public static class BodyProfileDtoMapper
{
    public static BodyProfileDto ToDto(this BodyProfileEntity entity) =>
        new(entity.HeightCm, entity.WeightKg, entity.Size, entity.Version, entity.UpdatedAt);
}
