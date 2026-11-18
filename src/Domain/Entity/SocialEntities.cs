using System.Text.Json.Serialization;
using Domain.Entity.Base;
using Domain.Enum;
using Domain.Extensions;

namespace Domain.Entity;

// E9. Every tenant-scoped entity here is in DeletionPlan; cross-tenant twins are removed by AccountDeletionService.

public class FollowingEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(FolloweeTenantId);

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("followeeTenantId")] public string FolloweeTenantId { get; set; } = null!;
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#following";
    public static string GetSk(string followeeTenantId) => followeeTenantId;
}

/// <summary>Written and deleted in the same transaction as its <see cref="FollowingEntity"/> twin.</summary>
public class FollowerEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(FollowerTenantId);

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("followerTenantId")] public string FollowerTenantId { get; set; } = null!;
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#follower";
    public static string GetSk(string followerTenantId) => followerTenantId;
}

/// <summary>In the look owner's partition. One rating per rater per look; a new score overwrites.</summary>
public class RatingEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(LookId, RaterTenantId);

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;          // look owner
    [JsonPropertyName("lookId")] public string LookId { get; set; } = null!;
    [JsonPropertyName("raterTenantId")] public string RaterTenantId { get; set; } = null!;
    [JsonPropertyName("score")] public int Score { get; set; }
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#rating";
    public static string GetSk(string lookId, string raterTenantId) => $"{lookId}#{raterTenantId}";
    public static string GetSkPrefix(string lookId) => $"{lookId}#";
}

/// <summary>In the rater's partition, so deleting the rater can remove the owner-side rating and fix the summary.</summary>
public class RatingGivenEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(OwnerTenantId, LookId);

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;          // rater
    [JsonPropertyName("ownerTenantId")] public string OwnerTenantId { get; set; } = null!;
    [JsonPropertyName("lookId")] public string LookId { get; set; } = null!;
    [JsonPropertyName("score")] public int Score { get; set; }
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#ratinggiven";
    public static string GetSk(string ownerTenantId, string lookId) => $"{ownerTenantId}#{lookId}";
}

/// <summary>Separate from the look so ratings never push the owner's look edit into a 409. Versioned: sum/count stay exact.</summary>
public class LookRatingSummaryEntity : IVersionedEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(LookId);

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("lookId")] public string LookId { get; set; } = null!;
    [JsonPropertyName("sum")] public long Sum { get; set; }
    [JsonPropertyName("count")] public long Count { get; set; }
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }
    [JsonPropertyName("version")] public long Version { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#lookrating";
    public static string GetSk(string lookId) => lookId;
}

/// <summary>"Somebody rated your look today" marker for the FriendRatings digest. No score, no rater. TTL 3 days.</summary>
public class RatingDigestEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(Day);
    [JsonPropertyName("sk")] public string Sk => GetSk(OwnerTenantId);

    [JsonPropertyName("day")] public string Day { get; set; } = null!;                    // yyyy-MM-dd UTC
    [JsonPropertyName("ownerTenantId")] public string OwnerTenantId { get; set; } = null!;
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }
    [JsonPropertyName("ttl")] public long Ttl => CreatedAt.AddDays(3).ToUnixTimeSeconds();

    public static string GetPk(string day) => $"ratingdigest#{day}";
    public static string GetSk(string ownerTenantId) => ownerTenantId;
}

public class SavedLookEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(OwnerTenantId, LookId);

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("ownerTenantId")] public string OwnerTenantId { get; set; } = null!;
    [JsonPropertyName("lookId")] public string LookId { get; set; } = null!;
    [JsonPropertyName("savedAt")] public DateTime SavedAt { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#savedlook";
    public static string GetSk(string ownerTenantId, string lookId) => $"{ownerTenantId}#{lookId}";
}

/// <summary>Twin of <see cref="SavedLookEntity"/> in the look owner's partition, so the owner's account deletion can remove the savers' rows.</summary>
public class SavedByEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(LookId, SaverTenantId);

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;          // look owner
    [JsonPropertyName("lookId")] public string LookId { get; set; } = null!;
    [JsonPropertyName("saverTenantId")] public string SaverTenantId { get; set; } = null!;

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#savedby";
    public static string GetSk(string lookId, string saverTenantId) => $"{lookId}#{saverTenantId}";
}

