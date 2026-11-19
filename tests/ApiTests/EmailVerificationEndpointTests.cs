using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.RegularExpressions;
using Api.Contracts;
using Domain.Entity;
using Domain.Services;
using Microsoft.Extensions.DependencyInjection;

namespace ApiTests;

/// <summary>E-mail verification (docs/api/verification-export.md §1): code + link, resend, profile flags, providers.</summary>
public partial class EmailVerificationEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [GeneratedRegex(@"\b(\d{6})\b")]
    private static partial Regex CodePattern();

    private EmailMessage LastMail(string email) => factory.Email.Sent.Last(m => m.To == email);

    private static string CodeOf(EmailMessage mail) => CodePattern().Match(mail.TextBody).Groups[1].Value;

    private static string TokenOf(EmailMessage mail) =>
        Uri.UnescapeDataString(mail.TextBody.Split("verify-email/?token=")[1].Split('\n')[0].Trim());

    private async Task<(HttpClient Client, string Email)> RegisterAsync(string language = "tr")
    {
        var email = $"{Guid.NewGuid():N}@example.com";
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.AcceptLanguage.ParseAdd(language);
        var response = await client.PostAsJsonAsync("v1/auth/register", new { name = "Ayşe", email, password = "Sifre1234", ageConfirmed = true }, ApiFactory.Json);
        response.EnsureSuccessStatusCode();
        var auth = (await response.Content.ReadFromJsonAsync<AuthResponse>(ApiFactory.Json))!;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth.AccessToken);
        return (client, email);
    }

    private static async Task<bool> VerifiedAsync(HttpClient client) =>
        (await (await client.GetAsync("v1/tenant/profile")).JsonAsync()).GetProperty("emailVerified").GetBoolean();

    [Fact]
    public async Task Register_SendsCodeAndLink_InTheRequestLanguage_ProfileUnverified_CodeVerifies()
    {
        var (client, email) = await RegisterAsync("tr");

        var mail = LastMail(email);
        Assert.StartsWith("Droblet doğrulama kodun: ", mail.Subject);
        Assert.Contains("https://droblet.alatech.co/verify-email/?token=", mail.TextBody);
        var code = CodeOf(mail);
        Assert.Matches("^[0-9]{6}$", code);
        Assert.False(await VerifiedAsync(client));

        var wrong = await client.PostJsonAsync("v1/auth/email/verify", new { code = code == "000000" ? "111111" : "000000" });
        Assert.Equal(HttpStatusCode.BadRequest, wrong.StatusCode);
        Assert.Equal("invalid_verification_code", await wrong.CodeAsync());

        var ok = await client.PostJsonAsync("v1/auth/email/verify", new { code });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        Assert.True((await ok.JsonAsync()).GetProperty("emailVerified").GetBoolean());
        var profile = await (await client.GetAsync("v1/tenant/profile")).JsonAsync();
        Assert.True(profile.GetProperty("emailVerified").GetBoolean());
        Assert.NotEqual(System.Text.Json.JsonValueKind.Null, profile.GetProperty("emailVerifiedAt").ValueKind);

        // Nothing stored in clear; the open verification is gone.
        Assert.Null(await factory.Repository.GetAsync<EmailVerificationEntity>(EmailVerificationEntity.GetPk(), EmailVerificationEntity.GetSk(await ProfileUserIdAsync(profile))));
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostJsonAsync("v1/auth/email/resend", new { })).StatusCode);
    }

    private async Task<string> ProfileUserIdAsync(System.Text.Json.JsonElement profile)
    {
        var tenantId = profile.GetProperty("tenantId").GetString();
        return (await factory.Repository.GetAllAsync<UserEntity>(UserEntity.GetPk())).Single(u => u.TenantId == tenantId).Id;
    }

    [Fact]
    public async Task Link_VerifiesSignedOut_OnlyTheLatestLinkWorks()
    {
        var (client, email) = await RegisterAsync("en");
        var first = LastMail(email);
        Assert.Equal("Your Droblet verification code: " + CodeOf(first), first.Subject);

        // Resend replaces code and link: the first link stops working.
        Assert.Equal(HttpStatusCode.Accepted, (await client.PostJsonAsync("v1/auth/email/resend", new { })).StatusCode);
        var second = LastMail(email);
        Assert.NotEqual(TokenOf(first), TokenOf(second));

        var anonymous = factory.CreateClient();
        var old = await anonymous.PostJsonAsync("v1/auth/email/verify", new { token = TokenOf(first) });
        Assert.Equal("invalid_verification_code", await old.CodeAsync());
        var oldCode = await client.PostJsonAsync("v1/auth/email/verify", new { code = CodeOf(first) });
        Assert.Equal(HttpStatusCode.BadRequest, oldCode.StatusCode);

        var ok = await anonymous.PostJsonAsync("v1/auth/email/verify", new { token = TokenOf(second) });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        Assert.True(await VerifiedAsync(client));
        // Used once more: still fine (already verified).
        Assert.Equal(HttpStatusCode.OK, (await anonymous.PostJsonAsync("v1/auth/email/verify", new { token = TokenOf(second) })).StatusCode);
    }

    [Fact]
    public async Task Resend_OncePerMinute_Then429()
    {
        var (client, _) = await RegisterAsync();
        Assert.Equal(HttpStatusCode.Accepted, (await client.PostJsonAsync("v1/auth/email/resend", new { })).StatusCode);
        var again = await client.PostJsonAsync("v1/auth/email/resend", new { });
        Assert.Equal(HttpStatusCode.TooManyRequests, again.StatusCode);
        Assert.Equal("too_many_attempts", await again.CodeAsync());
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().PostJsonAsync("v1/auth/email/resend", new { })).StatusCode);
    }

    [Fact]
    public async Task FiveWrongCodes_LockTheCode_EvenTheRightOne()
    {
        var (client, email) = await RegisterAsync();
        var code = CodeOf(LastMail(email));
        var wrong = code == "123456" ? "654321" : "123456";
        for (var i = 0; i < 4; i++)
            Assert.Equal(HttpStatusCode.BadRequest, (await client.PostJsonAsync("v1/auth/email/verify", new { code = wrong })).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await client.PostJsonAsync("v1/auth/email/verify", new { code = wrong })).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await client.PostJsonAsync("v1/auth/email/verify", new { code })).StatusCode);
        Assert.False(await VerifiedAsync(client));
    }

    [Fact]
    public async Task Validation_CodeWithoutToken_NeedsSignIn_ExactlyOneOfCodeOrToken()
    {
        var anonymous = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.PostJsonAsync("v1/auth/email/verify", new { code = "123456" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await anonymous.PostJsonAsync("v1/auth/email/verify", new { })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await anonymous.PostJsonAsync("v1/auth/email/verify", new { code = "12ab56" })).StatusCode);
        Assert.Equal("invalid_verification_code", await (await anonymous.PostJsonAsync("v1/auth/email/verify", new { token = "nope-nope-nope" })).CodeAsync());
    }

    [Fact]
    public async Task PasswordReset_ProvesTheAddress_EvenUnverified()
    {
        var (client, email) = await RegisterAsync();
        var anonymous = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Accepted, (await anonymous.PostJsonAsync("v1/auth/password/forgot", new { email })).StatusCode);
        var mail = factory.Email.Sent.Last(m => m.To == email && m.TextBody.Contains("reset-password"));
        var token = Uri.UnescapeDataString(mail.TextBody.Split("token=")[1].Split('\n')[0].Trim());
        Assert.Equal(HttpStatusCode.NoContent, (await anonymous.PostJsonAsync("v1/auth/password/reset", new { token, newPassword = "YeniSifre99" })).StatusCode);

        var login = await anonymous.PostJsonAsync("v1/auth/login", new { email, password = "YeniSifre99" });
        var auth = (await login.Content.ReadFromJsonAsync<AuthResponse>(ApiFactory.Json))!;
        anonymous.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth.AccessToken);
        Assert.True(await VerifiedAsync(anonymous));
        _ = client;
    }

    [Fact]
    public async Task AppleAndGoogle_ProviderVerified_CountAsVerified_NoMail()
    {
        var before = factory.Email.Sent.Count;
        var client = factory.CreateClient();
        var apple = await client.PostJsonAsync("v1/auth/apple", new { identityToken = $"valid:apple-{Guid.NewGuid():N}:{Guid.NewGuid():N}@privaterelay.appleid.com", nonce = "n" });
        var auth = (await apple.Content.ReadFromJsonAsync<AuthResponse>(ApiFactory.Json))!;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth.AccessToken);
        var profile = await (await client.GetAsync("v1/tenant/profile")).JsonAsync();
        Assert.True(profile.GetProperty("emailVerified").GetBoolean());
        Assert.NotEqual(System.Text.Json.JsonValueKind.Null, profile.GetProperty("emailVerifiedAt").ValueKind);
        Assert.Equal(before, factory.Email.Sent.Count);

        // Google linking to an unverified e-mail account (same address, provider-verified) verifies it.
        var (emailClient, email) = await RegisterAsync();
        Assert.False(await VerifiedAsync(emailClient));
        Assert.Equal(HttpStatusCode.OK, (await factory.CreateClient().PostJsonAsync("v1/auth/google", new { idToken = $"valid:g-{Guid.NewGuid():N}:{email}" })).StatusCode);
        Assert.True(await VerifiedAsync(emailClient));
    }

    [Fact]
    public async Task VerifiedAddress_IsListedForContactMatching()
    {
        var (client, email) = await RegisterAsync();
        var directory = factory.Services.GetRequiredService<IContactDirectory>();
        Assert.NotNull(directory);
        var profile = await (await client.GetAsync("v1/tenant/profile")).JsonAsync();
        var tenantId = profile.GetProperty("tenantId").GetString()!;
        Assert.Empty(await factory.Repository.GetAllAsync<ContactDirectoryPointerEntity>(ContactDirectoryPointerEntity.GetPk(tenantId)));

        Assert.Equal(HttpStatusCode.OK, (await client.PostJsonAsync("v1/auth/email/verify", new { code = CodeOf(LastMail(email)) })).StatusCode);
        Assert.Single(await factory.Repository.GetAllAsync<ContactDirectoryPointerEntity>(ContactDirectoryPointerEntity.GetPk(tenantId)));
    }
}
