using Domain.Entity;
using Domain.Enum;

namespace Domain.Domain;

public record ProfileDto(
    string TenantId,
    string? DisplayName,
    string? Handle,
    string? Email,
    ClosetVisibility ClosetVisibility,
    string Language,
    string? CityId,
    long Version,
    DateTime UpdatedAt);

public static class ProfileDtoMapper
{
    public static ProfileDto ToDto(this TenantEntity entity, string? email) => new(
        entity.Id,
        entity.DisplayName,
        entity.Handle,
        email,
        entity.ClosetVisibility,
        entity.Language,
        entity.CityId,
        entity.Version,
        entity.UpdatedAt);
}
