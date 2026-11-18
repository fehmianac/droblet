using Domain.Domain;
using Domain.Entity;
using Domain.Enum;

namespace Domain.Services;

// ── DTOs (camelCase JSON) ───────────────────────────────────────────────────────────────────────────────────────

/// <summary>What anybody allowed to see the profile card gets: never e-mail, body data or photos.</summary>
public record PersonCardDto(
    string Handle,
    string? DisplayName,
    IReadOnlyList<StyleTag> StyleTags,
    int StyleMatchPercent,
    bool IsFollowing,
    bool FollowsYou,
    // Decision 8: none / requested (pending, not following) / following. RequestedYou = they asked to follow me.
    FollowState FollowState = FollowState.None,
    bool RequestedYou = false);

/// <summary>A pending follow request (incoming: the requester; outgoing: the account I asked).</summary>
public record FollowRequestDto(PersonCardDto Person, DateTime CreatedAt);

public record FollowResultDto(FollowState State);

public record PersonProfileDto(
    string Handle,
    string? DisplayName,
    IReadOnlyList<StyleTag> StyleTags,
    int StyleMatchPercent,
    bool IsSelf,
    bool IsFollowing,
    bool FollowsYou,
    ClosetVisibility ClosetVisibility,
    // True when this viewer may not open the Looks / Dolap tabs (screen "KisiGizli").
    bool ClosetLocked,
    int? ItemCount,
    int? LookCount,
    int FollowerCount,
    int FollowingCount,
    FollowState FollowState = FollowState.None,
    bool RequestedYou = false,
    // Profile picture, presigned and short-lived; only when this viewer may see the closet (ClosetLocked false). Never a body / face photo.
    string? AvatarUrl = null);

public record SocialLookPieceDto(OutfitSlot Slot, string? ItemId, string? ProductId, string? Name, string? ImageUrl, ProductDto? Product);

public record LookRatingDto(double? Average, long Count, int? MyScore);

public record SocialLookDto(
    string Id,
    string OwnerHandle,
    string? OwnerDisplayName,
    string Name,
    string? Occasion,
    DateTime CreatedAt,
    IReadOnlyList<SocialLookPieceDto> Pieces,
    LookRatingDto Rating,
    bool Saved);

public record SocialTripDto(string Id, string City, string Month);

public record PagedDto<T>(IReadOnlyList<T> Items, string? PageToken);

public record InviteLinkDto(string Code, string Url, int InvitedCount);

public record ShareDto(string ShareId, string InviteCode, string Url, ShareChannel Channel);

/// <summary>Anonymous preview: the minimum (first name only).</summary>
public record InvitePreviewDto(string Code, string? InviterFirstName);

public record ModerationReportDto(
    string Id,
    ReportStatus Status,
    string? ReporterTenantId,
    string? ReporterHandle,
    string TargetTenantId,
    string? TargetHandle,
    ReportTargetKind TargetKind,
    string? TargetId,
    ReportReason Reason,
    string? Note,
    DateTime CreatedAt,
    ReportResolution? Resolution,
    string? ResolutionNote,
    string? ResolvedByUserId,
    DateTime? ResolvedAt);

// ── People / visibility ─────────────────────────────────────────────────────────────────────────────────────────

/// <summary>The viewer's relation to another tenant, resolved fresh on every request (never cached).</summary>
public sealed record PersonContext(
    string ViewerTenantId,
    TenantEntity Owner,
    bool ViewerFollowsOwner,
    bool OwnerFollowsViewer,
    bool Blocked,
    bool ViewerRequested = false,
    bool OwnerRequestedViewer = false)
{
    public FollowState FollowState => ViewerFollowsOwner ? FollowState.Following : ViewerRequested ? FollowState.Requested : FollowState.None;

    public bool IsSelf => ViewerTenantId == Owner.Id;

    /// <summary>The only way social code decides a cross-tenant read. A block in either direction hides everything.</summary>
    public bool CanView(VisibleResource resource) => VisibilityPolicy.CanView(new VisibilityRequest(
        ViewerTenantId, Owner.Id, Owner.ClosetVisibility, ViewerFollowsOwner, resource, Owner.Segment, OwnerBlockedViewer: Blocked,
        OwnerFollowsViewer: OwnerFollowsViewer, OwnerRequestedViewer: OwnerRequestedViewer));
}

public enum SocialOutcome { Ok, NotFound, Self, LimitReached, RateLimited }

public interface ISocialService
{
    /// <summary>Null = unknown handle, deleted, blocked either way, or the profile card is not visible → 404.</summary>
    Task<PersonContext?> ResolveAsync(string viewerTenantId, string handle, CancellationToken ct);

