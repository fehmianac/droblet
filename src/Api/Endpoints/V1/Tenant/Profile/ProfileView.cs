using Domain.Domain;
using Domain.Entity;
using Domain.Services;

namespace Api.Endpoints.V1.Tenant.Profile;

internal static class ProfileView
{
    /// <summary>The own profile: e-mail, 18+ confirmation and a fresh presigned avatar URL.</summary>
    public static async Task<ProfileDto> ToProfileDtoAsync(this TenantEntity tenant, UserEntity? user, IAvatarService avatars, CancellationToken ct)
    {
        var avatar = await avatars.GetAsync(tenant.Id, ct);
        return tenant.ToDto(user?.Email, user?.AgeConfirmedAt) with { AvatarUrl = avatar?.Url, AvatarUrlExpiresAt = avatar?.UrlExpiresAt };
    }
}
