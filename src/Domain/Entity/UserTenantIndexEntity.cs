using System.Text.Json.Serialization;
using Domain.Entity.Base;

namespace Domain.Entity;

public class UserTenantIndexEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(UserId);
    [JsonPropertyName("sk")] public string Sk => GetSk(TenantId);

    [JsonPropertyName("userId")] public string UserId { get; set; } = null!;
    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }

    public static string GetPk(string userId) => $"user#{userId}#tenant";
    public static string GetSk(string tenantId) => tenantId;
}
