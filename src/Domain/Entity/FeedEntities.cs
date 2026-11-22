using System.Text.Json.Serialization;
using Domain.Entity.Base;
using Domain.Enum;

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
