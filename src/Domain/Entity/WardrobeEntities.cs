using System.Text.Json.Serialization;
using Domain.Entity.Base;
using Domain.Enum;
using Domain.Extensions;
using Domain.Services.Ai;

namespace Domain.Entity;

// A wardrobe piece. Written only by the confirm / library / product endpoints — never by a worker.
public class ItemEntity : IVersionedEntity, IModeratedEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(Id);

    [JsonPropertyName("id")] public string Id { get; set; } = null!;   // ULID, client generated (offline create)
    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("category")] public ItemCategory Category { get; set; }
    // Free sub-type id from the form ("blazer"); the category stays the outfit-slot driver.
    [JsonPropertyName("subcategory")] public string? Subcategory { get; set; }
    [JsonPropertyName("colorIds")] public List<string> ColorIds { get; set; } = [];   // first = main colour
    // Only with the colour id "other": the user's own colour (#RRGGBB).
    [JsonPropertyName("colorHex")] public string? ColorHex { get; set; }
    [JsonPropertyName("fabric")] public string? Fabric { get; set; }
    // Free-text fabric when it is not one of the fabric ids (kept verbatim, never sent to an AI prompt as an id).
    [JsonPropertyName("fabricText")] public string? FabricText { get; set; }
    [JsonPropertyName("seasons")] public List<Season> Seasons { get; set; } = [];     // at least one
    [JsonPropertyName("size")] public string? Size { get; set; }
    [JsonPropertyName("brand")] public string? Brand { get; set; }
    [JsonPropertyName("source")] public ItemSource Source { get; set; }
    [JsonPropertyName("productId")] public string? ProductId { get; set; }
    [JsonPropertyName("libraryItemId")] public string? LibraryItemId { get; set; }

    // Private S3 (tenant prefix): cleaned image + the EXIF-stripped original ("Orijinale dön").
    [JsonPropertyName("imageKey")] public string? ImageKey { get; set; }
    [JsonPropertyName("originalImageKey")] public string? OriginalImageKey { get; set; }
    [JsonPropertyName("useOriginalImage")] public bool UseOriginalImage { get; set; }
    // Global asset key for library / catalog sourced pieces (not user data).
    [JsonPropertyName("globalImageKey")] public string? GlobalImageKey { get; set; }

    // Server-computed from WearLog events (WearStatsRules) — never accepted from a client.
    [JsonPropertyName("wearCount")] public int WearCount { get; set; }
    [JsonPropertyName("lastWornAt")] public string? LastWornAt { get; set; }          // calendar day yyyy-MM-dd

    // Reserved for phase 2 (sell / rent). Always None in phase 1.
    [JsonPropertyName("listingStatus")] public ItemListingStatus ListingStatus { get; set; }

    // Moderation (report resolved as contentRemoved): hidden from everyone but the owner. Written only by the moderation
    // service; owner edits load and save the whole row, so they keep these fields.
    [JsonPropertyName("moderationHiddenAt")] public DateTime? ModerationHiddenAt { get; set; }
    [JsonPropertyName("moderationReportId")] public string? ModerationReportId { get; set; }
    [JsonPropertyName("moderationReason")] public ReportReason? ModerationReason { get; set; }

    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }
    [JsonPropertyName("version")] public long Version { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#item";
    public static string GetSk(string id) => id;
}

// Upload slot issued by POST v1/tenant/item/upload-url. The upload id becomes the draft id.
public class ItemUploadEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(UploadId);

    [JsonPropertyName("uploadId")] public string UploadId { get; set; } = null!;
    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("contentType")] public string ContentType { get; set; } = null!;
    [JsonPropertyName("s3Key")] public string S3Key { get; set; } = null!;
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }

    // Same lifetime as the uploads/tmp/ S3 lifecycle rule (1 day).
    [JsonPropertyName("ttl")] public long Ttl => CreatedAt.AddDays(1).ToUnixTimeSeconds();

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#itemupload";
    public static string GetSk(string uploadId) => uploadId;
}

// AI suggestion waiting for the user's confirmation. Becomes an Item only through POST item-draft/confirm.
public class ItemDraftEntity : IEntity
{
    public const int RetentionDays = 7;

    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(Id);

