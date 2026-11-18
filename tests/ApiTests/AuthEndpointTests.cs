using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Api.Contracts;
using Domain.Entity;

namespace ApiTests;

public class AuthEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Register_ReturnsTokensAndCreatesTenant()
    {
        var (_, auth) = await factory.RegisterAsync();

        Assert.False(string.IsNullOrEmpty(auth.AccessToken));
        Assert.False(string.IsNullOrEmpty(auth.RefreshToken));
        Assert.True(auth.IsNewUser);
        Assert.NotNull(await factory.Repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(auth.TenantId)));
    }

    [Fact]
    public async Task Register_SameEmailDifferentCase_409EmailTaken()
    {
        var email = $"{Guid.NewGuid():N}@Example.com";
        await factory.RegisterAsync(email);

        var response = await factory.CreateClient().PostJsonAsync("v1/auth/register", new { name = "X", email = email.ToUpperInvariant(), password = "Sifre1234" });

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("email_taken", await response.CodeAsync());
    }

    [Fact]
    public async Task Register_InvalidBody_400WithSnakeCaseFieldCodes()
    {
        var response = await factory.CreateClient().PostJsonAsync("v1/auth/register", new { name = "", email = "nope", password = "short" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.JsonAsync();
        Assert.Equal("validation_failed", body.GetProperty("code").GetString());
        var errors = body.GetProperty("errors");
        Assert.Equal("password_too_short", errors.GetProperty("password")[0].GetString());
        Assert.Equal("email_invalid", errors.GetProperty("email")[0].GetString());
        Assert.Equal("name_required", errors.GetProperty("name")[0].GetString());
    }

    [Fact]
    public async Task Login_WrongPasswordAndUnknownEmail_SameAnswer()
    {
        var email = $"{Guid.NewGuid():N}@example.com";
        await factory.RegisterAsync(email);
        var client = factory.CreateClient();

        var wrongPassword = await client.PostJsonAsync("v1/auth/login", new { email, password = "WrongPass1" });
        var unknown = await client.PostJsonAsync("v1/auth/login", new { email = "nobody@example.com", password = "WrongPass1" });

        Assert.Equal(HttpStatusCode.Unauthorized, wrongPassword.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, unknown.StatusCode);
        Assert.Equal("invalid_credentials", await wrongPassword.CodeAsync());
        Assert.Equal("invalid_credentials", await unknown.CodeAsync());
    }

    [Fact]
    public async Task Login_CorrectPassword_ReturnsTokensForSameTenant()
    {
        var email = $"{Guid.NewGuid():N}@example.com";
        var (_, registered) = await factory.RegisterAsync(email);

        var response = await factory.CreateClient().PostJsonAsync("v1/auth/login", new { email = $"  {email.ToUpperInvariant()} ", password = "Sifre1234" });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var auth = await response.Content.ReadFromJsonAsync<AuthResponse>(ApiFactory.Json);
        Assert.Equal(registered.TenantId, auth!.TenantId);
        Assert.False(auth.IsNewUser);
    }

    [Fact]
    public async Task Login_TooManyAttempts_429()
    {
        var email = $"{Guid.NewGuid():N}@example.com";
        var client = factory.CreateClient();
        HttpResponseMessage last = null!;
        for (var i = 0; i < 11; i++)
            last = await client.PostJsonAsync("v1/auth/login", new { email, password = "WrongPass1" });

        Assert.Equal(HttpStatusCode.TooManyRequests, last.StatusCode);
        Assert.Equal("too_many_attempts", await last.CodeAsync());
    }

    [Fact]
    public async Task Refresh_RotatesToken_ReuseRevokesAllSessions()
    {
        var (_, auth) = await factory.RegisterAsync();
        var client = factory.CreateClient();

        var first = await client.PostJsonAsync("v1/auth/refresh", new { refreshToken = auth.RefreshToken });
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        var rotated = (await first.Content.ReadFromJsonAsync<AuthResponse>(ApiFactory.Json))!;
        Assert.NotEqual(auth.RefreshToken, rotated.RefreshToken);

        var reuse = await client.PostJsonAsync("v1/auth/refresh", new { refreshToken = auth.RefreshToken });
        Assert.Equal(HttpStatusCode.Unauthorized, reuse.StatusCode);
        Assert.Equal("invalid_refresh_token", await reuse.CodeAsync());

        // The legit rotated token is revoked too (theft assumed).
        var afterTheft = await client.PostJsonAsync("v1/auth/refresh", new { refreshToken = rotated.RefreshToken });
        Assert.Equal(HttpStatusCode.Unauthorized, afterTheft.StatusCode);
    }

    [Fact]
    public async Task ForgotAndReset_ChangesPassword_SingleUseToken_RevokesSessions()
    {
        var email = $"{Guid.NewGuid():N}@example.com";
        var (_, auth) = await factory.RegisterAsync(email);
        var client = factory.CreateClient();

        var forgot = await client.PostJsonAsync("v1/auth/password/forgot", new { email });
        Assert.Equal(HttpStatusCode.Accepted, forgot.StatusCode);
        var mail = factory.Email.Sent.Last(m => m.To == email);
        Assert.Contains("https://droplet.alatech.co/reset-password?token=", mail.TextBody);
        var token = Uri.UnescapeDataString(mail.TextBody.Split("token=")[1].Split('\n')[0].Trim());

        var reset = await client.PostJsonAsync("v1/auth/password/reset", new { token, newPassword = "YeniSifre99" });
        Assert.Equal(HttpStatusCode.NoContent, reset.StatusCode);

        var again = await client.PostJsonAsync("v1/auth/password/reset", new { token, newPassword = "Baska12345" });
        Assert.Equal("invalid_or_expired_token", await again.CodeAsync());

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostJsonAsync("v1/auth/login", new { email, password = "Sifre1234" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PostJsonAsync("v1/auth/login", new { email, password = "YeniSifre99" })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostJsonAsync("v1/auth/refresh", new { refreshToken = auth.RefreshToken })).StatusCode);
    }

    [Fact]
    public async Task Forgot_UnknownEmail_Still202_NoEmail()
    {
        var before = factory.Email.Sent.Count;

        var response = await factory.CreateClient().PostJsonAsync("v1/auth/password/forgot", new { email = "ghost@example.com" });

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        Assert.Equal(before, factory.Email.Sent.Count);
    }

    [Fact]
    public async Task Apple_FirstSignInCreatesAccount_SecondSignsIn_InvalidRejected()
    {
        var client = factory.CreateClient();
        var token = $"valid:apple-{Guid.NewGuid():N}:relay@privaterelay.appleid.com";

        var first = await client.PostJsonAsync("v1/auth/apple", new { identityToken = token, nonce = "n", fullName = new { givenName = "Ayşe", familyName = "Yılmaz" } });
        var second = await client.PostJsonAsync("v1/auth/apple", new { identityToken = token, nonce = "n" });
        var invalid = await client.PostJsonAsync("v1/auth/apple", new { identityToken = "forged", nonce = "n" });

        var a = (await first.Content.ReadFromJsonAsync<AuthResponse>(ApiFactory.Json))!;
        var b = (await second.Content.ReadFromJsonAsync<AuthResponse>(ApiFactory.Json))!;
        Assert.True(a.IsNewUser);
        Assert.False(b.IsNewUser);
        Assert.Equal(a.TenantId, b.TenantId);
        Assert.Equal(HttpStatusCode.Unauthorized, invalid.StatusCode);
        Assert.Equal("invalid_identity_token", await invalid.CodeAsync());
        var user = await factory.Repository.GetAsync<UserEntity>(UserEntity.GetPk(), UserEntity.GetSk(a.UserId));
        Assert.Equal("Ayşe Yılmaz", user!.DisplayName);
    }

    [Fact]
    public async Task Google_VerifiedEmailOfExistingAccount_LinksToIt()
    {
        var email = $"{Guid.NewGuid():N}@example.com";
        var (_, registered) = await factory.RegisterAsync(email);

        var response = await factory.CreateClient().PostJsonAsync("v1/auth/google", new { idToken = $"valid:g-{Guid.NewGuid():N}:{email}" });

        var auth = (await response.Content.ReadFromJsonAsync<AuthResponse>(ApiFactory.Json))!;
        Assert.Equal(registered.TenantId, auth.TenantId);
    }

    [Fact]
    public async Task Logout_RevokesRefreshToken()
    {
        var (client, auth) = await factory.RegisterAsync();

        Assert.Equal(HttpStatusCode.NoContent, (await client.PostJsonAsync("v1/auth/logout", new { refreshToken = auth.RefreshToken })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostJsonAsync("v1/auth/refresh", new { refreshToken = auth.RefreshToken })).StatusCode);
    }

    [Fact]
    public async Task TenantEndpoints_WithoutOrWithBadToken_401()
    {
        var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("v1/tenant/profile")).StatusCode);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "eyJhbGciOiJIUzI1NiJ9.e30.invalid");
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("v1/tenant/profile")).StatusCode);
    }

    [Fact]
    public async Task DeleteMe_RemovesAccount_LoginFailsAfterwards()
    {
        var email = $"{Guid.NewGuid():N}@example.com";
        var (client, auth) = await factory.RegisterAsync(email);
        await client.PutJsonAsync("v1/tenant/profile/handle", new { handle = $"del{Guid.NewGuid():N}"[..20] });

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync("v1/auth/me")).StatusCode);

        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().PostJsonAsync("v1/auth/login", new { email, password = "Sifre1234" })).StatusCode);
        Assert.DoesNotContain(factory.Repository.PartitionKeys, pk => pk.Contains(auth.TenantId));
        Assert.Null(await factory.Repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(auth.TenantId)));
    }
}