    Task<IReadOnlyList<PersonCardDto>> SearchAsync(string viewerTenantId, string query, CancellationToken ct);
    Task<IReadOnlyList<PersonCardDto>> SuggestedAsync(string viewerTenantId, CancellationToken ct);
    /// <summary>Cards of the given accounts that the viewer may see (visibility, blocks), in the given order.</summary>
    Task<IReadOnlyList<PersonCardDto>> CardsForAsync(string viewerTenantId, IReadOnlyList<string> tenantIds, CancellationToken ct);
    Task<PersonProfileDto?> GetProfileAsync(string viewerTenantId, string handle, CancellationToken ct);
    Task<IReadOnlyList<SocialLookDto>?> GetLooksAsync(string viewerTenantId, string handle, CancellationToken ct);
    Task<IReadOnlyList<ClosetItemDto>?> GetItemsAsync(string viewerTenantId, string handle, CancellationToken ct);
    Task<IReadOnlyList<SocialTripDto>?> GetTripsAsync(string viewerTenantId, string handle, CancellationToken ct);
    Task<PagedDto<SocialLookDto>> GetFeedAsync(string viewerTenantId, string? pageToken, CancellationToken ct);

    /// <summary>Public owner → following at once; followers-only / private owner → a pending request (decision 8).</summary>
    Task<(SocialOutcome Outcome, FollowState State)> FollowAsync(string viewerTenantId, string handle, CancellationToken ct);
    /// <summary>Removes my follow and my pending request. Idempotent.</summary>
    Task<SocialOutcome> UnfollowAsync(string viewerTenantId, string handle, CancellationToken ct);
    Task<IReadOnlyList<FollowRequestDto>> GetFollowRequestsAsync(string viewerTenantId, bool incoming, CancellationToken ct);
    /// <summary>NotFound when that account has no pending request to me.</summary>
    Task<SocialOutcome> AnswerFollowRequestAsync(string viewerTenantId, string requesterHandle, bool approve, CancellationToken ct);
    Task<SocialOutcome> CancelFollowRequestAsync(string viewerTenantId, string handle, CancellationToken ct);
    Task<SocialOutcome> RemoveFollowerAsync(string viewerTenantId, string followerHandle, CancellationToken ct);
    Task<IReadOnlyList<PersonCardDto>> GetFollowersAsync(string viewerTenantId, CancellationToken ct);
    Task<IReadOnlyList<PersonCardDto>> GetFollowingAsync(string viewerTenantId, CancellationToken ct);

    Task<(SocialOutcome Outcome, LookRatingDto? Rating)> RateAsync(string viewerTenantId, string handle, string lookId, int score, CancellationToken ct);
    Task<SocialOutcome> SaveLookAsync(string viewerTenantId, string handle, string lookId, CancellationToken ct);
    Task<SocialOutcome> UnsaveLookAsync(string viewerTenantId, string handle, string lookId, CancellationToken ct);
    Task<IReadOnlyList<SocialLookDto>> GetSavedLooksAsync(string viewerTenantId, CancellationToken ct);

    Task<SocialOutcome> BlockAsync(string viewerTenantId, string handle, CancellationToken ct);
    Task<SocialOutcome> UnblockAsync(string viewerTenantId, string handle, CancellationToken ct);
    Task<IReadOnlyList<PersonCardDto>> GetBlockedAsync(string viewerTenantId, CancellationToken ct);

    Task<(SocialOutcome Outcome, string? ReportId)> ReportAsync(
        string viewerTenantId, string handle, ReportTargetKind targetKind, string? targetId, ReportReason reason, string? note, CancellationToken ct);

    // Moderation (admin)
    Task<PagedDto<ModerationReportDto>> ListReportsAsync(ReportStatus status, string? pageToken, int? limit, CancellationToken ct);
    Task<ModerationReportDto?> ResolveReportAsync(string reportId, ReportResolution resolution, string? note, string adminUserId, CancellationToken ct);
}

public enum InviteOutcome { Attributed, CodeNotFound, Self, AlreadyAttributed, WindowClosed }

public interface IInviteService
{
    Task<InviteLinkDto> GetLinkAsync(string tenantId, CancellationToken ct);
    Task<ShareDto> RecordShareAsync(string tenantId, string shareId, ShareChannel channel, ShareTargetKind targetKind, string? targetId, string? ownerHandle, CancellationToken ct);
    Task<InvitePreviewDto?> ResolveAsync(string code, CancellationToken ct);
    /// <summary>Deferred deep link: the first authenticated call that carries the code stores the inviter (once).</summary>
    Task<InviteOutcome> AttributeAsync(string tenantId, string code, CancellationToken ct);
}

/// <summary>Removes what an account left in OTHER tenants' partitions and in global indexes (E9/E8/E11 part of "Hesabımı sil").</summary>
public interface ICrossTenantCleanup
{
    Task CleanAsync(string tenantId, CancellationToken ct);
}
