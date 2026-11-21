using System.Security.Cryptography;
using Domain.Entity;
using Domain.Enum;
using Domain.Extensions;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace Infrastructure.Services;

/// <summary>Email + password, Apple, Google (README §9.3). Logs never contain e-mail, password or tokens.</summary>
public sealed class AuthService(
    IRepository repository,
    IPasswordHasher passwordHasher,
    ITokenService tokenService,
    IEmailService emailService,
    IRateLimiter rateLimiter,
    IOptions<JwtOptions> jwtOptions,
    IOptions<AppLinksOptions> appLinks,
    IOptions<AuthRateLimitOptions> rateLimits,
    TimeProvider timeProvider,
    ILogger<AuthService> logger,
    IContactDirectory contactDirectory,
    IEmailVerificationService emailVerification) : IAuthService
{
    private static readonly TimeSpan PasswordResetLifetime = TimeSpan.FromMinutes(30);
    // Verified against when the account does not exist, so response time does not reveal registered e-mails.
    private static readonly Lazy<string> DummyHash = new(() => new PasswordHasher().Hash(Guid.NewGuid().ToString()));

    private DateTime Now => timeProvider.GetUtcNow().UtcDateTime;

    public async Task<AuthResult> RegisterAsync(string name, string email, string password, string language, string? clientIp, CancellationToken ct, RegisterAge? age = null)
    {
        if (clientIp is not null
            && !await rateLimiter.TryAcquireAsync("register-ip", clientIp, rateLimits.Value.RegisterPerIpPerHour, TimeSpan.FromHours(1), ct))
            return AuthResult.Fail(AuthOutcome.TooManyAttempts);

        var now = Now;
        var normalizedEmail = NormalizeEmail(email);
        var userId = Ulid.New(now);
        var tenantId = Ulid.New(now);
        var identity = new AuthIdentityEntity { Provider = AuthProvider.Email, Subject = normalizedEmail, UserId = userId, CreatedAt = now };

        var user = new UserEntity
        {
            Id = userId,
            TenantId = tenantId,
            DisplayName = name.Trim(),
            Email = normalizedEmail,
            CreatedAt = now,
            Identities = [identity.Sk],
            // The endpoint only registers with the age checked (18+ box, or a birth year of 16+).
            AgeConfirmedAt = now,
            AgeBand = age?.Band ?? AgeBand.Adult,
        };
        var teen = age is { Band: AgeBand.Teen, BirthYear: not null };
        if (teen)
        {
            user.BirthYear = age!.BirthYear;
            user.BirthMonth = age.BirthMonth;
        }

        var operations = new List<TransactWriteOperation>
        {
            TransactWriteOperation.Create(identity), // index 0: e-mail uniqueness
            TransactWriteOperation.Create(new CredentialEntity { UserId = userId, PasswordHash = passwordHasher.Hash(password), UpdatedAt = now }),
        };
        operations.AddRange(NewAccountOperations(user, language, now));
        if (teen)
            operations.AddRange(TeenService.NewTeenOperations(user, language, now));

        var result = await repository.TransactWriteAsync(operations, ct);
        if (result.Outcome == TransactOutcome.ConditionFailed && result.FailedIndex == 0)
            return AuthResult.Fail(AuthOutcome.EmailTaken);
        if (!result.Applied)
            throw new InvalidOperationException($"Registration transaction failed: {result.Outcome}.");

        logger.LogInformation("Registered user {UserId} tenant {TenantId} via {Provider}{Teen}", userId, tenantId, AuthProvider.Email, teen ? " (teen)" : "");
        // The code + link e-mail; the app works meanwhile ("E-postanı doğrula" until then). Never fails the sign-up.
        await emailVerification.SendAsync(user, language, ct);
        return AuthResult.Ok(await IssueAsync(user, familyId: null, isNewUser: true, ct));
    }

    public async Task<AuthResult> LoginAsync(string email, string password, string? clientIp, CancellationToken ct)
    {
        var normalizedEmail = NormalizeEmail(email);
        var limits = rateLimits.Value;
        if (!await rateLimiter.TryAcquireAsync("login-email", normalizedEmail, limits.LoginPerEmailPer15Minutes, TimeSpan.FromMinutes(15), ct)
            || (clientIp is not null && !await rateLimiter.TryAcquireAsync("login-ip", clientIp, limits.LoginPerIpPer15Minutes, TimeSpan.FromMinutes(15), ct)))
            return AuthResult.Fail(AuthOutcome.TooManyAttempts);

        var identity = await repository.GetAsync<AuthIdentityEntity>(
            AuthIdentityEntity.GetPk(), AuthIdentityEntity.GetSk(AuthProvider.Email, normalizedEmail), ct);
        var credential = identity is null
            ? null
            : await repository.GetAsync<CredentialEntity>(CredentialEntity.GetPk(), CredentialEntity.GetSk(identity.UserId), ct);

        if (credential is null)
        {
            passwordHasher.Verify(password, DummyHash.Value);
            return AuthResult.Fail(AuthOutcome.InvalidCredentials);
        }

        var verification = passwordHasher.Verify(password, credential.PasswordHash);
        if (verification == PasswordVerification.Failed)
            return AuthResult.Fail(AuthOutcome.InvalidCredentials);

        var user = await repository.GetAsync<UserEntity>(UserEntity.GetPk(), UserEntity.GetSk(credential.UserId), ct);
        if (user is null)
            return AuthResult.Fail(AuthOutcome.InvalidCredentials);
        // Suspended by an admin: only after the password matched, so the answer does not reveal the account to a guesser.
        if (user.SuspendedAt is not null)
            return AuthResult.Fail(AuthOutcome.Suspended);

        await repository.TouchTeenAsync(user, Now, ct);
        if (verification == PasswordVerification.SuccessRehashNeeded)
        {
            credential.PasswordHash = passwordHasher.Hash(password);
            credential.UpdatedAt = Now;
            await repository.SaveAsync(credential, ct);
        }

        return AuthResult.Ok(await IssueAsync(user, familyId: null, isNewUser: false, ct));
    }

    public async Task RequestPasswordResetAsync(string email, string language, CancellationToken ct)
    {
        var normalizedEmail = NormalizeEmail(email);
        if (!await rateLimiter.TryAcquireAsync("forgot-email", normalizedEmail, rateLimits.Value.ForgotPerEmailPerHour, TimeSpan.FromHours(1), ct))
            return;

        var identity = await repository.GetAsync<AuthIdentityEntity>(
            AuthIdentityEntity.GetPk(), AuthIdentityEntity.GetSk(AuthProvider.Email, normalizedEmail), ct);
        if (identity is null)
            return;

        var token = Base64UrlEncoder.Encode(RandomNumberGenerator.GetBytes(32));
        await repository.SaveAsync(new PasswordResetEntity
        {
            TokenHash = token.Sha256Hex(),
            UserId = identity.UserId,
            ExpiresAt = Now.Add(PasswordResetLifetime),
        }, ct);

        var link = WebLinks.WithQuery(appLinks.Value.PasswordResetUrl, "token", token);
        try
        {
            await emailService.SendAsync(EmailTemplates.PasswordReset(normalizedEmail, link, language, (int)PasswordResetLifetime.TotalMinutes), ct);
            logger.LogInformation("Password reset e-mail sent for user {UserId}", identity.UserId);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // The endpoint still answers 202 — the response must not reveal whether the account exists.
            logger.LogError(ex, "Password reset e-mail failed for user {UserId}", identity.UserId);
        }
    }

    public async Task<AuthOutcome> ResetPasswordAsync(string token, string newPassword, CancellationToken ct)
    {
        var reset = await repository.GetAsync<PasswordResetEntity>(PasswordResetEntity.GetPk(), PasswordResetEntity.GetSk(token.Sha256Hex()), ct);
        if (reset is null || reset.ExpiresAt <= Now)
            return AuthOutcome.InvalidToken;

        var user = await repository.GetAsync<UserEntity>(UserEntity.GetPk(), UserEntity.GetSk(reset.UserId), ct);
        if (user is null)
            return AuthOutcome.InvalidToken;

        var now = Now;
        user.TokensValidAfter = now; // every existing refresh token is revoked
        // The reset link reached the inbox: the address is proven (same as the verification e-mail).
        user.EmailVerifiedAt ??= string.IsNullOrEmpty(user.Email) ? null : now;
        var result = await repository.TransactWriteAsync(
        [
            TransactWriteOperation.DeleteExisting(reset.Pk, reset.Sk), // single use
            TransactWriteOperation.Put(new CredentialEntity { UserId = user.Id, PasswordHash = passwordHasher.Hash(newPassword), UpdatedAt = now }),
            TransactWriteOperation.Put(user),
        ], ct);

        if (!result.Applied)
            return AuthOutcome.InvalidToken;
        await repository.DeleteAsync(EmailVerificationEntity.GetPk(), EmailVerificationEntity.GetSk(user.Id), ct);

        logger.LogInformation("Password reset completed for user {UserId}", user.Id);
        // The reset link proved the address: it may now be found by contact matching (decision 13).
        if (user.Email is { Length: > 0 } verifiedEmail)
            await contactDirectory.ListVerifiedEmailAsync(user.TenantId, verifiedEmail, ct);
        return AuthOutcome.Success;
    }

    public async Task<AuthResult> RefreshAsync(string refreshToken, CancellationToken ct)
    {
        var stored = await repository.GetAsync<RefreshTokenEntity>(RefreshTokenEntity.GetPk(), RefreshTokenEntity.GetSk(refreshToken.Sha256Hex()), ct);
        var now = Now;
        if (stored is null || stored.ExpiresAt <= now)
            return AuthResult.Fail(AuthOutcome.InvalidToken);

        var user = await repository.GetAsync<UserEntity>(UserEntity.GetPk(), UserEntity.GetSk(stored.UserId), ct);
        if (user is null || (user.TokensValidAfter is { } validAfter && stored.IssuedAt < validAfter))
            return AuthResult.Fail(AuthOutcome.InvalidToken);
        if (user.SuspendedAt is not null)
            return AuthResult.Fail(AuthOutcome.Suspended);

        if (stored.RotatedAt is not null)
        {
            // Reuse of a rotated token: assume theft and revoke every session of this user.
            user.TokensValidAfter = now;
            await repository.SaveAsync(user, ct);
            logger.LogWarning("Refresh token reuse detected for user {UserId}; all sessions revoked", user.Id);
            return AuthResult.Fail(AuthOutcome.InvalidToken);
        }

        stored.RotatedAt = now;
        var (next, value) = NewRefreshToken(user, stored.FamilyId, now);
        var result = await repository.TransactWriteAsync(
        [
            TransactWriteOperation.PutVersioned(stored),
            TransactWriteOperation.Create(next),
        ], ct);
        if (!result.Applied)
            return AuthResult.Fail(AuthOutcome.InvalidToken);

        await repository.TouchTeenAsync(user, now, ct);
        var access = tokenService.CreateAccessToken(user.Id, user.TenantId);
        return AuthResult.Ok(new AuthTokens(access.Value, access.ExpiresAt, value, next.ExpiresAt, user.Id, user.TenantId, false));
    }

    public async Task LogoutAsync(string userId, string tenantId, string? refreshToken, string? deviceId, CancellationToken ct)
    {
        if (!string.IsNullOrEmpty(refreshToken))
        {
            var stored = await repository.GetAsync<RefreshTokenEntity>(RefreshTokenEntity.GetPk(), RefreshTokenEntity.GetSk(refreshToken.Sha256Hex()), ct);
            if (stored is not null && stored.UserId == userId)
                await repository.DeleteAsync(stored.Pk, stored.Sk, ct);
        }

        if (!string.IsNullOrEmpty(deviceId))
            await repository.DeleteAsync(DeviceEntity.GetPk(tenantId), DeviceEntity.GetSk(deviceId), ct);
    }

    public async Task<AuthResult> SignInExternalAsync(AuthProvider provider, ExternalIdentity external, string? displayName, string language, CancellationToken ct)
    {
        var result = await SignInExternalCoreAsync(provider, external, displayName, language, ct);
        // Decision 13: an address the provider verified may be found by contact matching.
        if (result.Tokens is { } tokens && external is { EmailVerified: true, Email: { Length: > 0 } verifiedEmail })
            await contactDirectory.ListVerifiedEmailAsync(tokens.TenantId, verifiedEmail, ct);
        return result;
    }

    private async Task<AuthResult> SignInExternalCoreAsync(AuthProvider provider, ExternalIdentity external, string? displayName, string language, CancellationToken ct)
    {
        var now = Now;
        var identitySk = AuthIdentityEntity.GetSk(provider, external.Subject);
        var existing = await repository.GetAsync<AuthIdentityEntity>(AuthIdentityEntity.GetPk(), identitySk, ct);
        if (existing is not null)
        {
            var known = await repository.GetAsync<UserEntity>(UserEntity.GetPk(), UserEntity.GetSk(existing.UserId), ct);
            if (known is not null)
            {
                if (known.SuspendedAt is not null)
                    return AuthResult.Fail(AuthOutcome.Suspended);
                if (ProviderVouchesFor(external, known.Email))
                    await emailVerification.MarkVerifiedAsync(known, ct);
                await repository.TouchTeenAsync(known, now, ct);
                return AuthResult.Ok(await IssueAsync(known, null, false, ct));
            }
        }

        var identity = new AuthIdentityEntity { Provider = provider, Subject = external.Subject, CreatedAt = now };

        // Link to an existing e-mail account only when the provider vouches for the address.
        if (external is { EmailVerified: true, Email: { Length: > 0 } email })
        {
            var emailIdentity = await repository.GetAsync<AuthIdentityEntity>(
                AuthIdentityEntity.GetPk(), AuthIdentityEntity.GetSk(AuthProvider.Email, NormalizeEmail(email)), ct);
            var linked = emailIdentity is null
                ? null
                : await repository.GetAsync<UserEntity>(UserEntity.GetPk(), UserEntity.GetSk(emailIdentity.UserId), ct);
            if (linked is { SuspendedAt: not null })
                return AuthResult.Fail(AuthOutcome.Suspended);
            if (linked is not null)
            {
                identity.UserId = linked.Id;
                linked.Identities = linked.Identities.Append(identity.Sk).Distinct().ToList();
                // Linked only because the provider verified this very address: it counts as verified.
                linked.EmailVerifiedAt ??= now;
                var link = await repository.TransactWriteAsync([TransactWriteOperation.Create(identity), TransactWriteOperation.Put(linked)], ct);
                if (!link.Applied)
                    return AuthResult.Fail(AuthOutcome.InvalidToken);
                logger.LogInformation("Linked {Provider} identity to user {UserId}", provider, linked.Id);
                return AuthResult.Ok(await IssueAsync(linked, null, false, ct));
            }
        }

        var userId = Ulid.New(now);
        identity.UserId = userId;
        var user = new UserEntity
        {
            Id = userId,
            TenantId = Ulid.New(now),
            DisplayName = string.IsNullOrWhiteSpace(displayName) ? null : displayName.Trim(),
            Email = string.IsNullOrWhiteSpace(external.Email) ? null : NormalizeEmail(external.Email),
            CreatedAt = now,
            Identities = [identity.Sk],
            // Apple / Google sign-ins count as verified when the provider says so.
            EmailVerifiedAt = external.EmailVerified && !string.IsNullOrWhiteSpace(external.Email) ? now : null,
        };

        var operations = new List<TransactWriteOperation> { TransactWriteOperation.Create(identity) };
        operations.AddRange(NewAccountOperations(user, language, now));
        var result = await repository.TransactWriteAsync(operations, ct);
        if (!result.Applied)
        {
            // Lost a race with a concurrent first sign-in of the same identity: sign in to that account.
            var winner = await repository.GetAsync<AuthIdentityEntity>(AuthIdentityEntity.GetPk(), identitySk, ct);
            var winnerUser = winner is null ? null : await repository.GetAsync<UserEntity>(UserEntity.GetPk(), UserEntity.GetSk(winner.UserId), ct);
            return winnerUser is null ? AuthResult.Fail(AuthOutcome.InvalidToken) : AuthResult.Ok(await IssueAsync(winnerUser, null, false, ct));
        }

        logger.LogInformation("Registered user {UserId} tenant {TenantId} via {Provider}", user.Id, user.TenantId, provider);
        return AuthResult.Ok(await IssueAsync(user, null, true, ct));
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static IEnumerable<TransactWriteOperation> NewAccountOperations(UserEntity user, string language, DateTime now)
    {
        yield return TransactWriteOperation.Create(user);
        var teen = user.AgeBand == AgeBand.Teen;
        yield return TransactWriteOperation.PutVersioned(new TenantEntity
        {
            Id = user.TenantId,
            OwnerUserId = user.Id,
            DisplayName = user.DisplayName,
            // Owner decision 7 (2026-11-19): followers only; the profile card stays searchable. A teen's closet is forced
            // private and the account invisible to others (docs/api/teen.md §4).
            ClosetVisibility = teen ? ClosetVisibility.Private : ClosetVisibility.FollowersOnly,
            AgeBand = user.AgeBand,
            Language = language,
            CreatedAt = now,
            UpdatedAt = now,
            Version = 0,
        });
        yield return TransactWriteOperation.Put(new UserTenantIndexEntity { UserId = user.Id, TenantId = user.TenantId, CreatedAt = now });
    }

    private async Task<AuthTokens> IssueAsync(UserEntity user, string? familyId, bool isNewUser, CancellationToken ct)
    {
        var now = Now;
        var (refresh, value) = NewRefreshToken(user, familyId ?? Ulid.New(now), now);
        await repository.SaveAsync(refresh, ct);
        var access = tokenService.CreateAccessToken(user.Id, user.TenantId);
        return new AuthTokens(access.Value, access.ExpiresAt, value, refresh.ExpiresAt, user.Id, user.TenantId, isNewUser);
    }

    private (RefreshTokenEntity Entity, string Value) NewRefreshToken(UserEntity user, string familyId, DateTime now)
    {
        var value = tokenService.CreateRefreshTokenValue();
        return (new RefreshTokenEntity
        {
            TokenHash = value.Sha256Hex(),
            UserId = user.Id,
            TenantId = user.TenantId,
            FamilyId = familyId,
            IssuedAt = now,
            ExpiresAt = now.AddDays(jwtOptions.Value.RefreshTokenExpirationDays),
            Version = 1, // written with SaveAsync/Create; rotation is a versioned put on version 1
        }, value);
    }

    public static string NormalizeEmail(string email) => email.Trim().ToLowerInvariant();

    private static bool ProviderVouchesFor(ExternalIdentity external, string? email) =>
        external is { EmailVerified: true, Email: { Length: > 0 } providerEmail }
        && email is { Length: > 0 }
        && string.Equals(NormalizeEmail(providerEmail), email, StringComparison.Ordinal);
}
