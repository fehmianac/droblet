using Domain.Options;
using Domain.Services;
using Infrastructure.Services;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;

namespace InfrastructureTests;

public class PasswordHasherTests
{
    [Fact]
    public void Hash_ThenVerify_Succeeds_AndUsesPbkdf2Format()
    {
        var hasher = new PasswordHasher(1_000);

        var hash = hasher.Hash("correct horse");

        Assert.StartsWith("pbkdf2-sha256$1000$", hash);
        Assert.Equal(PasswordVerification.Success, hasher.Verify("correct horse", hash));
        Assert.Equal(PasswordVerification.Failed, hasher.Verify("wrong horse", hash));
    }

    [Fact]
    public void Hash_IsSalted()
    {
        var hasher = new PasswordHasher(1_000);
        Assert.NotEqual(hasher.Hash("same"), hasher.Hash("same"));
    }

    [Fact]
    public void Verify_WhenStoredWithFewerIterations_AsksForRehash()
    {
        var old = new PasswordHasher(1_000).Hash("pw123456");

        Assert.Equal(PasswordVerification.SuccessRehashNeeded, new PasswordHasher(2_000).Verify("pw123456", old));
    }

    [Theory]
    [InlineData("")]
    [InlineData("plain")]
    [InlineData("pbkdf2-sha256$abc$AAAA$AAAA")]
    [InlineData("pbkdf2-sha256$1000$!!notbase64$AAAA")]
    [InlineData("bcrypt$1000$AAAA$AAAA")]
    public void Verify_WhenEncodedHashMalformed_Fails(string encoded) =>
        Assert.Equal(PasswordVerification.Failed, new PasswordHasher(1_000).Verify("x", encoded));

    [Fact]
    public void Default_IsAtLeast600kIterations() => Assert.True(PasswordHasher.DefaultIterations >= 600_000);
}

public class TokenServiceTests
{
    private static readonly JwtOptions Jwt = new() { SecretKey = new string('k', 48), Issuer = "droblet", Audience = "droblet-app", ExpirationMinutes = 60 };

    [Fact]
    public void CreateAccessToken_CarriesSubAndTenant_NoTierClaim()
    {
        var service = new TokenService(Options.Create(Jwt), Fixtures.Clock());

        var token = service.CreateAccessToken("user1", "tenant1");

        var jwt = new JsonWebToken(token.Value);
        Assert.Equal("user1", jwt.GetClaim("sub").Value);
        Assert.Equal("tenant1", jwt.GetClaim("tid").Value);
        Assert.False(jwt.TryGetClaim("tier", out _));
        Assert.Equal(Fixtures.Now.AddMinutes(60), token.ExpiresAt);
    }

    [Fact]
    public void CreateRefreshTokenValue_IsRandomAndLong()
    {
        var service = new TokenService(Options.Create(Jwt), Fixtures.Clock());
        var a = service.CreateRefreshTokenValue();

        Assert.True(a.Length >= 43);
        Assert.NotEqual(a, service.CreateRefreshTokenValue());
    }

    [Fact]
    public void SigningKey_WhenSecretTooShort_Throws() =>
        Assert.Throws<InvalidOperationException>(() => TokenService.SigningKey(new JwtOptions { SecretKey = "short" }));
}
