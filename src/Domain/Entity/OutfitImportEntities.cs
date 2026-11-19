using System.Text.Json.Serialization;
using Domain.Entity.Base;
using Domain.Enum;
using Domain.Extensions;
using Domain.Services.Ai;

namespace Domain.Entity;

/// <summary>
/// One "Kombinlerini içe aktar" run: up to Entitlements:*:OutfitImportMaxPhotos photos, one look draft per photo. The
/// progress counters (uploaded / detected / matched / ready / failed) are top-level numbers changed only by atomic ADDs
/// (IRepository.AddCountersAsync), never by a read-modify-write of the row. The id is the client's requestId (idempotent
/// create). Unfinished sessions expire with the TTL; a committed one stays until then so a replayed commit answers the same.
/// </summary>
public class OutfitImportSessionEntity : IVersionedEntity
{
    public const int RetentionDays = 7;

    public const string CounterUploaded = "uploaded";
    public const string CounterDetected = "detected";
    public const string CounterMatched = "matched";
    public const string CounterReady = "ready";
    public const string CounterFailed = "failed";

    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(Id);

    [JsonPropertyName("id")] public string Id { get; set; } = null!;
    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("status")] public OutfitImportStatus Status { get; set; }
    // Photos of the session (slots issued). A free user's request above the recognition allowance gets fewer.
    [JsonPropertyName("count")] public int Count { get; set; }
    // Photos the client asked for (count may be lower: recognition allowance).
    [JsonPropertyName("requested")] public int Requested { get; set; }
    // Language of the AI piece names.
    [JsonPropertyName("language")] public string? Language { get; set; }

    [JsonPropertyName(CounterUploaded)] public long Uploaded { get; set; }
    [JsonPropertyName(CounterDetected)] public long Detected { get; set; }
    [JsonPropertyName(CounterMatched)] public long Matched { get; set; }
    [JsonPropertyName(CounterReady)] public long Ready { get; set; }
    [JsonPropertyName(CounterFailed)] public long Failed { get; set; }

    // Set once by the worker that finished the last photo (inbox row written).
    [JsonPropertyName("notifiedAt")] public string? NotifiedAt { get; set; }
    // Commit result (replayed as is).
    [JsonPropertyName("committedAt")] public DateTime? CommittedAt { get; set; }
    [JsonPropertyName("result")] public string? Result { get; set; }

    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }
    [JsonPropertyName("version")] public long Version { get; set; }

    [JsonPropertyName("ttl")] public long Ttl => CreatedAt.AddDays(RetentionDays).ToUnixTimeSeconds();

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#outfitimport";
    public static string GetSk(string id) => id;
}

/// <summary>One piece found in an import photo (stage A), with its match (stage B) or its session piece (stage C).</summary>
public class OutfitImportOccurrence
{
    // "{photoIndex}-{n}": the commit's piece ref.
    [JsonPropertyName("ref")] public string Ref { get; set; } = null!;
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("category")] public ItemCategory Category { get; set; }
    [JsonPropertyName("subcategory")] public string? Subcategory { get; set; }
    [JsonPropertyName("colorIds")] public List<string> ColorIds { get; set; } = [];
    [JsonPropertyName("fabric")] public string? Fabric { get; set; }
    [JsonPropertyName("seasons")] public List<Season> Seasons { get; set; } = [];
    [JsonPropertyName("box")] public BoundingBox? Box { get; set; }
    [JsonPropertyName("confidence")] public double Confidence { get; set; }
    [JsonPropertyName("cropKey")] public string? CropKey { get; set; }
    // Stage B: a wardrobe item ("Gardırobunda var"); else stage C: the session's new piece this occurrence is.
    [JsonPropertyName("matchItemId")] public string? MatchItemId { get; set; }
    [JsonPropertyName("matchConfidence")] public double? MatchConfidence { get; set; }
    [JsonPropertyName("pieceId")] public string? PieceId { get; set; }
    // Stage D: the look slot (null = extra piece, saved as an item only; a look holds one piece per slot).
    [JsonPropertyName("slot")] public OutfitSlot? Slot { get; set; }
}

