using Domain.Entity;

namespace Domain.Services;

public enum PasswordVerification { Failed, Success, SuccessRehashNeeded }

public interface IPasswordHasher
{
    string Hash(string password);
    PasswordVerification Verify(string password, string encodedHash);
}

public sealed record AccessToken(string Value, DateTime ExpiresAt);

public interface ITokenService
{
    AccessToken CreateAccessToken(string userId, string tenantId);
    /// <summary>Opaque, high-entropy refresh token value. Only its SHA-256 is stored.</summary>
    string CreateRefreshTokenValue();
}

public sealed record ExternalIdentity(string Subject, string? Email, bool EmailVerified);

/// <summary>Thrown when a provider has no configured audience/client id — surfaced as 503 provider_not_configured.</summary>
public sealed class ProviderNotConfiguredException(string provider) : Exception($"{provider} sign-in is not configured.");

public interface IAppleIdentityVerifier
{
    /// <summary>Validates signature (Apple JWKS), iss, aud (bundle id), exp and nonce. Null when invalid.</summary>
    Task<ExternalIdentity?> VerifyAsync(string identityToken, string nonce, CancellationToken ct);
}

public interface IGoogleIdentityVerifier
{
    /// <summary>Validates signature (Google JWKS), iss, aud (client ids) and exp. Null when invalid.</summary>
    Task<ExternalIdentity?> VerifyAsync(string idToken, CancellationToken ct);
}

public sealed record AuthTokens(
    string AccessToken,
    DateTime AccessTokenExpiresAt,
    string RefreshToken,
    DateTime RefreshTokenExpiresAt,
    string UserId,
    string TenantId,
    bool IsNewUser);

public enum AuthOutcome { Success, EmailTaken, InvalidCredentials, InvalidToken, TooManyAttempts, Suspended }

public sealed record AuthResult(AuthOutcome Outcome, AuthTokens? Tokens = null)
{
    public static AuthResult Ok(AuthTokens tokens) => new(AuthOutcome.Success, tokens);
    public static AuthResult Fail(AuthOutcome outcome) => new(outcome);
}

public interface IAuthService
{
    /// <summary>Callers have checked the 18+ confirmation: the new user is stored with AgeConfirmedAt = now.</summary>
    Task<AuthResult> RegisterAsync(string name, string email, string password, string language, string? clientIp, CancellationToken ct);
    Task<AuthResult> LoginAsync(string email, string password, string? clientIp, CancellationToken ct);
    /// <summary>Always completes quietly (202 regardless of whether the account exists).</summary>
    Task RequestPasswordResetAsync(string email, string language, CancellationToken ct);
    Task<AuthOutcome> ResetPasswordAsync(string token, string newPassword, CancellationToken ct);
    Task<AuthResult> RefreshAsync(string refreshToken, CancellationToken ct);
    Task LogoutAsync(string userId, string tenantId, string? refreshToken, string? deviceId, CancellationToken ct);
    Task<AuthResult> SignInExternalAsync(Enum.AuthProvider provider, ExternalIdentity identity, string? displayName, string language, CancellationToken ct);
}

public interface IAccountDeletionService
{
    Task DeleteAccountAsync(string userId, string tenantId, CancellationToken ct);
}

public interface IRateLimiter
{
    /// <summary>Fixed-window counter. Returns false when the limit is exceeded. The key is hashed before storage.</summary>
    Task<bool> TryAcquireAsync(string scope, string key, int limit, TimeSpan window, CancellationToken ct);
}

public sealed record EmailMessage(string To, string Subject, string TextBody, string HtmlBody);

public interface IEmailService
{
    Task SendAsync(EmailMessage message, CancellationToken ct);
}

public interface IUserLookup
{
    Task<UserEntity?> FindByEmailAsync(string email, CancellationToken ct);
}
