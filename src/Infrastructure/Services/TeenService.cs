using System.Security.Cryptography;
using System.Text.RegularExpressions;
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

/// <summary>
/// Teen mode (docs/api/teen.md): the age band, verified parental consent (e-mailed signed link, approve / decline /
/// withdraw, resend, expiry, rate limits) and the teen state the guards read. Logs never contain an e-mail or a token.
/// Tokens: 32 random bytes (base64url) in the link, only their SHA-256 stored (ParentalConsentTokenEntity).
/// </summary>
public sealed partial class TeenService(
    IRepository repository,
    IEmailService email,
    IRateLimiter rateLimiter,
    IConsentService consents,
    IPhotoService photos,
    IAvatarService avatars,
    INotificationInbox inbox,
    IOptionsMonitor<TeenOptions> options,
    IOptionsMonitor<ConsentOptions> consentOptions,
    TimeProvider timeProvider,
    ILogger<TeenService> logger) : ITeenService
{
    private static readonly TimeSpan ResendInterval = TimeSpan.FromMinutes(1);

    private DateTime Now => timeProvider.GetUtcNow().UtcDateTime;
    private DateOnly Today => DateOnly.FromDateTime(Now);

    [GeneratedRegex(@"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")]
    private static partial Regex EmailPattern();

    // ── New teen accounts ──────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// The rows a new teen account adds (in the sign-up transaction, or after the Apple / Google age step): the pending
    /// consent and the teen index. The caller sets the band on the user and the tenant (closet private).
    /// </summary>
    public static IEnumerable<TransactWriteOperation> NewTeenOperations(UserEntity user, string language, DateTime now)
    {
        var adultFrom = AgeRules.AdultFrom(user.BirthYear!.Value, user.BirthMonth);
        yield return TransactWriteOperation.Put(new ParentalConsentEntity
        {
            TenantId = user.TenantId,
            UserId = user.Id,
            Status = ParentalConsentStatus.PendingParentalConsent,
            Language = language,
            UpdatedAt = now,
        });
        yield return TransactWriteOperation.Put(new TeenAccountIndexEntity
        {
            TenantId = user.TenantId,
            UserId = user.Id,
            AdultFrom = adultFrom.ToString("yyyy-MM-dd"),
            LastActiveAt = now,
            CreatedAt = now,
        });
    }

    /// <summary>Sets the teen band on a user being created (birth year / month kept: they decide the 18th birthday).</summary>
    public static void ApplyTeen(UserEntity user, TenantEntity tenant, int birthYear, int? birthMonth)
    {
        user.AgeBand = AgeBand.Teen;
        user.BirthYear = birthYear;
        user.BirthMonth = birthMonth;
        tenant.AgeBand = AgeBand.Teen;
        tenant.ClosetVisibility = ClosetVisibility.Private;
    }

    public async Task BecomeTeenAsync(UserEntity user, int birthYear, int? birthMonth, CancellationToken ct)
    {
        var now = Now;
        var tenant = await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(user.TenantId), ct)
                     ?? throw new InvalidOperationException("Tenant not found.");
        ApplyTeen(user, tenant, birthYear, birthMonth);
        user.AgeConfirmedAt ??= now;
        tenant.UpdatedAt = now;
        var operations = new List<TransactWriteOperation> { TransactWriteOperation.Put(user), TransactWriteOperation.PutVersioned(tenant) };
        operations.AddRange(SettingsService.PublicIndexOperations(tenant, now));
        operations.AddRange(NewTeenOperations(user, tenant.Language, now));
        var result = await repository.TransactWriteAsync(operations, ct);
        if (!result.Applied)
            throw new InvalidOperationException($"Teen age step failed: {result.Outcome}.");
        logger.LogInformation("User {UserId} set up as a teen account (pending parental consent)", user.Id);
    }

    // ── State ──────────────────────────────────────────────────────────────────────────────────────────────────────

    private Task<UserEntity?> UserAsync(string userId, CancellationToken ct) =>
        repository.GetAsync<UserEntity>(UserEntity.GetPk(), UserEntity.GetSk(userId), ct);

    private Task<ParentalConsentEntity?> ConsentAsync(string tenantId, CancellationToken ct) =>
        repository.GetAsync<ParentalConsentEntity>(ParentalConsentEntity.GetPk(tenantId), ParentalConsentEntity.GetSk(), ct);

    /// <summary>A teen right now: band teen and the 18th birthday (adultFrom) not reached — re-evaluated on every read.</summary>
    private bool IsTeenNow(UserEntity user) =>
        user.AgeBand == AgeBand.Teen && !(user.BirthYear is { } year && AgeRules.IsAdultOn(year, user.BirthMonth, Today));

    private static DateOnly? AdultFromOf(UserEntity user) =>
        user.BirthYear is { } year ? AgeRules.AdultFrom(year, user.BirthMonth) : null;

    public async Task<TeenAccess> AccessAsync(string userId, CancellationToken ct)
    {
        var user = await UserAsync(userId, ct);
        if (user is null || !IsTeenNow(user))
            return TeenAccess.Adult;
        var consent = await ConsentAsync(user.TenantId, ct);
        return new TeenAccess(true, consent?.Status ?? ParentalConsentStatus.PendingParentalConsent, consent?.ParentAllowedTryOn == true, AdultFromOf(user));
    }

    public async Task<TeenStatusDto> StatusAsync(string userId, CancellationToken ct) =>
        await UserAsync(userId, ct) is { } user ? await StatusAsync(user, ct) : new TeenStatusDto(null, null);

    public async Task<TeenStatusDto> StatusAsync(UserEntity user, CancellationToken ct)
    {
        if (!IsTeenNow(user))
            return new TeenStatusDto(user.AgeBand is not null || user.AgeConfirmedAt is not null ? AgeBand.Adult : null, null);

        var consent = await ConsentAsync(user.TenantId, ct);
        var own = await repository.GetAsync<ConsentEntity>(ConsentEntity.GetPk(user.TenantId), ConsentEntity.GetSk(ConsentType.TeenTryOn), ct);
        var ownVersion = consentOptions.CurrentValue.CurrentVersion(ConsentType.TeenTryOn);
        var ownValid = ConsentRules.IsValid(own, ownVersion);
        var status = consent?.Status ?? ParentalConsentStatus.PendingParentalConsent;
        var now = Now;

        var state = consent?.RequestSentAt is null ? "none"
            : status == ParentalConsentStatus.PendingParentalConsent && consent.RequestExpiresAt <= now ? "expired"
            : "sent";
        var request = new TeenRequestDto(state, TeenRules.MaskEmail(consent?.ParentEmail), consent?.RequestSentAt,
            consent?.RequestExpiresAt, consent?.RequestSentAt?.Add(ResendInterval));
        var reason = TeenRules.TryOnBlockReason(options.CurrentValue.TryOnEnabled, status, consent?.ParentAllowedTryOn == true, ownValid);
        return new TeenStatusDto(AgeBand.Teen, new TeenStateDto(status, request, consent?.ApprovedAt, consent?.ParentAllowedTryOn == true, ownValid,
            ownVersion, new TeenTryOnDto(reason is null, reason), AdultFromOf(user)?.ToString("yyyy-MM-dd"), TeenRules.Restrictions));
    }

    // ── Teen side: request / resend ────────────────────────────────────────────────────────────────────────────────

    public async Task<TeenResult> RequestConsentAsync(string userId, string parentEmail, CancellationToken ct)
    {
        var normalized = (parentEmail ?? "").Trim().ToLowerInvariant();
        if (normalized.Length > 254 || !EmailPattern().IsMatch(normalized))
            return new TeenResult(TeenOutcome.InvalidEmail);
        return await SendAsync(userId, normalized, ParentalConsentEvent.Requested, ct);
    }

    public Task<TeenResult> ResendAsync(string userId, CancellationToken ct) =>
        SendAsync(userId, null, ParentalConsentEvent.Resent, ct);

    private async Task<TeenResult> SendAsync(string userId, string? parentEmail, ParentalConsentEvent kind, CancellationToken ct)
    {
        var user = await UserAsync(userId, ct);
        if (user is null || !IsTeenNow(user))
            return new TeenResult(TeenOutcome.NotTeen);
        var consent = await ConsentAsync(user.TenantId, ct) ?? new ParentalConsentEntity
        {
            TenantId = user.TenantId, UserId = user.Id, Status = ParentalConsentStatus.PendingParentalConsent,
        };
        if (consent.Status == ParentalConsentStatus.Active)
            return new TeenResult(TeenOutcome.AlreadyGiven, await StatusAsync(user, ct));

        var to = parentEmail ?? consent.ParentEmail;
        if (to is null)
            return new TeenResult(TeenOutcome.NotRequested, await StatusAsync(user, ct));
        if (user.Email is { Length: > 0 } own && string.Equals(own, to, StringComparison.OrdinalIgnoreCase))
            return new TeenResult(TeenOutcome.SameAsTeen);

        var settings = options.CurrentValue;
        if (!await rateLimiter.TryAcquireAsync("teen-consent-minute", user.Id, 1, ResendInterval, ct)
            || !await rateLimiter.TryAcquireAsync("teen-consent-day", user.Id, Math.Max(1, settings.ConsentRequestsPerDay), TimeSpan.FromDays(1), ct)
            || !await rateLimiter.TryAcquireAsync("teen-consent-parent", to, Math.Max(1, settings.ConsentRequestsPerParentPerDay), TimeSpan.FromDays(1), ct))
            return new TeenResult(TeenOutcome.TooManyAttempts);

        var tenant = await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(user.TenantId), ct);
        var now = Now;
        var (token, tokenEntity) = NewToken(ParentalTokenKind.Request, user, Ulid.New(now), now.Add(settings.ConsentLinkLifetime));

        consent.Status = ParentalConsentStatus.PendingParentalConsent; // a new request after a decline / withdrawal
        consent.ParentEmail = to;
        consent.Language = tenant?.Language ?? consent.Language;
        consent.RequestId = tokenEntity.RequestId;
        consent.RequestSentAt = now;
        consent.RequestExpiresAt = tokenEntity.ExpiresAt;
        consent.RequestExpiredRecordedAt = null;
        consent.DecidedAt = null;
        consent.TokenHashes = consent.TokenHashes.Append(tokenEntity.TokenHash).TakeLast(20).ToList();
        consent.UpdatedAt = now;

        await repository.TransactWriteAsync(
        [
            TransactWriteOperation.Put(tokenEntity),
            TransactWriteOperation.Put(consent),
            TransactWriteOperation.Put(Event(consent, kind, now)),
        ], ct);

        try
        {
            var link = WebLinks.WithQuery(settings.ParentConsentUrl, "token", token);
            await email.SendAsync(TeenEmailTemplates.ConsentRequest(to, TeenRules.FirstName(user.DisplayName), link, consent.Language,
                (int)settings.ConsentLinkLifetime.TotalDays), ct);
            logger.LogInformation("Parental consent e-mail sent for user {UserId} ({Kind})", user.Id, kind);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // The request stands; the teen can resend.
            logger.LogError(ex, "Parental consent e-mail failed for user {UserId}", user.Id);
        }

        return new TeenResult(TeenOutcome.Ok, await StatusAsync(user, ct));
    }

    private static (string Token, ParentalConsentTokenEntity Entity) NewToken(ParentalTokenKind kind, UserEntity user, string? requestId, DateTime expiresAt)
    {
        var token = Base64UrlEncoder.Encode(RandomNumberGenerator.GetBytes(32));
        return (token, new ParentalConsentTokenEntity
        {
            TokenHash = token.Sha256Hex(),
            Kind = kind,
            TenantId = user.TenantId,
            UserId = user.Id,
            RequestId = requestId,
            ExpiresAt = expiresAt,
        });
    }

    private static ParentalConsentEventEntity Event(ParentalConsentEntity consent, ParentalConsentEvent kind, DateTime now, string? ipHash = null) => new()
    {
        Id = Ulid.New(now),
        TenantId = consent.TenantId,
        Event = kind,
        At = now,
        ParentEmailHash = consent.ParentEmail?.Sha256Hex(),
        IpHash = ipHash,
        RequestId = consent.RequestId,
    };

    // ── Parent side ────────────────────────────────────────────────────────────────────────────────────────────────

    private sealed record Resolved(ParentalConsentTokenEntity Token, UserEntity User, ParentalConsentEntity Consent, bool Teen);

    private async Task<Resolved?> ResolveAsync(string? token, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(token) || token.Length > 128)
            return null;
        var entity = await repository.GetAsync<ParentalConsentTokenEntity>(ParentalConsentTokenEntity.GetPk(), ParentalConsentTokenEntity.GetSk(token.Sha256Hex()), ct);
        if (entity is null)
            return null;
        var user = await UserAsync(entity.UserId, ct);
        var consent = user is null ? null : await ConsentAsync(user.TenantId, ct);
        if (user is null || consent is null || user.TenantId != entity.TenantId)
            return null;
        // A request link is replaced by a newer request (resend): only the latest one resolves.
        if (entity.Kind == ParentalTokenKind.Request && !string.Equals(entity.RequestId, consent.RequestId, StringComparison.Ordinal))
            return null;
        return new Resolved(entity, user, consent, IsTeenNow(user));
    }

    private static string StatusName(Resolved r) => !r.Teen
        ? "ended"
        : r.Consent.Status switch
        {
            ParentalConsentStatus.Active => "approved",
            ParentalConsentStatus.Declined => "declined",
            ParentalConsentStatus.Withdrawn => "withdrawn",
            _ => "pending",
        };

    private ParentConsentViewDto View(Resolved r) => new(
        r.Token.Kind == ParentalTokenKind.Manage ? "manage" : "request",
        StatusName(r),
        TeenRules.FirstName(r.User.DisplayName),
        r.Consent.Language,
        r.Token.ExpiresAt,
        options.CurrentValue.ParentalConsentTextVersion,
        options.CurrentValue.TryOnEnabled,
        r.Consent.ParentAllowedTryOn,
        r.Consent.DecidedAt);

    private bool IsExpired(Resolved r) => r.Token.ExpiresAt <= Now;

    public async Task<ParentConsentResult> ParentViewAsync(string token, CancellationToken ct)
    {
        var resolved = await ResolveAsync(token, ct);
        if (resolved is null)
            return new ParentConsentResult(ParentConsentOutcome.Invalid);
        // An undecided request past its 7 days: 410 (the teen can resend). A decided one keeps showing its outcome.
        if (resolved.Token.Kind == ParentalTokenKind.Request && resolved.Teen
            && resolved.Consent.Status == ParentalConsentStatus.PendingParentalConsent && IsExpired(resolved))
            return new ParentConsentResult(ParentConsentOutcome.Expired);
        return new ParentConsentResult(ParentConsentOutcome.Ok, View(resolved));
    }

    public async Task<ParentConsentResult> DecideAsync(ParentDecision decision, string? clientIp, CancellationToken ct)
    {
        var r = await ResolveAsync(decision.Token, ct);
        if (r is null || r.Token.Kind != ParentalTokenKind.Request)
            return new ParentConsentResult(ParentConsentOutcome.Invalid);
        if (!r.Teen || r.Consent.Status != ParentalConsentStatus.PendingParentalConsent)
            return new ParentConsentResult(ParentConsentOutcome.AlreadyDecided, View(r));
        if (IsExpired(r))
            return new ParentConsentResult(ParentConsentOutcome.Expired);

        var settings = options.CurrentValue;
        if (decision.Approve)
        {
            if (!decision.ConfirmParent || !decision.ConfirmNotice || !decision.ConfirmProcessing)
                return new ParentConsentResult(ParentConsentOutcome.ConfirmationsRequired);
            if (!string.Equals(decision.TextVersion, settings.ParentalConsentTextVersion, StringComparison.Ordinal))
                return new ParentConsentResult(ParentConsentOutcome.VersionOutdated);
        }

        var now = Now;
        var consent = r.Consent;
        var tryOn = decision.Approve && settings.TryOnEnabled && decision.AllowTryOn;
        consent.Status = decision.Approve ? ParentalConsentStatus.Active : ParentalConsentStatus.Declined;
        consent.DecidedAt = now;
        consent.ApprovedAt = decision.Approve ? now : consent.ApprovedAt;
        consent.ParentAllowedTryOn = tryOn;
        consent.TextVersion = decision.Approve ? settings.ParentalConsentTextVersion : consent.TextVersion;
        consent.UpdatedAt = now;

        var history = Event(consent, decision.Approve ? ParentalConsentEvent.Approved : ParentalConsentEvent.Declined, now, IpHash(clientIp));
        history.TextVersion = settings.ParentalConsentTextVersion;
        history.TryOnAllowed = decision.Approve ? tryOn : null;
        history.ConfirmParent = decision.ConfirmParent;
        history.ConfirmNotice = decision.ConfirmNotice;
        history.ConfirmProcessing = decision.ConfirmProcessing;

        var operations = new List<TransactWriteOperation> { TransactWriteOperation.Put(history) };
        string? manageToken = null;
        if (decision.Approve)
        {
            // The withdrawal link of the confirmation e-mail: valid until the teen turns 18.
            var adultFrom = AdultFromOf(r.User) ?? Today.AddYears(2);
            var (token, entity) = NewToken(ParentalTokenKind.Manage, r.User, consent.RequestId, adultFrom.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc));
            manageToken = token;
            consent.TokenHashes = consent.TokenHashes.Append(entity.TokenHash).TakeLast(20).ToList();
            operations.Add(TransactWriteOperation.Put(entity));
        }
        operations.Add(TransactWriteOperation.Put(consent));
        await repository.TransactWriteAsync(operations, ct);
        logger.LogInformation("Parental consent {Decision} for user {UserId}", decision.Approve ? "approved" : "declined", r.User.Id);

        if (manageToken is not null)
        {
            await inbox.AddAsync(r.User.TenantId, NotificationType.ParentalConsentApproved, consent.RequestId ?? now.ToString("O"),
                new Dictionary<string, string> { ["tryOn"] = tryOn ? "true" : "false" }, now, ct);
            if (consent.ParentEmail is { } to)
            {
                try
                {
                    await email.SendAsync(TeenEmailTemplates.ConsentConfirmation(to, TeenRules.FirstName(r.User.DisplayName),
                        WebLinks.WithQuery(settings.ParentConsentUrl, "token", manageToken), consent.Language, tryOn), ct);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    logger.LogError(ex, "Parental consent confirmation e-mail failed for user {UserId}", r.User.Id);
                }
            }
        }

        return new ParentConsentResult(ParentConsentOutcome.Ok, View(r));
    }

    public async Task<ParentConsentResult> WithdrawAsync(string token, string? clientIp, CancellationToken ct)
    {
        var r = await ResolveAsync(token, ct);
        if (r is null)
            return new ParentConsentResult(ParentConsentOutcome.Invalid);
        if (!r.Teen)
            return new ParentConsentResult(ParentConsentOutcome.AlreadyDecided, View(r));
        if (r.Consent.Status == ParentalConsentStatus.Withdrawn)
            return new ParentConsentResult(ParentConsentOutcome.Ok, View(r)); // idempotent
        if (r.Consent.Status != ParentalConsentStatus.Active)
            return new ParentConsentResult(ParentConsentOutcome.NotApproved, View(r));
        if (IsExpired(r))
            return new ParentConsentResult(ParentConsentOutcome.Expired);

        var now = Now;
        var consent = r.Consent;
        consent.Status = ParentalConsentStatus.Withdrawn;
        consent.WithdrawnAt = now;
        consent.DecidedAt = now;
        consent.ParentAllowedTryOn = false;
        consent.UpdatedAt = now;
        var history = Event(consent, ParentalConsentEvent.Withdrawn, now, IpHash(clientIp));
        history.TextVersion = consent.TextVersion;
        await repository.TransactWriteAsync([TransactWriteOperation.Put(history), TransactWriteOperation.Put(consent)], ct);

        // Photo features are off from now on (status); the personal photos go (docs/api/teen.md §5).
        await PurgePersonalPhotosAsync(r.User.TenantId, ct);
        await consents.WithdrawAsync(r.User.TenantId, r.User.Id, ConsentType.TeenTryOn, "parent_withdrawal", ct);
        await inbox.AddAsync(r.User.TenantId, NotificationType.ParentalConsentWithdrawn, now.ToString("yyyyMMddHHmmss"), new Dictionary<string, string>(), now, ct);
        logger.LogInformation("Parental consent withdrawn for user {UserId}; personal photos deleted", r.User.Id);
        return new ParentConsentResult(ParentConsentOutcome.Ok, View(r));
    }

    /// <summary>Body / face photos, every try-on image, the palette result and the profile picture. Garment images stay.</summary>
    private async Task PurgePersonalPhotosAsync(string tenantId, CancellationToken ct)
    {
        await photos.DeleteAllAsync(tenantId, ct);
        await avatars.DeleteAsync(tenantId, ct);
    }

    /// <summary>SHA-256 of the IP (never the IP itself).</summary>
    public static string? IpHash(string? clientIp) => string.IsNullOrWhiteSpace(clientIp) ? null : $"ip:{clientIp.Trim()}".Sha256Hex();

    // ── Activity, admin ────────────────────────────────────────────────────────────────────────────────────────────

    public Task TouchAsync(UserEntity user, CancellationToken ct) => repository.TouchTeenAsync(user, Now, ct);

    public async Task<AdminTeenDto?> AdminAsync(string tenantId, CancellationToken ct)
    {
        var consent = await ConsentAsync(tenantId, ct);
        if (consent is null)
            return null;
        var user = await UserAsync(consent.UserId, ct);
        var index = await repository.GetAsync<TeenAccountIndexEntity>(TeenAccountIndexEntity.GetPk(), TeenAccountIndexEntity.GetSk(tenantId), ct);
        var own = await repository.GetAsync<ConsentEntity>(ConsentEntity.GetPk(tenantId), ConsentEntity.GetSk(ConsentType.TeenTryOn), ct);
        var history = (await repository.GetAllAsync<ParentalConsentEventEntity>(ParentalConsentEventEntity.GetPk(tenantId), ct))
            .OrderByDescending(e => e.At).ThenByDescending(e => e.Id, StringComparer.Ordinal)
            .Select(e => new AdminTeenEventDto(e.At, e.Event, e.TextVersion, e.TryOnAllowed, e.IpHash is { Length: > 12 } h ? h[..12] : e.IpHash))
            .ToList();
        return new AdminTeenDto(consent.Status, TeenRules.MaskEmail(consent.ParentEmail), consent.RequestSentAt, consent.RequestExpiresAt, consent.ApprovedAt,
            consent.ParentAllowedTryOn, ConsentRules.IsValid(own, consentOptions.CurrentValue.CurrentVersion(ConsentType.TeenTryOn)),
            user is null ? index?.AdultFrom : AdultFromOf(user)?.ToString("yyyy-MM-dd"), index?.PhotosPurgedAt, history);
    }
}
