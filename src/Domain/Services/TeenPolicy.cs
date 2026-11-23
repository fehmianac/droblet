using Domain.Entity;
using Domain.Enum;
using Domain.Manager;
using Domain.Options;

namespace Domain.Services;

/// <summary>What a teen may never do (403 teen_restricted, `feature` = camelCase name).</summary>
public enum TeenFeature { Social, Commerce, OutfitPhotoTryOn, Marketing, ClosetVisibility, Contacts }

/// <summary>A route closed to teens (Feature) or waiting for the parent (LimitedMode → 403 parental_consent_required).</summary>
public sealed record TeenRouteRule(TeenFeature? Feature, bool LimitedMode)
{
    public static readonly TeenRouteRule Limited = new(null, true);
    public static TeenRouteRule Closed(TeenFeature feature) => new(feature, false);
}

/// <summary>
/// The server-side route table of the teen rules (docs/api/teen.md §4.1), applied to every endpoint by one filter
/// (Api TeenGuard) before the handler runs. Keyed by the endpoint's route pattern, so a new route under a closed prefix is
/// closed too. Block (v1/tenant/block) is deliberately open: blocking is a safety tool.
/// </summary>
public static class TeenRouteRules
{
    private static readonly string[] SocialPrefixes =
    [
        "v1/tenant/follow",        // follow/{handle}, follower(s), following, follow-request/*
        "v1/tenant/people",        // search, suggestions, profiles, closets, looks, trips, ratings, saves, reports
        "v1/tenant/saved-look",
        "v1/tenant/share",
        "v1/tenant/invite/",
        "v1/tenant/contacts/",
        "v1/tenant/profile/handle", // claim + availability: a handle is only for being found
    ];

    /// <summary>
    /// Exact social routes: the friends' feed and "Akışta paylaş" (Akış F2: teens never share). Exact, so the Akış editor
    /// routes next to it (v1/tenant/feed-post/…, decision 17: teens see editor content) stay open.
    /// </summary>
    private static readonly string[] SocialRoutes = ["v1/tenant/feed", "v1/tenant/look/{id}/feed-share"];

    private static readonly string[] CommercePrefixes =
    [
        "v1/tenant/cart",
        "v1/tenant/catalog/",
        "v1/tenant/favorite/",
        "v1/tenant/watch-list",
        "v1/tenant/purchase-prompt",
        "v1/tenant/palette/products",
        "v1/tenant/entitlement/purchase",
        "v1/tenant/entitlement/restore",
        "v1/tenant/entitlement/self-premium",
    ];

    /// <summary>(method, prefix): photo uploads and AI work — open only once the parent approved.</summary>
    private static readonly (string Method, string Prefix)[] LimitedPrefixes =
    [
        ("POST", "v1/tenant/photo/upload-url"),
        ("PUT", "v1/tenant/photo/{kind}"),
        ("POST", "v1/tenant/palette/analyze"),
        ("POST", "v1/tenant/tryon"),
        ("POST", "v1/tenant/stylist/"),
        ("POST", "v1/tenant/trip/{id}/pack"),
        ("POST", "v1/tenant/item/upload-url"),
        ("POST", "v1/tenant/item-draft"),
        ("POST", "v1/tenant/outfit-import"),
        ("POST", "v1/tenant/profile/avatar/upload-url"),
        ("PUT", "v1/tenant/profile/avatar"),
    ];

    /// <summary>Null = open to teens. <paramref name="pattern"/> is the raw route pattern (v1/tenant/follow/{handle}).</summary>
    public static TeenRouteRule? Classify(string method, string? pattern)
    {
        if (string.IsNullOrEmpty(pattern) || !pattern.StartsWith("v1/tenant/", StringComparison.Ordinal))
            return null;
        if (SocialRoutes.Contains(pattern, StringComparer.Ordinal) || SocialPrefixes.Any(p => pattern.StartsWith(p, StringComparison.Ordinal)))
            return TeenRouteRule.Closed(TeenFeature.Social);
        if (CommercePrefixes.Any(p => pattern.StartsWith(p, StringComparison.Ordinal)))
            return TeenRouteRule.Closed(TeenFeature.Commerce);
        if (LimitedPrefixes.Any(l => string.Equals(l.Method, method, StringComparison.OrdinalIgnoreCase) && pattern.StartsWith(l.Prefix, StringComparison.Ordinal)))
            return TeenRouteRule.Limited;
        return null;
    }
}

/// <summary>A user's teen state as the guards see it (age re-evaluated on every read: a teen past adultFrom is an adult).</summary>
public sealed record TeenAccess(bool IsTeen, ParentalConsentStatus? Status, bool ParentAllowedTryOn, DateOnly? AdultFrom)
{
    public static readonly TeenAccess Adult = new(false, null, false, null);
    public bool ConsentActive => Status == ParentalConsentStatus.Active;
}