    [JsonPropertyName("id")] public string Id { get; set; } = null!;
    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("kind")] public ItemDraftKind Kind { get; set; }
    [JsonPropertyName("status")] public ItemDraftStatus Status { get; set; }
    [JsonPropertyName("requestId")] public string? RequestId { get; set; }
    [JsonPropertyName("jobId")] public string? JobId { get; set; }
    [JsonPropertyName("parentDraftId")] public string? ParentDraftId { get; set; }
    [JsonPropertyName("originalKey")] public string? OriginalKey { get; set; }
    [JsonPropertyName("processedKey")] public string? ProcessedKey { get; set; }

    // Suggestions (GarmentVisionGuard output). Empty = the model had nothing valid to offer.
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("category")] public ItemCategory? Category { get; set; }
    [JsonPropertyName("colorIds")] public List<string> ColorIds { get; set; } = [];
    [JsonPropertyName("fabric")] public string? Fabric { get; set; }
    [JsonPropertyName("seasons")] public List<Season> Seasons { get; set; } = [];
    // Language the AI wrote the suggested name in (regenerate rather than show the wrong language).
    [JsonPropertyName("language")] public string? Language { get; set; }
    [JsonPropertyName("flaggedFields")] public List<string> FlaggedFields { get; set; } = [];
    // "Kategoriyi kontrol et": confirm requires reviewed = true; "select all" skips these.
    [JsonPropertyName("needsReview")] public bool NeedsReview { get; set; }
    // Suggested sub-type id (SubcategoryCatalog), e.g. "necklace".
    [JsonPropertyName("subcategory")] public string? Subcategory { get; set; }

    // Multi-item detection. A piece: its normalised box in the group photo, its number (1-based, reading order) and the
    // model's confidence that it is one separate piece; Selected once the user kept it (its background removal is queued).
    [JsonPropertyName("box")] public BoundingBox? Box { get; set; }
    [JsonPropertyName("index")] public int? Index { get; set; }
    [JsonPropertyName("confidence")] public double? Confidence { get; set; }
    [JsonPropertyName("selected")] public bool Selected { get; set; }
    // The group source (kind Outfit): how many pieces were found, and the photo's pixel size (boxes are drawn on it).
    [JsonPropertyName("itemCount")] public int? ItemCount { get; set; }
    [JsonPropertyName("photoWidth")] public int? PhotoWidth { get; set; }
    [JsonPropertyName("photoHeight")] public int? PhotoHeight { get; set; }
    // Why a failed draft failed (guardRejected = no piece was found in the photo).
    [JsonPropertyName("failure")] public JobFailure? Failure { get; set; }

    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }

    [JsonPropertyName("ttl")] public long Ttl => CreatedAt.AddDays(RetentionDays).ToUnixTimeSeconds();

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#itemdraft";
    public static string GetSk(string id) => id;
}

// Global "hazır ürün kütüphanesi" (screen 12b / onboarding 04b). Seeded from seed/library/items.json; users never write it.
public class LibraryItemEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk();
    [JsonPropertyName("sk")] public string Sk => GetSk(Id);

    [JsonPropertyName("id")] public string Id { get; set; } = null!;
    // Localized map { "tr": "…", "en": "…" }; resolved per request language with a Turkish fallback.
    [JsonPropertyName("name")] public Dictionary<string, string> Name { get; set; } = [];
    [JsonPropertyName("category")] public ItemCategory Category { get; set; }
    [JsonPropertyName("colorIds")] public List<string> ColorIds { get; set; } = [];
    [JsonPropertyName("fabric")] public string? Fabric { get; set; }
    [JsonPropertyName("seasons")] public List<Season> Seasons { get; set; } = [];
    [JsonPropertyName("imageKey")] public string? ImageKey { get; set; }
    [JsonPropertyName("sortOrder")] public int SortOrder { get; set; }
    [JsonPropertyName("retired")] public bool Retired { get; set; }

    public static string GetPk() => "library#item";
    public static string GetSk(string id) => id;
}

/// <summary>One in-flight AI recognition of a non-member (released when the job fails, counted when it completes).</summary>
public class ItemRecognitionPending
{
    [JsonPropertyName("jobId")] public string JobId { get; set; } = null!;
    [JsonPropertyName("at")] public DateTime At { get; set; }
}

// Lifetime counter of a non-member's AI garment recognitions (Entitlements:Free:ItemRecognitionLimit). Server-side only.
public class ItemRecognitionUsageEntity : IVersionedEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk();

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    // Recognitions that completed. Never decremented.
    [JsonPropertyName("used")] public int Used { get; set; }
    // Reserved when the job is queued; a job that fails gives its slot back, one that completes moves to `used`.
    [JsonPropertyName("pending")] public List<ItemRecognitionPending> Pending { get; set; } = [];
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }
    [JsonPropertyName("version")] public long Version { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#itemrecognition";
    public static string GetSk() => "usage";
}
