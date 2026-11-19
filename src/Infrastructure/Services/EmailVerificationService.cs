using System.Security.Cryptography;
using Domain.Entity;
using Domain.Extensions;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace Infrastructure.Services;

/// <summary>
/// E-mail verification after an e-mail sign-up: a 6-digit code (typed in the app) and a link token (the web page /
/// the app's deep link), both valid 24 hours. Only hashes are stored; logs never carry the address, code or token.
/// </summary>
public sealed class EmailVerificationService(
    IRepository repository,
    IEmailService emailService,
    IRateLimiter rateLimiter,
    IContactDirectory contactDirectory,
    IOptions<AppLinksOptions> appLinks,
    IOptions<AuthRateLimitOptions> rateLimits,
    TimeProvider timeProvider,
    ILogger<EmailVerificationService> logger) : IEmailVerificationService
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromHours(24);
    public static readonly TimeSpan ResendCooldown = TimeSpan.FromSeconds(60);

    private DateTime Now => timeProvider.GetUtcNow().UtcDateTime;

    public async Task<EmailVerificationOutcome> SendAsync(UserEntity user, string language, CancellationToken ct)
    {
        if (user.IsEmailVerified)
            return EmailVerificationOutcome.AlreadyVerified;
        if (string.IsNullOrEmpty(user.Email))
            return EmailVerificationOutcome.NoEmail;

        var now = Now;
        var code = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6", System.Globalization.CultureInfo.InvariantCulture);
        var token = Base64UrlEncoder.Encode(RandomNumberGenerator.GetBytes(32));
        var tokenHash = token.Sha256Hex();
        var expiresAt = now.Add(Lifetime);

        // One open verification per user: the new row replaces the old one, so an older code or link stops working.
        await repository.TransactWriteAsync(
        [
            TransactWriteOperation.Put(new EmailVerificationEntity
            {
                UserId = user.Id,
                Email = user.Email,
                CodeHash = CodeHash(user.Id, code),
                TokenHash = tokenHash,
                CreatedAt = now,
                ExpiresAt = expiresAt,
            }),
            TransactWriteOperation.Put(new EmailVerificationTokenEntity { TokenHash = tokenHash, UserId = user.Id, ExpiresAt = expiresAt }),
        ], ct);

        var link = $"{appLinks.Value.EmailVerificationUrl}?token={Uri.EscapeDataString(token)}";
        try
        {
            await emailService.SendAsync(EmailTemplates.EmailVerification(user.Email, code, link, language, (int)Lifetime.TotalHours), ct);
            logger.LogInformation("Verification e-mail sent for user {UserId}", user.Id);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // The row stays: "Tekrar gönder" sends a new one. Sign-up never fails because of e-mail.
            logger.LogError(ex, "Verification e-mail failed for user {UserId}", user.Id);
        }
        return EmailVerificationOutcome.Sent;
    }

    public async Task<EmailVerificationOutcome> ResendAsync(string userId, string language, CancellationToken ct)
    {
        var user = await repository.GetAsync<UserEntity>(UserEntity.GetPk(), UserEntity.GetSk(userId), ct);
        if (user is null)
            return EmailVerificationOutcome.UserNotFound;
        if (user.IsEmailVerified)
            return EmailVerificationOutcome.AlreadyVerified;
        if (!await rateLimiter.TryAcquireAsync("verify-resend-minute", userId, 1, ResendCooldown, ct)
            || !await rateLimiter.TryAcquireAsync("verify-resend-day", userId, rateLimits.Value.VerifyResendPerUserPerDay, TimeSpan.FromDays(1), ct))
            return EmailVerificationOutcome.TooManyAttempts;
        return await SendAsync(user, language, ct);
    }

    public async Task<EmailVerificationOutcome> VerifyCodeAsync(string userId, string code, CancellationToken ct)
    {
        var user = await repository.GetAsync<UserEntity>(UserEntity.GetPk(), UserEntity.GetSk(userId), ct);
        if (user is null)
            return EmailVerificationOutcome.UserNotFound;
        if (user.IsEmailVerified)
            return EmailVerificationOutcome.AlreadyVerified;
        if (!await rateLimiter.TryAcquireAsync("verify-code", userId, rateLimits.Value.VerifyCodePerUserPerHour, TimeSpan.FromHours(1), ct))
            return EmailVerificationOutcome.TooManyAttempts;

        var row = await repository.GetAsync<EmailVerificationEntity>(EmailVerificationEntity.GetPk(), EmailVerificationEntity.GetSk(userId), ct);
        if (row is null)
            return EmailVerificationOutcome.InvalidCode;
        if (row.ExpiresAt <= Now)
            return EmailVerificationOutcome.Expired;
        if (row.Attempts >= EmailVerificationEntity.MaxCodeAttempts)
            return EmailVerificationOutcome.TooManyAttempts;

        if (!CryptographicOperations.FixedTimeEquals(System.Text.Encoding.ASCII.GetBytes(row.CodeHash), System.Text.Encoding.ASCII.GetBytes(CodeHash(userId, code.Trim()))))
        {
            row.Attempts++;
            await repository.SaveAsync(row, ct);
            return row.Attempts >= EmailVerificationEntity.MaxCodeAttempts ? EmailVerificationOutcome.TooManyAttempts : EmailVerificationOutcome.InvalidCode;
        }

        return await CompleteAsync(user, row, ct);
    }

    public async Task<EmailVerificationOutcome> VerifyTokenAsync(string token, CancellationToken ct)
    {
        var tokenHash = token.Sha256Hex();
        var pointer = await repository.GetAsync<EmailVerificationTokenEntity>(EmailVerificationTokenEntity.GetPk(), EmailVerificationTokenEntity.GetSk(tokenHash), ct);
        if (pointer is null)
            return EmailVerificationOutcome.InvalidCode;
        var user = await repository.GetAsync<UserEntity>(UserEntity.GetPk(), UserEntity.GetSk(pointer.UserId), ct);
        if (user is null)
            return EmailVerificationOutcome.InvalidCode;
        if (user.IsEmailVerified)
            return EmailVerificationOutcome.AlreadyVerified;

        var row = await repository.GetAsync<EmailVerificationEntity>(EmailVerificationEntity.GetPk(), EmailVerificationEntity.GetSk(user.Id), ct);
        // A link of an older e-mail (replaced by a resend) is no longer valid.
        if (row is null || row.TokenHash != tokenHash)
            return EmailVerificationOutcome.InvalidCode;
        if (row.ExpiresAt <= Now)
            return EmailVerificationOutcome.Expired;
        return await CompleteAsync(user, row, ct);
    }

    public async Task MarkVerifiedAsync(UserEntity user, CancellationToken ct)
    {
        if (user.EmailVerifiedAt is not null || string.IsNullOrEmpty(user.Email))
            return;
        user.EmailVerifiedAt = Now;
        await repository.SaveAsync(user, ct);
        await repository.DeleteAsync(EmailVerificationEntity.GetPk(), EmailVerificationEntity.GetSk(user.Id), ct);
    }

    private async Task<EmailVerificationOutcome> CompleteAsync(UserEntity user, EmailVerificationEntity row, CancellationToken ct)
    {
        // The code proves the address it was sent to; an address changed since then stays unverified.
        if (!string.Equals(row.Email, user.Email, StringComparison.Ordinal))
            return EmailVerificationOutcome.InvalidCode;

        user.EmailVerifiedAt = Now;
        // The link pointer stays until its TTL: opening the e-mail link again answers "already verified".
        await repository.TransactWriteAsync([TransactWriteOperation.Put(user), TransactWriteOperation.Delete(row.Pk, row.Sk)], ct);
        logger.LogInformation("E-mail verified for user {UserId}", user.Id);
        // Decision 13: a proven address may be found by contact matching.
        await contactDirectory.ListVerifiedEmailAsync(user.TenantId, user.Email!, ct);
        return EmailVerificationOutcome.Verified;
    }

    private static string CodeHash(string userId, string code) => $"{userId}:{code}".Sha256Hex();
}
