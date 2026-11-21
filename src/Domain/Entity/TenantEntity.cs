using System.Text.Json.Serialization;
using Domain.Entity.Base;
using Domain.Enum;

namespace Domain.Entity;

// Profile / settings of the personal tenant (user = tenant in Droblet).
public class TenantEntity : IVersionedEntity, IModeratedEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk();
    [JsonPropertyName("sk")] public string Sk => GetSk(Id);

    [JsonPropertyName("id")] public string Id { get; set; } = null!;
    [JsonPropertyName("ownerUserId")] public string OwnerUserId { get; set; } = null!;
    [JsonPropertyName("displayName")] public string? DisplayName { get; set; }
    [JsonPropertyName("handle")] public string? Handle { get; set; }
    [JsonPropertyName("closetVisibility")] public ClosetVisibility ClosetVisibility { get; set; }
    [JsonPropertyName("segment")] public Segment? Segment { get; set; }
    // Mirror of the user's age band (social reads load only the tenant). Teen = invisible to others (docs/api/teen.md §4).
    [JsonPropertyName("ageBand")] public AgeBand? AgeBand { get; set; }
    [JsonPropertyName("language")] public string Language { get; set; } = "tr";
    [JsonPropertyName("cityId")] public string? CityId { get; set; }

    // Moderation (report resolved as contentRemoved): hidden from everyone but the owner. Written only by the moderation
    // service; owner edits load and save the whole row, so they keep these fields.
    [JsonPropertyName("moderationHiddenAt")] public DateTime? ModerationHiddenAt { get; set; }
    [JsonPropertyName("moderationReportId")] public string? ModerationReportId { get; set; }
    [JsonPropertyName("moderationReason")] public ReportReason? ModerationReason { get; set; }
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }
    [JsonPropertyName("version")] public long Version { get; set; }

    /// <summary>A teen account (or a stored segment teen from before the age band existed): the social rules hide it.</summary>
    [JsonIgnore] public bool IsTeen => AgeBand == Enum.AgeBand.Teen || Segment == Enum.Segment.Teen;

    public static string GetPk() => "tenant";
    public static string GetSk(string tenantId) => tenantId;
}
