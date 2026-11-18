using System.Security.Cryptography;
using System.Text;
using Domain.Constant;
using Domain.Extensions;
using Domain.Options;
using Domain.Services;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Infrastructure.Services;

public sealed class TokenService(IOptions<JwtOptions> options, TimeProvider timeProvider) : ITokenService
{
    public AccessToken CreateAccessToken(string userId, string tenantId)
    {
        var jwt = options.Value;
        var now = timeProvider.GetUtcNow().UtcDateTime;
        var expires = now.AddMinutes(jwt.ExpirationMinutes);

        var token = new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = jwt.Issuer,
            Audience = jwt.Audience,
            IssuedAt = now,
            NotBefore = now,
            Expires = expires,
            Claims = new Dictionary<string, object>
            {
                [ClaimNames.Subject] = userId,
                [ClaimNames.TenantId] = tenantId,
                [ClaimNames.TokenId] = Ulid.New(now),
            },
            SigningCredentials = new SigningCredentials(SigningKey(jwt), SecurityAlgorithms.HmacSha256),
        });

        return new AccessToken(token, expires);
    }

    public string CreateRefreshTokenValue() => Base64UrlEncoder.Encode(RandomNumberGenerator.GetBytes(32));

    public static SymmetricSecurityKey SigningKey(JwtOptions jwt)
    {
        if (string.IsNullOrEmpty(jwt.SecretKey) || jwt.SecretKey.Length < 32)
            throw new InvalidOperationException("Jwt.SecretKey must be at least 32 characters (SSM /droblet/{stage}/api/Jwt).");
        return new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.SecretKey));
    }
}
