using Domain.Domain;
using Domain.Entity;
using Domain.Services;

namespace Api.Endpoints.V1.Tenant.Profile;

internal static class ProfileView
{
    /// <summary>The own profile: e-mail, age confirmation and band (teen status), a fresh presigned avatar URL.</summary>
    public static async Task<ProfileDto> ToProfileDtoAsync(this TenantEntity tenant, UserEntity? user, IAvatarService avatars, ITeenService teens, CancellationToken ct)
    {
        var avatar = await avatars.GetAsync(tenant.Id, ct);
        var teen = user is null ? null : await teens.StatusAsync(user, ct);
        return tenant.ToDto(user?.Email, user?.AgeConfirmedAt) with
        {
            AvatarUrl = avatar?.Url,
            AvatarUrlExpiresAt = avatar?.UrlExpiresAt,
            EmailVerified = user?.IsEmailVerified ?? true,
            EmailVerifiedAt = user?.EmailVerifiedAt,
            AgeBand = teen?.AgeBand,
            Teen = teen?.Teen,
        };
    }
}
