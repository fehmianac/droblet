using System.Text.Json.Serialization;
using Domain.Entity.Base;
using Domain.Enum;
using Domain.Extensions;

namespace Domain.Entity;

// Akış F1 (owner decisions 16–19): editor content only, written by the admin API / seed tool. Text is a per-language
// map resolved on read. Ids are never reused; a removed post / story is `retired`.

public class FeedAuthor
{
    [JsonPropertyName("kind")] public FeedAuthorKind Kind { get; set; }
    /// <summary>Localized display name ("Droblet Edit", a stylist's placeholder name).</summary>
    [JsonPropertyName("name")] public Dictionary<string, string> Name { get; set; } = [];
    [JsonPropertyName("handle")] public string? Handle { get; set; }
    [JsonPropertyName("imageUrl")] public string? ImageUrl { get; set; }
}

/// <summary>An Akış editor post: 1–4 images, 0–8 catalog products. likeCount lives in <see cref="FeedPostStatsEntity"/>.</summary>
public class FeedPostEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk();
    [JsonPropertyName("sk")] public string Sk => GetSk(Id);

    [JsonPropertyName("id")] public string Id { get; set; } = null!;
    /// <summary>Null = every segment.</summary>
    [JsonPropertyName("segment")] public Segment? Segment { get; set; }
    [JsonPropertyName("author")] public FeedAuthor Author { get; set; } = new();
    [JsonPropertyName("occasion")] public Occasion Occasion { get; set; }
    [JsonPropertyName("title")] public Dictionary<string, string> Title { get; set; } = [];
    [JsonPropertyName("note")] public Dictionary<string, string>? Note { get; set; }
    [JsonPropertyName("imageUrls")] public List<string> ImageUrls { get; set; } = [];
    [JsonPropertyName("productIds")] public List<string> ProductIds { get; set; } = [];
    [JsonPropertyName("publishAt")] public DateTime PublishAt { get; set; }
    [JsonPropertyName("sortOrder")] public int SortOrder { get; set; }
    [JsonPropertyName("published")] public bool Published { get; set; }
    [JsonPropertyName("retired")] public bool Retired { get; set; }
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }

    public static string GetPk() => "content#feedpost";
    public static string GetSk(string postId) => postId;
}

/// <summary>
/// The like counter of a post, apart from the post so an admin edit never overwrites it (same reason as
/// LookRatingSummaryEntity). Written only together with a FeedLike row, in one versioned transaction.
/// </summary>
public class FeedPostStatsEntity : IVersionedEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk();
    [JsonPropertyName("sk")] public string Sk => GetSk(PostId);

    [JsonPropertyName("postId")] public string PostId { get; set; } = null!;
    [JsonPropertyName("likeCount")] public long LikeCount { get; set; }
    /// <summary>Akış F2, user posts only (the owner's feedStats.saveCount); editor posts do not count saves.</summary>
    [JsonPropertyName("saveCount")] public long SaveCount { get; set; }
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }
    [JsonPropertyName("version")] public long Version { get; set; }

    public static string GetPk() => "content#feedpost#stats";
    public static string GetSk(string postId) => postId;
}

public class FeedStoryAuthor
{
    [JsonPropertyName("name")] public Dictionary<string, string> Name { get; set; } = [];
    [JsonPropertyName("imageUrl")] public string? ImageUrl { get; set; }
}

/// <summary>An Akış editor story: one image, a headline, optionally one catalog product; visible between publishAt and expiresAt.</summary>
public class FeedStoryEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk();
    [JsonPropertyName("sk")] public string Sk => GetSk(Id);

    [JsonPropertyName("id")] public string Id { get; set; } = null!;
    [JsonPropertyName("segment")] public Segment? Segment { get; set; }
    [JsonPropertyName("author")] public FeedStoryAuthor Author { get; set; } = new();
    [JsonPropertyName("imageUrl")] public string ImageUrl { get; set; } = null!;
    [JsonPropertyName("headline")] public Dictionary<string, string> Headline { get; set; } = [];
    [JsonPropertyName("productId")] public string? ProductId { get; set; }
    [JsonPropertyName("publishAt")] public DateTime PublishAt { get; set; }
    [JsonPropertyName("expiresAt")] public DateTime? ExpiresAt { get; set; }
    [JsonPropertyName("sortOrder")] public int SortOrder { get; set; }
    [JsonPropertyName("published")] public bool Published { get; set; }
    [JsonPropertyName("retired")] public bool Retired { get; set; }
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }

    public static string GetPk() => "content#feedstory";
    public static string GetSk(string storyId) => storyId;
}

// Tenant scoped ------------------------------------------------------------------------------------------------

/// <summary>The ♡ on an Akış post. Account deletion takes the like back off the post's counter (ICrossTenantCleanup).</summary>
public class FeedLikeEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(PostId);

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("postId")] public string PostId { get; set; } = null!;
    [JsonPropertyName("likedAt")] public DateTime LikedAt { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#feedlike";
    public static string GetSk(string postId) => postId;
}

