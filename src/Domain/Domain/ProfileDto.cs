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
    DateTime UpdatedAt,
    // 18+ confirmation (null = not confirmed: the app shows the confirmation screen before anything else).
    DateTime? AgeConfirmedAt = null,
    // Profile picture (public to whoever may see the closet), presigned and short-lived. Never a body / face photo.
    string? AvatarUrl = null,
    DateTime? AvatarUrlExpiresAt = null);

public static class ProfileDtoMapper
{
    public static ProfileDto ToDto(this TenantEntity entity, string? email, DateTime? ageConfirmedAt = null) => new(
        entity.Id,
        entity.DisplayName,
        entity.Handle,
        email,
        entity.ClosetVisibility,
        entity.Language,
        entity.CityId,
        entity.Version,
        entity.UpdatedAt,
        ageConfirmedAt);
}