public sealed record TeenRequestDto(string State, string? ParentEmailMasked, DateTime? SentAt, DateTime? ExpiresAt, DateTime? ResendAvailableAt);

public sealed record TeenTryOnDto(bool Available, string? Reason);

public sealed record TeenStateDto(
    ParentalConsentStatus Status,
    TeenRequestDto Request,
    DateTime? ApprovedAt,
    bool ParentAllowedTryOn,
    bool OwnTryOnConsent,
    string OwnTryOnConsentVersion,
    TeenTryOnDto TryOn,
    string? AdultFrom,
    IReadOnlyList<string> Restrictions,
    TeenStylistDto? Stylist = null);

/// <summary>GET v1/tenant/teen and the profile's ageBand / teen. AgeBand null = not given yet (Apple / Google before the age step).</summary>
public sealed record TeenStatusDto(AgeBand? AgeBand, TeenStateDto? Teen);

public enum TeenOutcome { Ok, NotTeen, AlreadyGiven, NotRequested, InvalidEmail, SameAsTeen, TooManyAttempts }

public sealed record TeenResult(TeenOutcome Outcome, TeenStatusDto? Status = null);

/// <summary>The parent page (anonymous). Kind request | manage; Status pending | approved | declined | withdrawn | ended.</summary>
public sealed record ParentConsentViewDto(
    string Kind, string Status, string? TeenName, string Language, DateTime? ExpiresAt, string TextVersion, bool TryOnOffered,
    bool ParentAllowedTryOn, DateTime? DecidedAt);

public sealed record ParentDecision(string Token, bool Approve, string? TextVersion, bool ConfirmParent, bool ConfirmNotice, bool ConfirmProcessing, bool AllowTryOn);

public enum ParentConsentOutcome { Ok, Invalid, Expired, AlreadyDecided, ConfirmationsRequired, VersionOutdated, NotApproved }

public sealed record ParentConsentResult(ParentConsentOutcome Outcome, ParentConsentViewDto? View = null);

public sealed record TeenDailyResult(int Teens, int BecameAdult, int PhotosPurged, int RequestsExpired);

public sealed record AdminTeenEventDto(DateTime At, ParentalConsentEvent Event, string? TextVersion, bool? TryOnAllowed, string? IpHash);

public sealed record AdminTeenDto(
    ParentalConsentStatus Status, string? ParentEmailMasked, DateTime? RequestSentAt, DateTime? RequestExpiresAt, DateTime? ApprovedAt,
    bool ParentAllowedTryOn, bool OwnTryOnConsent, string? AdultFrom, DateTime? PhotosPurgedAt, IReadOnlyList<AdminTeenEventDto> History);

public interface ITeenService
{
    Task<TeenAccess> AccessAsync(string userId, CancellationToken ct);
    Task<TeenStatusDto> StatusAsync(string userId, CancellationToken ct);
    Task<TeenStatusDto> StatusAsync(UserEntity user, CancellationToken ct);

    /// <summary>Apple / Google age step (and old accounts): stores the band; a teen gets the pending consent state.</summary>
    Task BecomeTeenAsync(UserEntity user, int birthYear, int? birthMonth, CancellationToken ct);

    Task<TeenResult> RequestConsentAsync(string userId, string parentEmail, CancellationToken ct);
    Task<TeenResult> ResendAsync(string userId, CancellationToken ct);

    Task<ParentConsentResult> ParentViewAsync(string token, CancellationToken ct);
    Task<ParentConsentResult> DecideAsync(ParentDecision decision, string? clientIp, CancellationToken ct);
    Task<ParentConsentResult> WithdrawAsync(string token, string? clientIp, CancellationToken ct);

    /// <summary>Sign-in / refresh of a teen: the retention clock (at most one write per day).</summary>
    Task TouchAsync(UserEntity user, CancellationToken ct);

    Task<AdminTeenDto?> AdminAsync(string tenantId, CancellationToken ct);
}

/// <summary>Daily run (Notifier lifecycle): turning 18, photo retention, request expiry.</summary>
public interface ITeenMaintenance
{
    Task<TeenDailyResult> RunAsync(DateTime nowUtc, CancellationToken ct);
}

/// <summary>Pure teen rules shared by the Api, the workers and the Notifier.</summary>
public static class TeenRules
{
    /// <summary>Wire names of what is off for every teen (teen.restrictions): the app hides these and must not start Firebase.</summary>
    public static readonly IReadOnlyList<string> Restrictions =
        ["social", "commerce", "paywall", "firebaseAnalytics", "firstPartyAnalytics", "marketingNotifications", "outfitPhotoTryOn"];

