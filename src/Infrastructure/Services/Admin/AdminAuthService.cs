using System.Security.Cryptography;
using System.Text;
using Domain.Entity;
using Domain.Enum;
using Domain.Extensions;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Domain.Services.Admin;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Infrastructure.Services.Admin;

/// <summary>
/// Admin sign-in (owner decision 3): e-mail + password, then a 6-digit code e-mailed through SendGrid. Codes: 10 min,
/// 5 wrong tries, single use, only a salted hash stored. Logs never contain e-mail addresses, passwords, codes or tokens.
/// </summary>
public sealed class AdminAuthService(
    IRepository repository,
    IPasswordHasher passwordHasher,
    IAdminTokenService tokenService,
    IEmailService emailService,
    IRateLimiter rateLimiter,
    IAuditLog audit,
    IOptionsMonitor<AdminAuthOptions> authOptions,
    IOptions<AdminJwtOptions> jwtOptions,
    TimeProvider timeProvider,
    ILogger<AdminAuthService> logger) : IAdminAuthService
{
    public const int CodeLength = 6;
    private static readonly Lazy<string> DummyHash = new(() => new PasswordHasher().Hash(Guid.NewGuid().ToString()));
    private volatile bool _bootstrapChecked; // per container: the marker row is the durable guard

    private DateTime Now => timeProvider.GetUtcNow().UtcDateTime;
    private AdminAuthOptions Options => authOptions.CurrentValue;

    public static string NormalizeEmail(string email) => email.Trim().ToLowerInvariant();

    // ── Step 1: password ─────────────────────────────────────────────────────────────────────────────────────────

    public async Task<AdminLoginResult> LoginAsync(string email, string password, AdminRequestInfo request, CancellationToken ct)
    {
        await EnsureBootstrapAsync(ct);
        var normalized = NormalizeEmail(email);
        var options = Options;
        if (!await rateLimiter.TryAcquireAsync("admin-login-email", normalized, options.LoginPerEmailPer15Minutes, TimeSpan.FromMinutes(15), ct)
            || (request.Ip is not null && !await rateLimiter.TryAcquireAsync("admin-login-ip", request.Ip, options.LoginPerIpPer15Minutes, TimeSpan.FromMinutes(15), ct)))
            return new AdminLoginResult(AdminAuthOutcome.TooManyAttempts);

        var admin = await FindByEmailAsync(normalized, ct);
        var credential = admin is { Disabled: false, PasswordSet: true }
            ? await repository.GetAsync<AdminCredentialEntity>(AdminCredentialEntity.GetPk(), AdminCredentialEntity.GetSk(admin.Id), ct)
            : null;
        if (admin is null || credential is null)
        {
            passwordHasher.Verify(password, DummyHash.Value); // same work whether or not the admin exists
            if (admin is not null)
                await audit.WriteAsync(admin, "auth.login_failed", "admin", admin.Id, null, new { reason = admin.Disabled ? "disabled" : "no_password" }, request.Ip, ct);
            return new AdminLoginResult(AdminAuthOutcome.InvalidCredentials);
        }

        var verification = passwordHasher.Verify(password, credential.PasswordHash);
        if (verification == PasswordVerification.Failed)
        {
            await audit.WriteAsync(admin, "auth.login_failed", "admin", admin.Id, null, new { reason = "password" }, request.Ip, ct);
            return new AdminLoginResult(AdminAuthOutcome.InvalidCredentials);
        }
        if (verification == PasswordVerification.SuccessRehashNeeded)
        {
            credential.PasswordHash = passwordHasher.Hash(password);
            credential.UpdatedAt = Now;
            await repository.SaveAsync(credential, ct);
        }

        var now = Now;
        var challengeId = tokenService.CreateOpaqueToken();
        var code = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6", System.Globalization.CultureInfo.InvariantCulture);
        var challenge = new AdminLoginChallengeEntity
        {
            ChallengeHash = challengeId.Sha256Hex(),
            AdminId = admin.Id,
            CodeHash = CodeHash(challengeId, code),
            CreatedAt = now,
            ExpiresAt = now.AddMinutes(options.CodeTtlMinutes),
            Version = 1, // written with SaveAsync; a wrong try is a versioned put on this version
        };
        await repository.SaveAsync(challenge, ct);

        try
        {
            await emailService.SendAsync(AdminEmailTemplates.SignInCode(admin.Email, code, request.Language, options.CodeTtlMinutes), ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "Admin sign-in code e-mail failed for admin {AdminId}", admin.Id);
            await repository.DeleteAsync(challenge.Pk, challenge.Sk, ct);
            return new AdminLoginResult(AdminAuthOutcome.EmailUnavailable);
        }
        logger.LogInformation("Admin sign-in code sent for admin {AdminId}", admin.Id);
        return new AdminLoginResult(AdminAuthOutcome.Success, challengeId, challenge.ExpiresAt);
    }

    // ── Step 2: e-mailed code ────────────────────────────────────────────────────────────────────────────────────

    public async Task<AdminVerifyResult> VerifyAsync(string challengeId, string code, AdminRequestInfo request, CancellationToken ct)
    {
        var options = Options;
        if (request.Ip is not null && !await rateLimiter.TryAcquireAsync("admin-verify-ip", request.Ip, options.VerifyPerIpPer15Minutes, TimeSpan.FromMinutes(15), ct))
            return new AdminVerifyResult(AdminAuthOutcome.TooManyAttempts);

        var challenge = await repository.GetAsync<AdminLoginChallengeEntity>(AdminLoginChallengeEntity.GetPk(), AdminLoginChallengeEntity.GetSk(challengeId.Sha256Hex()), ct);
        var now = Now;
        if (challenge is null || challenge.ExpiresAt <= now || challenge.FailedAttempts >= options.CodeMaxAttempts)
            return new AdminVerifyResult(AdminAuthOutcome.ChallengeExpired);

        var admin = await repository.GetAsync<AdminUserEntity>(AdminUserEntity.GetPk(), AdminUserEntity.GetSk(challenge.AdminId), ct);
        if (!CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(CodeHash(challengeId, code)), Encoding.ASCII.GetBytes(challenge.CodeHash)))
        {
            challenge.FailedAttempts++;
            var attemptsLeft = Math.Max(0, options.CodeMaxAttempts - challenge.FailedAttempts);
            if (attemptsLeft == 0)
                await repository.DeleteAsync(challenge.Pk, challenge.Sk, ct);
            else
                await repository.SaveIfVersionAsync(challenge, challenge.Version, ct); // a lost race still counts as a wrong try for the caller
            await audit.WriteAsync(admin, "auth.login_failed", "admin", challenge.AdminId, null, new { reason = "code", attemptsLeft }, request.Ip, ct);
            return new AdminVerifyResult(AdminAuthOutcome.InvalidCode, AttemptsLeft: attemptsLeft);
        }

        if (admin is null || admin.Disabled || !admin.PasswordSet)
            return new AdminVerifyResult(AdminAuthOutcome.ChallengeExpired);

        var (refresh, value) = NewRefreshToken(admin.Id, Ulid.New(now), now);
        // Single use: the challenge must still exist when the session is created.
        var result = await repository.TransactWriteAsync(
            [TransactWriteOperation.DeleteExisting(challenge.Pk, challenge.Sk), TransactWriteOperation.Create(refresh)], ct);
        if (!result.Applied)
            return new AdminVerifyResult(AdminAuthOutcome.ChallengeExpired);

        admin.LastLoginAt = now;
        admin.UpdatedAt = now;
        await repository.SaveIfVersionAsync(admin, admin.Version, ct);
        await audit.WriteAsync(admin, "auth.login", "admin", admin.Id, null, null, request.Ip, ct);
        logger.LogInformation("Admin {AdminId} signed in", admin.Id);
        return new AdminVerifyResult(AdminAuthOutcome.Success, Session(admin, value, refresh.ExpiresAt));
    }

    public async Task<AdminVerifyResult> RefreshAsync(string refreshToken, CancellationToken ct)
    {
        var stored = await repository.GetAsync<AdminRefreshTokenEntity>(AdminRefreshTokenEntity.GetPk(), AdminRefreshTokenEntity.GetSk(refreshToken.Sha256Hex()), ct);
        var now = Now;
        if (stored is null || stored.ExpiresAt <= now)
            return new AdminVerifyResult(AdminAuthOutcome.InvalidToken);

        var admin = await repository.GetAsync<AdminUserEntity>(AdminUserEntity.GetPk(), AdminUserEntity.GetSk(stored.AdminId), ct);
        if (admin is null || admin.Disabled || (admin.TokensValidAfter is { } validAfter && stored.IssuedAt < validAfter))
            return new AdminVerifyResult(AdminAuthOutcome.InvalidToken);

        if (stored.RotatedAt is not null)
        {
            // A rotated token presented again: assume theft and end every session of this admin.
            await RevokeAllAsync(admin.Id, ct);
            logger.LogWarning("Admin refresh token reuse detected for admin {AdminId}; all sessions revoked", admin.Id);
            await audit.WriteAsync(admin, "auth.refresh_reuse", "admin", admin.Id, null, null, null, ct);
            return new AdminVerifyResult(AdminAuthOutcome.InvalidToken);
        }

        stored.RotatedAt = now;
        var (next, value) = NewRefreshToken(admin.Id, stored.FamilyId, now);
        // A rotated token keeps the family's absolute end: refreshing never extends a session past RefreshTokenHours.
        next.ExpiresAt = stored.ExpiresAt;
        var result = await repository.TransactWriteAsync([TransactWriteOperation.PutVersioned(stored), TransactWriteOperation.Create(next)], ct);
        if (!result.Applied)
            return new AdminVerifyResult(AdminAuthOutcome.InvalidToken);
        return new AdminVerifyResult(AdminAuthOutcome.Success, Session(admin, value, next.ExpiresAt));
    }

    public async Task LogoutAsync(AdminUserEntity admin, string? refreshToken, string? ip, CancellationToken ct)
    {
        if (!string.IsNullOrEmpty(refreshToken))
        {
            var stored = await repository.GetAsync<AdminRefreshTokenEntity>(AdminRefreshTokenEntity.GetPk(), AdminRefreshTokenEntity.GetSk(refreshToken.Sha256Hex()), ct);
            if (stored is not null && stored.AdminId == admin.Id)
                await repository.DeleteAsync(stored.Pk, stored.Sk, ct);
        }
        await audit.WriteAsync(admin, "auth.logout", "admin", admin.Id, null, null, ip, ct);
    }

    public async Task LogoutAllAsync(AdminUserEntity admin, string? ip, CancellationToken ct)
    {
        await RevokeAllAsync(admin.Id, ct);
        await audit.WriteAsync(admin, "auth.logout_all", "admin", admin.Id, null, null, ip, ct);
    }

    // ── Password ─────────────────────────────────────────────────────────────────────────────────────────────────

    public async Task RequestPasswordResetAsync(string email, AdminRequestInfo request, CancellationToken ct)
    {
        await EnsureBootstrapAsync(ct);
        var normalized = NormalizeEmail(email);
        if (!await rateLimiter.TryAcquireAsync("admin-forgot-email", normalized, Options.ForgotPerEmailPerHour, TimeSpan.FromHours(1), ct))
            return;

        var admin = await FindByEmailAsync(normalized, ct);
        if (admin is null || admin.Disabled)
            return;

        try
        {
            await SendPasswordLinkAsync(admin, AdminPasswordTokenPurpose.Reset, request.Language, ct);
            await audit.WriteAsync(admin, "auth.password_reset_requested", "admin", admin.Id, null, null, request.Ip, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Still 202: the response must not reveal whether the admin exists.
            logger.LogError(ex, "Admin password reset e-mail failed for admin {AdminId}", admin.Id);
        }
    }

    /// <summary>Creates a single-use set / reset link and e-mails it. Used by forgot-password and admin invitations.</summary>
    public async Task SendPasswordLinkAsync(AdminUserEntity admin, AdminPasswordTokenPurpose purpose, string language, CancellationToken ct)
    {
        var options = Options;
        var lifetime = purpose == AdminPasswordTokenPurpose.Invite ? TimeSpan.FromHours(options.InviteLinkHours) : TimeSpan.FromMinutes(options.ResetLinkMinutes);
        var token = tokenService.CreateOpaqueToken();
        await repository.SaveAsync(new AdminPasswordTokenEntity
        {
            TokenHash = token.Sha256Hex(),
            AdminId = admin.Id,
            Purpose = purpose,
            ExpiresAt = Now.Add(lifetime),
        }, ct);

        var link = $"{options.PanelUrl.TrimEnd('/')}/reset-password?token={Uri.EscapeDataString(token)}";
        await emailService.SendAsync(AdminEmailTemplates.PasswordLink(admin.Email, link, purpose, language, lifetime), ct);
        logger.LogInformation("Admin {Purpose} link sent for admin {AdminId}", purpose, admin.Id);
    }

    public async Task<AdminAuthOutcome> ResetPasswordAsync(string token, string newPassword, string? ip, CancellationToken ct)
    {
        var stored = await repository.GetAsync<AdminPasswordTokenEntity>(AdminPasswordTokenEntity.GetPk(), AdminPasswordTokenEntity.GetSk(token.Sha256Hex()), ct);
        var now = Now;
        if (stored is null || stored.ExpiresAt <= now)
            return AdminAuthOutcome.InvalidToken;

        var admin = await repository.GetAsync<AdminUserEntity>(AdminUserEntity.GetPk(), AdminUserEntity.GetSk(stored.AdminId), ct);
        if (admin is null || admin.Disabled)
            return AdminAuthOutcome.InvalidToken;

        var firstPassword = !admin.PasswordSet;
        admin.PasswordSet = true;
        admin.TokensValidAfter = now; // every session ends
        admin.UpdatedAt = now;
        var result = await repository.TransactWriteAsync(
        [
            TransactWriteOperation.DeleteExisting(stored.Pk, stored.Sk), // single use
            TransactWriteOperation.Put(new AdminCredentialEntity { AdminId = admin.Id, PasswordHash = passwordHasher.Hash(newPassword), UpdatedAt = now }),
            TransactWriteOperation.PutVersioned(admin),
        ], ct);
        if (!result.Applied)
            return AdminAuthOutcome.InvalidToken;

        await audit.WriteAsync(admin, firstPassword ? "auth.password_set" : "auth.password_reset", "admin", admin.Id, null, null, ip, ct);
        logger.LogInformation("Admin {AdminId} password {Kind}", admin.Id, firstPassword ? "set" : "reset");
        return AdminAuthOutcome.Success;
    }

    public async Task<AdminAuthOutcome> ChangePasswordAsync(AdminUserEntity admin, string currentPassword, string newPassword, string? ip, CancellationToken ct)
    {
        var credential = await repository.GetAsync<AdminCredentialEntity>(AdminCredentialEntity.GetPk(), AdminCredentialEntity.GetSk(admin.Id), ct);
        if (credential is null || passwordHasher.Verify(currentPassword, credential.PasswordHash) == PasswordVerification.Failed)
        {
            await audit.WriteAsync(admin, "auth.password_change_failed", "admin", admin.Id, null, null, ip, ct);
            return AdminAuthOutcome.InvalidCredentials;
        }

        var now = Now;
        credential.PasswordHash = passwordHasher.Hash(newPassword);
        credential.UpdatedAt = now;
        await repository.SaveAsync(credential, ct);
        await RevokeAllAsync(admin.Id, ct);
        await audit.WriteAsync(admin, "auth.password_changed", "admin", admin.Id, null, null, ip, ct);
        return AdminAuthOutcome.Success;
    }

    // ── Bootstrap ────────────────────────────────────────────────────────────────────────────────────────────────

    public async Task EnsureBootstrapAsync(CancellationToken ct)
    {
        if (_bootstrapChecked)
            return;
        var email = NormalizeEmail(Options.BootstrapSuperAdminEmail ?? "");
        if (email.Length == 0)
            return;

        if (await repository.GetAsync<AdminBootstrapMarkerEntity>(AdminBootstrapMarkerEntity.GetPk(), AdminBootstrapMarkerEntity.GetSk(), ct) is not null)
        {
            _bootstrapChecked = true;
            return;
        }

        var now = Now;
        var existing = await repository.GetAsync<AdminEmailIndexEntity>(AdminEmailIndexEntity.GetPk(), AdminEmailIndexEntity.GetSk(email), ct);
        if (existing is not null)
        {
            await repository.TransactWriteAsync([TransactWriteOperation.Create(new AdminBootstrapMarkerEntity { AdminId = existing.AdminId, CreatedAt = now })], ct);
            _bootstrapChecked = true;
            return;
        }

        var admin = new AdminUserEntity
        {
            Id = Ulid.New(now),
            Email = email,
            Name = email.Split('@')[0],
            Role = AdminRole.SuperAdmin,
            PasswordSet = false,
            CreatedBy = "bootstrap",
            CreatedAt = now,
            UpdatedAt = now,
        };
        // Marker first: a concurrent bootstrap (two containers) loses on the marker and writes nothing.
        var result = await repository.TransactWriteAsync(
        [
            TransactWriteOperation.Create(new AdminBootstrapMarkerEntity { AdminId = admin.Id, CreatedAt = now }),
            TransactWriteOperation.Create(new AdminEmailIndexEntity { Email = email, AdminId = admin.Id }),
            TransactWriteOperation.Create(admin),
        ], ct);
        if (result.Applied)
        {
            logger.LogInformation("Bootstrap super admin {AdminId} created (no password; set through the e-mailed link)", admin.Id);
            await audit.WriteAsync(null, "admin.bootstrap", "admin", admin.Id, null, AdminUserDto.From(admin), null, ct);
        }
        _bootstrapChecked = true;
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────────────────────────

    public async Task<AdminUserEntity?> FindByEmailAsync(string normalizedEmail, CancellationToken ct)
    {
        var index = await repository.GetAsync<AdminEmailIndexEntity>(AdminEmailIndexEntity.GetPk(), AdminEmailIndexEntity.GetSk(normalizedEmail), ct);
        return index is null ? null : await repository.GetAsync<AdminUserEntity>(AdminUserEntity.GetPk(), AdminUserEntity.GetSk(index.AdminId), ct);
    }

    /// <summary>Every access and refresh token of the admin issued before now stops working.</summary>
    public async Task RevokeAllAsync(string adminId, CancellationToken ct)
    {
        for (var attempt = 0; attempt < 5; attempt++)
        {
            var admin = await repository.GetAsync<AdminUserEntity>(AdminUserEntity.GetPk(), AdminUserEntity.GetSk(adminId), ct);
            if (admin is null)
                return;
            admin.TokensValidAfter = Now;
            admin.UpdatedAt = admin.TokensValidAfter.Value;
            if (await repository.SaveIfVersionAsync(admin, admin.Version, ct))
                return;
        }
        throw new InvalidOperationException("Admin sessions could not be revoked (too many concurrent writers).");
    }

    private AdminSessionDto Session(AdminUserEntity admin, string refreshValue, DateTime refreshExpiresAt)
    {
        var access = tokenService.CreateAccessToken(admin);
        return new AdminSessionDto(access.Value, access.ExpiresAt, refreshValue, refreshExpiresAt, AdminMeDto.From(admin));
    }

    private (AdminRefreshTokenEntity Entity, string Value) NewRefreshToken(string adminId, string familyId, DateTime now)
    {
        var value = tokenService.CreateOpaqueToken();
        return (new AdminRefreshTokenEntity
        {
            TokenHash = value.Sha256Hex(),
            AdminId = adminId,
            FamilyId = familyId,
            IssuedAt = now,
            ExpiresAt = now.AddHours(jwtOptions.Value.RefreshTokenHours),
            Version = 1,
        }, value);
    }

    private static string CodeHash(string challengeId, string code) => $"admin-code:{challengeId}:{code}".Sha256Hex();
}