/// <summary>One photo of a session. Every write is versioned (Api: pending → uploaded; worker: the stages), so a duplicate
/// delivery or a second confirm never runs a stage twice.</summary>
public class OutfitImportPhotoEntity : IVersionedEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(SessionId, Index);

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("sessionId")] public string SessionId { get; set; } = null!;
    // 1-based photo number in the session.
    [JsonPropertyName("index")] public int Index { get; set; }
    [JsonPropertyName("status")] public OutfitImportPhotoStatus Status { get; set; }
    [JsonPropertyName("failure")] public JobFailure? Failure { get; set; }
    [JsonPropertyName("uploadKey")] public string UploadKey { get; set; } = null!;
    // EXIF-stripped photo (tenant prefix): the cover of the look created from it.
    [JsonPropertyName("photoKey")] public string? PhotoKey { get; set; }
    [JsonPropertyName("photoWidth")] public int? PhotoWidth { get; set; }
    [JsonPropertyName("photoHeight")] public int? PhotoHeight { get; set; }
    // Id of the look the commit creates (deterministic, so a replay never makes a second one).
    [JsonPropertyName("lookId")] public string LookId { get; set; } = null!;
    [JsonPropertyName("pieces")] public List<OutfitImportOccurrence> Pieces { get; set; } = [];
    // Rate-limit back-offs used so far (OutfitImportOptions.MaxBackoffs).
    [JsonPropertyName("backoffs")] public int Backoffs { get; set; }
    // Stage durations (ms) of the photo (detect, match, …) — diagnostics only.
    [JsonPropertyName("timings")] public Dictionary<string, long>? Timings { get; set; }
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }
    [JsonPropertyName("version")] public long Version { get; set; }

    [JsonPropertyName("ttl")] public long Ttl => CreatedAt.AddDays(OutfitImportSessionEntity.RetentionDays).ToUnixTimeSeconds();

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#outfitimportphoto";
    public static string GetSk(string sessionId, int index) => $"{sessionId}#{index:000}";
    public static string SessionPrefix(string sessionId) => $"{sessionId}#";

    /// <summary>The recognition-allowance key of the photo (IItemRecognitionQuotaService job id).</summary>
    public static string RecognitionKey(string sessionId, int index) => $"oi-{sessionId}-{index}";
}

/// <summary>
/// A piece the session found that is not in the wardrobe (stage C keeps one row per physical piece, however many photos
/// show it). Becomes a wardrobe item on commit when the user keeps it; its id is that item's id.
/// </summary>
public class OutfitImportPieceEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(SessionId, Id);

    [JsonPropertyName("id")] public string Id { get; set; } = null!;
    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("sessionId")] public string SessionId { get; set; } = null!;
    // The occurrence it was first seen as (its crop is the item's photo).
    [JsonPropertyName("firstRef")] public string FirstRef { get; set; } = null!;
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("category")] public ItemCategory Category { get; set; }
    [JsonPropertyName("subcategory")] public string? Subcategory { get; set; }
    [JsonPropertyName("colorIds")] public List<string> ColorIds { get; set; } = [];
    [JsonPropertyName("fabric")] public string? Fabric { get; set; }
    [JsonPropertyName("seasons")] public List<Season> Seasons { get; set; } = [];
    [JsonPropertyName("cropKey")] public string CropKey { get; set; } = null!;
    // Photos it was seen in.
    [JsonPropertyName("seenIn")] public List<int> SeenIn { get; set; } = [];
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }

    [JsonPropertyName("ttl")] public long Ttl => CreatedAt.AddDays(OutfitImportSessionEntity.RetentionDays).ToUnixTimeSeconds();

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#outfitimportpiece";
    public static string GetSk(string sessionId, string id) => $"{sessionId}#{id}";
    public static string SessionPrefix(string sessionId) => $"{sessionId}#";
}

public class OutfitImportLease
{
    [JsonPropertyName("holder")] public string Holder { get; set; } = null!;
    [JsonPropertyName("until")] public DateTime Until { get; set; }
}

/// <summary>
/// Fairness and ordering leases (optimistic versioning): sk "inflight" = photos of the tenant being processed right now
/// (capped by OutfitImportOptions.MaxInFlightPerTenant); sk "match#{sessionId}" = the one photo of a session in its match /
/// de-duplication step (stage B + C run one photo at a time per session, so the same new piece is never created twice).
/// An expired lease (crashed run) no longer counts.
/// </summary>
public class OutfitImportLeaseEntity : IVersionedEntity
{
    public const string InFlight = "inflight";

    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => Name;

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("name")] public string Name { get; set; } = null!;
    [JsonPropertyName("leases")] public List<OutfitImportLease> Leases { get; set; } = [];
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }
    [JsonPropertyName("version")] public long Version { get; set; }

    [JsonPropertyName("ttl")] public long Ttl => UpdatedAt.AddDays(1).ToUnixTimeSeconds();

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#outfitimportlease";
    public static string MatchLock(string sessionId) => $"match#{sessionId}";
}
