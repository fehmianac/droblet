using System.Text.Json.Serialization;
using Domain.Entity.Base;
using Domain.Enum;

namespace Domain.Entity;

// Profile / settings of the personal tenant (user = tenant in Droblet).
public class TenantEntity : IVersionedEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk();
    [JsonPropertyName("sk")] public string Sk => GetSk(Id);

    [JsonPropertyName("id")] public string Id { get; set; } = null!;
    [JsonPropertyName("ownerUserId")] public string OwnerUserId { get; set; } = null!;
    [JsonPropertyName("displayName")] public string? DisplayName { get; set; }
    [JsonPropertyName("handle")] public string? Handle { get; set; }
    [JsonPropertyName("closetVisibility")] public ClosetVisibility ClosetVisibility { get; set; }
    [JsonPropertyName("segment")] public Segment? Segment { get; set; }
    [JsonPropertyName("language")] public string Language { get; set; } = "tr";
    [JsonPropertyName("cityId")] public string? CityId { get; set; }
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }
    [JsonPropertyName("version")] public long Version { get; set; }

    public static string GetPk() => "tenant";
    public static string GetSk(string tenantId) => tenantId;
}
