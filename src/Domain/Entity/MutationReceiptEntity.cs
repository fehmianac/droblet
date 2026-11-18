using System.Text.Json.Serialization;
using Domain.Entity.Base;
using Domain.Extensions;

namespace Domain.Entity;

public class MutationReceiptEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(ClientMutationId);

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("clientMutationId")] public string ClientMutationId { get; set; } = null!;
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }

    [JsonPropertyName("ttl")] public long Ttl => CreatedAt.AddDays(30).ToUnixTimeSeconds();

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#mutation";
    public static string GetSk(string clientMutationId) => clientMutationId;
}
