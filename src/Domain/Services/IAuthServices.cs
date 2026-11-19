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

public enum EmailVerificationOutcome { Verified, Sent, AlreadyVerified, InvalidCode, Expired, TooManyAttempts, NoEmail, UserNotFound }

/// <summary>
/// E-mail sign-up verification: a 6-digit code and a link (24 h, one open verification per user; a resend replaces
/// it). Never blocks the app; a verified address may be found by contact matching (decision 13).
/// </summary>
public interface IEmailVerificationService
{
    /// <summary>Sends a fresh code + link. Failures to send are logged, never thrown (sign-up must not fail on e-mail).</summary>
    Task<EmailVerificationOutcome> SendAsync(UserEntity user, string language, CancellationToken ct);
    /// <summary>Rate limited (1 per minute, AuthRateLimits:VerifyResendPerUserPerDay per day).</summary>
    Task<EmailVerificationOutcome> ResendAsync(string userId, string language, CancellationToken ct);
    Task<EmailVerificationOutcome> VerifyCodeAsync(string userId, string code, CancellationToken ct);
    /// <summary>The link token (signed out is fine: the web page and the app's deep link use it).</summary>
    Task<EmailVerificationOutcome> VerifyTokenAsync(string token, CancellationToken ct);
    /// <summary>Stores the address as verified (provider said so, or a password reset link proved it). Idempotent.</summary>
    Task MarkVerifiedAsync(UserEntity user, CancellationToken ct);
}

public interface IUserLookup
{
    Task<UserEntity?> FindByEmailAsync(string email, CancellationToken ct);
}
