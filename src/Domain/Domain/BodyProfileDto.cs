using Domain.Entity;
using Domain.Enum;

namespace Domain.Domain;

/// <param name="BodyType">Canvas 11 vücut tipi (null = not chosen yet); used by the face try-on path.</param>
public record BodyProfileDto(int HeightCm, decimal? WeightKg, ClothingSize Size, long Version, DateTime UpdatedAt, BodyType? BodyType = null);

public static class BodyProfileDtoMapper
{
    public static BodyProfileDto ToDto(this BodyProfileEntity entity) =>
        new(entity.HeightCm, entity.WeightKg, entity.Size, entity.Version, entity.UpdatedAt, entity.BodyType);
}