/// <summary>"Kaydet" on an Akış post (the saved list, newest first).</summary>
public class FeedSaveEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(PostId);

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("postId")] public string PostId { get; set; } = null!;
    [JsonPropertyName("savedAt")] public DateTime SavedAt { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#feedsave";
    public static string GetSk(string postId) => postId;
}

// Akış F2 (owner decision 21): a user's own look shared to the home feed -------------------------------------------

/// <summary>
/// "Akışta paylaş" on a look, in the owner's partition (the look row itself is not touched: a write there would bump the
/// version the app edits against). Its twin is the global <see cref="FeedUserPostEntity"/> (same transaction).
/// </summary>
public class FeedShareEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(LookId);

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("lookId")] public string LookId { get; set; } = null!;
    [JsonPropertyName("postId")] public string PostId { get; set; } = null!;
    [JsonPropertyName("sharedAt")] public DateTime SharedAt { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#feedshare";
    public static string GetSk(string lookId) => lookId;
}

/// <summary>
/// Global index of the shared looks (the feed's candidates): a pointer and its moderation state, no content — title,
/// occasion, pieces and cover are read from the owner's look on every request. Id = FeedRules.UserPostId(owner, look).
/// HiddenAt = taken off the feed automatically by reports (ContentFeed:ReportsToAutoHide distinct reporters) until an
/// admin restores or removes it. ReportCount = distinct reporters of the look's OPEN reports.
/// </summary>
public class FeedUserPostEntity : IVersionedEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk();
    [JsonPropertyName("sk")] public string Sk => GetSk(Id);

    [JsonPropertyName("id")] public string Id { get; set; } = null!;
    [JsonPropertyName("ownerTenantId")] public string OwnerTenantId { get; set; } = null!;
    [JsonPropertyName("lookId")] public string LookId { get; set; } = null!;
    [JsonPropertyName("sharedAt")] public DateTime SharedAt { get; set; }
    [JsonPropertyName("reportCount")] public int ReportCount { get; set; }
    [JsonPropertyName("hiddenAt")] public DateTime? HiddenAt { get; set; }
    [JsonPropertyName("restoredAt")] public DateTime? RestoredAt { get; set; }
    [JsonPropertyName("restoredByUserId")] public string? RestoredByUserId { get; set; }
    [JsonPropertyName("removedAt")] public DateTime? RemovedAt { get; set; }
    [JsonPropertyName("removedByUserId")] public string? RemovedByUserId { get; set; }
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }
    [JsonPropertyName("version")] public long Version { get; set; }

    public static string GetPk() => "content#feeduserpost";
    public static string GetSk(string postId) => postId;
}

public enum FeedReactionKind { Like, Save, Hide, Report }

/// <summary>
/// Reverse index of a USER post: who liked / saved / hid / reported it, so un-share, look deletion and the owner's account
/// deletion can remove those rows from the other tenants' partitions. Written and deleted with the tenant-side row.
/// </summary>
public class FeedPostReactionEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(PostId);
    [JsonPropertyName("sk")] public string Sk => GetSk(Kind, TenantId);

    [JsonPropertyName("postId")] public string PostId { get; set; } = null!;
    [JsonPropertyName("kind")] public FeedReactionKind Kind { get; set; }
    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;

    public static string GetPk(string postId) => $"content#feeduserpost#{postId}#reaction";
    public static string GetSk(FeedReactionKind kind, string tenantId) => $"{kind.ToString().ToLowerInvariant()}#{tenantId}";
}

/// <summary>"Bunu gösterme": the post is never returned to this tenant again.</summary>
public class FeedHideEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(PostId);

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("postId")] public string PostId { get; set; } = null!;
    [JsonPropertyName("hiddenAt")] public DateTime HiddenAt { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#feedhide";
    public static string GetSk(string postId) => postId;
}

/// <summary>The reporter's pointer "I reported this post" → the moderation report (one report per user per post).</summary>
public class FeedReportEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(PostId);

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("postId")] public string PostId { get; set; } = null!;
    [JsonPropertyName("reportId")] public string ReportId { get; set; } = null!;
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#feedreport";
    public static string GetSk(string postId) => postId;
}

/// <summary>
/// "Somebody liked your shared look today" marker for the daily likes digest (one row per owner and liker per UTC day; an
/// un-like of the same day removes it). No post, no text. TTL 3 days.
/// </summary>
public class FeedLikeDigestEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(Day);
    [JsonPropertyName("sk")] public string Sk => GetSk(OwnerTenantId, LikerTenantId);

    [JsonPropertyName("day")] public string Day { get; set; } = null!;                    // yyyy-MM-dd UTC
    [JsonPropertyName("ownerTenantId")] public string OwnerTenantId { get; set; } = null!;
    [JsonPropertyName("likerTenantId")] public string LikerTenantId { get; set; } = null!;
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }
    [JsonPropertyName("ttl")] public long Ttl => CreatedAt.AddDays(3).ToUnixTimeSeconds();

    public static string GetPk(string day) => $"feedlikedigest#{day}";
    public static string GetSk(string ownerTenantId, string likerTenantId) => $"{ownerTenantId}#{likerTenantId}";
    public static string GetSkPrefix(string ownerTenantId) => $"{ownerTenantId}#";
}
