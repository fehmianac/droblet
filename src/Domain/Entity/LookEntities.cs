using System.Text.Json.Serialization;
using Domain.Entity.Base;
using Domain.Enum;
using Domain.Extensions;

namespace Domain.Entity;

/// <summary>One filled slot: exactly one of itemId (own wardrobe) or productId (catalog = missing piece).</summary>
public class LookSlotValue
{
    [JsonPropertyName("slot")] public OutfitSlot Slot { get; set; }
    [JsonPropertyName("itemId")] public string? ItemId { get; set; }
    [JsonPropertyName("productId")] public string? ProductId { get; set; }
}

/// <summary>A piece the wardrobe lacks, expressed as a catalog slot placeholder (productId filled once the catalog matches one).</summary>
public class MissingPieceValue
{
    [JsonPropertyName("slot")] public OutfitSlot Slot { get; set; }
    [JsonPropertyName("category")] public ItemCategory? Category { get; set; }
    [JsonPropertyName("reason")] public MissingPieceReason Reason { get; set; }
    [JsonPropertyName("productId")] public string? ProductId { get; set; }
    // A ready-library piece picked to fill a thin wardrobe (owner decision 3); the app offers "Gardıroba ekle".
    [JsonPropertyName("libraryItemId")] public string? LibraryItemId { get; set; }
}

public class LookEntity : IVersionedEntity, IModeratedEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(Id);

    [JsonPropertyName("id")] public string Id { get; set; } = null!;   // ULID, client generated — time sortable for feeds
    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("occasion")] public Occasion? Occasion { get; set; }
    [JsonPropertyName("slots")] public List<LookSlotValue> Slots { get; set; } = [];
    [JsonPropertyName("favorite")] public bool Favorite { get; set; }
    [JsonPropertyName("source")] public LookSource Source { get; set; }
    // Imported look ("Kombinlerini içe aktar"): the EXIF-stripped outfit photo under the tenant prefix. Never client supplied.
    [JsonPropertyName("coverImageKey")] public string? CoverImageKey { get; set; }

    // Moderation (report resolved as contentRemoved): hidden from everyone but the owner. Written only by the moderation
    // service; owner edits load and save the whole row, so they keep these fields.
    [JsonPropertyName("moderationHiddenAt")] public DateTime? ModerationHiddenAt { get; set; }
    [JsonPropertyName("moderationReportId")] public string? ModerationReportId { get; set; }
    [JsonPropertyName("moderationReason")] public ReportReason? ModerationReason { get; set; }
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }
    [JsonPropertyName("version")] public long Version { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#look";
    public static string GetSk(string id) => id;
}

// Calendar day (the user's local day, no time). Never visible to another tenant.
public class PlanDayEntity : IVersionedEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(Date);

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("date")] public string Date { get; set; } = null!;   // yyyy-MM-dd
    [JsonPropertyName("occasion")] public Occasion? Occasion { get; set; }
    [JsonPropertyName("lookId")] public string? LookId { get; set; }
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }
    [JsonPropertyName("version")] public long Version { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#planday";
    public static string GetSk(string date) => date;
}

// "Bunu giyiyorum". No TTL: calendar and statistics history. Item wear counts are derived from these events.
public class WearLogEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(Date, Id);

    [JsonPropertyName("id")] public string Id { get; set; } = null!;
    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("date")] public string Date { get; set; } = null!;   // yyyy-MM-dd
    [JsonPropertyName("lookId")] public string? LookId { get; set; }
    [JsonPropertyName("itemIds")] public List<string> ItemIds { get; set; } = [];
    [JsonPropertyName("occurredAt")] public DateTime OccurredAt { get; set; }   // device time, UTC
    [JsonPropertyName("clientMutationId")] public string ClientMutationId { get; set; } = null!;
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#wearlog";
    public static string GetSk(string date, string id) => $"{date}#{id}";
    public static string DatePrefix(string date) => $"{date}#";
}

public class TripEntity : IVersionedEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(Id);

    [JsonPropertyName("id")] public string Id { get; set; } = null!;
    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("cityId")] public string CityId { get; set; } = null!;
    [JsonPropertyName("cityName")] public string? CityName { get; set; }
    [JsonPropertyName("startDate")] public string StartDate { get; set; } = null!;   // yyyy-MM-dd
    [JsonPropertyName("endDate")] public string EndDate { get; set; } = null!;
    [JsonPropertyName("tripTypes")] public List<TripType> TripTypes { get; set; } = [];
    [JsonPropertyName("cabinOnly")] public bool CabinOnly { get; set; }
    [JsonPropertyName("archivedAt")] public DateTime? ArchivedAt { get; set; }
    // Set by the pack accept endpoint.
    [JsonPropertyName("packJobId")] public string? PackJobId { get; set; }
    [JsonPropertyName("everyPieceWornTwice")] public bool EveryPieceWornTwice { get; set; }
    [JsonPropertyName("missing")] public List<MissingPieceValue> Missing { get; set; } = [];
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }
    [JsonPropertyName("version")] public long Version { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#trip";
    public static string GetSk(string id) => id;
}

// Packing checklist row. One partition per tenant (sk prefixed by trip) so account deletion needs no trip listing.
public class TripItemEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(TripId, ItemId);

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("tripId")] public string TripId { get; set; } = null!;
    [JsonPropertyName("itemId")] public string ItemId { get; set; } = null!;
    [JsonPropertyName("plannedWears")] public int PlannedWears { get; set; }
    [JsonPropertyName("packed")] public bool Packed { get; set; }
    [JsonPropertyName("packedAt")] public DateTime? PackedAt { get; set; }   // device time of the last mark

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#tripitem";
    public static string GetSk(string tripId, string itemId) => $"{tripId}#{itemId}";
    public static string TripPrefix(string tripId) => $"{tripId}#";
}

public class TripDayEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(TripId, Date);

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("tripId")] public string TripId { get; set; } = null!;
    [JsonPropertyName("date")] public string Date { get; set; } = null!;
    [JsonPropertyName("label")] public string? Label { get; set; }
    [JsonPropertyName("occasion")] public Occasion? Occasion { get; set; }
    [JsonPropertyName("slots")] public List<LookSlotValue> Slots { get; set; } = [];

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#tripday";
    public static string GetSk(string tripId, string date) => $"{tripId}#{date}";
    public static string TripPrefix(string tripId) => $"{tripId}#";
}

// "Beğenmedim" (screen 17). Only ids + a reason; feeds the next stylist prompt as "avoid these combinations".
public class StylistFeedbackEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(JobId, Index);

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("jobId")] public string JobId { get; set; } = null!;
    [JsonPropertyName("index")] public int Index { get; set; }
    [JsonPropertyName("reason")] public DislikeReason Reason { get; set; }
    [JsonPropertyName("itemIds")] public List<string> ItemIds { get; set; } = [];
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }

    [JsonPropertyName("ttl")] public long Ttl => CreatedAt.AddDays(400).ToUnixTimeSeconds();

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#stylistfeedback";
    public static string GetSk(string jobId, int index) => $"{jobId}#{index}";
}