    /// <summary>Notification types a teen never receives (marketing and social).</summary>
    public static readonly IReadOnlySet<NotificationType> BlockedNotifications = new HashSet<NotificationType>
    {
        NotificationType.WeeklyEdit, NotificationType.PriceDrop, NotificationType.FriendRatings, NotificationType.FollowRequest,
        NotificationType.FeedLikesDigest,
    };

    /// <summary>Consents a teen may not give: marketing (no marketing pushes) and contacts (no contact matching).</summary>
    public static TeenFeature? ConsentClosedToTeens(ConsentType type) => type switch
    {
        ConsentType.MarketingNotifications => TeenFeature.Marketing,
        ConsentType.Contacts => TeenFeature.Contacts,
        _ => null,
    };

    /// <summary>Photo try-on targets (a photo of someone else wearing the outfit): never for teens.</summary>
    public static bool IsOutfitPhotoTarget(TryOnTargetKind kind) => kind is TryOnTargetKind.Photo or TryOnTargetKind.ImportPhoto;

    /// <summary>Sub-types left out of a teen's stylist candidates and picks on top of the whole beachwear category.</summary>
    private static readonly HashSet<string> RevealingSubcategories = new(StringComparer.OrdinalIgnoreCase)
    {
        "bikini", "swimsuit", "swim-shorts", "lingerie", "bodysuit", "bralette", "crop-top", "corset", "slip-dress", "mini-skirt",
    };

    /// <summary>The stricter refusal of revealing items for teens (stylist candidates, gap-fill picks).</summary>
    public static bool IsRevealing(ItemCategory category, string? subcategory) =>
        category == ItemCategory.Beachwear || (subcategory is { Length: > 0 } s && RevealingSubcategories.Contains(s));

    /// <summary>
    /// Teen try-on: all three conditions (docs/api/teen.md §6). Reason (null = available): feature_off, consent_not_active,
    /// parent_not_allowed, own_consent_missing.
    /// </summary>
    public static string? TryOnBlockReason(bool featureOn, ParentalConsentStatus? status, bool parentAllowedTryOn, bool ownConsent) =>
        !featureOn ? "feature_off"
        : status != ParentalConsentStatus.Active ? "consent_not_active"
        : !parentAllowedTryOn ? "parent_not_allowed"
        : !ownConsent ? "own_consent_missing"
        : null;

    /// <summary>Is the tenant a teen right now (worker / Notifier side: the tenant mirror, the age re-checked)?</summary>
    public static async Task<bool> IsTeenTenantAsync(this IRepository repository, string tenantId, CancellationToken ct)
    {
        var tenant = await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(tenantId), ct);
        return tenant?.IsTeen == true;
    }

    /// <summary>
    /// Worker side of the try-on gate: the teen tenant's three conditions read fresh (null reason = allowed). Adults →
    /// (false, null). The parent may have withdrawn between the request and the render.
    /// </summary>
    public static async Task<(bool IsTeen, string? BlockReason)> TeenTryOnAsync(this IRepository repository, string tenantId, TeenOptions teen,
        ConsentOptions consents, CancellationToken ct)
    {
        if (!await repository.IsTeenTenantAsync(tenantId, ct))
            return (false, null);
        var consent = await repository.GetAsync<ParentalConsentEntity>(ParentalConsentEntity.GetPk(tenantId), ParentalConsentEntity.GetSk(), ct);
        var own = await repository.GetAsync<ConsentEntity>(ConsentEntity.GetPk(tenantId), ConsentEntity.GetSk(ConsentType.TeenTryOn), ct);
        return (true, TryOnBlockReason(teen.TryOnEnabled, consent?.Status, consent?.ParentAllowedTryOn == true,
            ConsentRules.IsValid(own, consents.CurrentVersion(ConsentType.TeenTryOn))));
    }

    /// <summary>Sign-in / refresh of a teen moves the retention clock (at most one write per day). No-op for adults.</summary>
    public static async Task TouchTeenAsync(this IRepository repository, UserEntity user, DateTime now, CancellationToken ct)
    {
        if (user.AgeBand != AgeBand.Teen)
            return;
        var row = await repository.GetAsync<TeenAccountIndexEntity>(TeenAccountIndexEntity.GetPk(), TeenAccountIndexEntity.GetSk(user.TenantId), ct);
        if (row is null || row.LastActiveAt > now.AddDays(-1))
            return;
        row.LastActiveAt = now;
        await repository.SaveAsync(row, ct);
    }

    public static string? MaskEmail(string? email) => Admin.AiUsageMath.MaskEmail(email);

    /// <summary>The parent page shows the first word of the display name only.</summary>
    public static string? FirstName(string? displayName) =>
        string.IsNullOrWhiteSpace(displayName) ? null : displayName.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries)[0];
}
