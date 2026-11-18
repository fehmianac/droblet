using System.Security.Cryptography;
using System.Text;
using Domain.Constant;
using Domain.Entity;
using Domain.Extensions;
using Domain.Options;
using Domain.Services;
using Domain.Services.Admin;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Infrastructure.Services.Admin;

/// <summary>
/// Admin access tokens: HS256 with the admin key (never the app key), issuer droblet-admin, audience
/// droblet-admin-panel, claim typ=admin. Role is NOT trusted from the token — it is re-read from the admin row on
/// every request, so a role change or a disable applies immediately.
/// </summary>
public sealed class AdminTokenService(IOptions<AdminJwtOptions> options, IOptions<JwtOptions> appJwt, TimeProvider timeProvider) : IAdminTokenService
{
    public const string TokenType = "admin";

    public AccessToken CreateAccessToken(AdminUserEntity admin)
    {
        var jwt = options.Value;
        var now = timeProvider.GetUtcNow().UtcDateTime;
        var expires = now.AddMinutes(jwt.AccessTokenMinutes);
        var token = new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = jwt.Issuer,
            Audience = jwt.Audience,
            IssuedAt = now,
            NotBefore = now,
            Expires = expires,
            Claims = new Dictionary<string, object>
            {
                [ClaimNames.Subject] = admin.Id,
                [ClaimNames.TokenType] = TokenType,
                [ClaimNames.TokenId] = Ulid.New(now),
            },
            SigningCredentials = new SigningCredentials(SigningKey(jwt, appJwt.Value), SecurityAlgorithms.HmacSha256),
        });
        return new AccessToken(token, expires);
    }

    public string CreateOpaqueToken() => Base64UrlEncoder.Encode(RandomNumberGenerator.GetBytes(32));

    /// <summary>The admin key must exist, be long enough and differ from the app key (otherwise the token separation is void).</summary>
    public static SymmetricSecurityKey SigningKey(AdminJwtOptions jwt, JwtOptions appJwt)
    {
        if (string.IsNullOrEmpty(jwt.SecretKey) || jwt.SecretKey.Length < 32 || !ConfigSecret.IsSet(jwt.SecretKey))
            throw new InvalidOperationException("AdminJwt.SecretKey must be at least 32 characters (SSM /droblet/{stage}/api/AdminJwt).");
        if (string.Equals(jwt.SecretKey, appJwt.SecretKey, StringComparison.Ordinal))
            throw new InvalidOperationException("AdminJwt.SecretKey must differ from Jwt.SecretKey.");
        return new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.SecretKey));
    }
}