/// <summary>Share record (brief §5.7): channel + invite code. No reward in phase 1.</summary>
public class ShareEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(Id);

    [JsonPropertyName("id")] public string Id { get; set; } = null!;
    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("channel")] public ShareChannel Channel { get; set; }
    [JsonPropertyName("targetKind")] public ShareTargetKind TargetKind { get; set; }
    [JsonPropertyName("targetId")] public string? TargetId { get; set; }
    [JsonPropertyName("ownerHandle")] public string? OwnerHandle { get; set; }
    [JsonPropertyName("inviteCode")] public string InviteCode { get; set; } = null!;
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#share";
    public static string GetSk(string shareId) => shareId;
}

/// <summary>The tenant's own invite code and (once) who invited them.</summary>
public class InviteEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk();

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("code")] public string? Code { get; set; }
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }
    [JsonPropertyName("invitedByTenantId")] public string? InvitedByTenantId { get; set; }
    [JsonPropertyName("invitedByCode")] public string? InvitedByCode { get; set; }
    [JsonPropertyName("attributedAt")] public DateTime? AttributedAt { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#invite";
    public static string GetSk() => "current";
}

/// <summary>Global code → tenant (conditional create = uniqueness). Removed on account deletion.</summary>
public class InviteCodeEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk();
    [JsonPropertyName("sk")] public string Sk => GetSk(Code);

    [JsonPropertyName("code")] public string Code { get; set; } = null!;
    [JsonPropertyName("ownerTenantId")] public string OwnerTenantId { get; set; } = null!;
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }

    public static string GetPk() => "invitecode";
    public static string GetSk(string code) => code.Trim().ToUpperInvariant();
}

/// <summary>In the inviter's partition: one row per account that installed through their link.</summary>
public class InviteeEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(InviteeTenantId);

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("inviteeTenantId")] public string InviteeTenantId { get; set; } = null!;
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#invitee";
    public static string GetSk(string inviteeTenantId) => inviteeTenantId;
}

public class BlockEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(BlockedTenantId);

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("blockedTenantId")] public string BlockedTenantId { get; set; } = null!;
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#block";
    public static string GetSk(string blockedTenantId) => blockedTenantId;
}

/// <summary>Twin of <see cref="BlockEntity"/> in the blocked tenant's partition (never listed to them).</summary>
public class BlockedByEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(BlockerTenantId);

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("blockerTenantId")] public string BlockerTenantId { get; set; } = null!;
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#blockedby";
    public static string GetSk(string blockerTenantId) => blockerTenantId;
}

/// <summary>Moderation queue (global, admin only). The free-text note is never logged.</summary>
public class ReportEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(Status);
    [JsonPropertyName("sk")] public string Sk => GetSk(Id);

    [JsonPropertyName("id")] public string Id { get; set; } = null!;
    [JsonPropertyName("status")] public ReportStatus Status { get; set; }
    [JsonPropertyName("reporterTenantId")] public string? ReporterTenantId { get; set; }
    [JsonPropertyName("targetTenantId")] public string TargetTenantId { get; set; } = null!;
    [JsonPropertyName("targetKind")] public ReportTargetKind TargetKind { get; set; }
    [JsonPropertyName("targetId")] public string? TargetId { get; set; }
    [JsonPropertyName("reason")] public ReportReason Reason { get; set; }
    [JsonPropertyName("note")] public string? Note { get; set; }
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }
    [JsonPropertyName("resolution")] public ReportResolution? Resolution { get; set; }
    [JsonPropertyName("resolutionNote")] public string? ResolutionNote { get; set; }
    [JsonPropertyName("resolvedByUserId")] public string? ResolvedByUserId { get; set; }
    [JsonPropertyName("resolvedAt")] public DateTime? ResolvedAt { get; set; }

    public static string GetPk(ReportStatus status) => $"report#{status.ToString().ToLowerInvariant()}";
    public static string GetSk(string reportId) => reportId;
}

public class ReportFiledEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(ReportId);

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("reportId")] public string ReportId { get; set; } = null!;
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#reportfiled";
    public static string GetSk(string reportId) => reportId;
}

public class ReportReceivedEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(ReportId);

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("reportId")] public string ReportId { get; set; } = null!;
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#reportreceived";
    public static string GetSk(string reportId) => reportId;
}

/// <summary>Only tenants whose closet is Public (and never Teen, A-5). Maintained in the visibility transaction.</summary>
public class PublicProfileIndexEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(Segment);
    [JsonPropertyName("sk")] public string Sk => GetSk(PublicTenantId);

    [JsonPropertyName("segment")] public Segment Segment { get; set; }
    [JsonPropertyName("publicTenantId")] public string PublicTenantId { get; set; } = null!;
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }

    public static string GetPk(Segment segment) => $"publicprofile#{segment.ToString().ToLowerInvariant()}";
    public static string GetSk(string publicTenantId) => publicTenantId;
}
