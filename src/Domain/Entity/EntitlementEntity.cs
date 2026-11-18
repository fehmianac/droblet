using System.Text.Json.Serialization;
using Domain.Entity.Base;
using Domain.Enum;

namespace Domain.Entity;

public class EntitlementEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(Source, Id);

    [JsonPropertyName("id")] public string Id { get; set; } = null!;          // originalTransactionId / purchaseToken hash
    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("tier")] public Tier Tier { get; set; }
    [JsonPropertyName("source")] public EntitlementSource Source { get; set; }
    [JsonPropertyName("platform")] public StorePlatform? Platform { get; set; }
    [JsonPropertyName("productId")] public string? ProductId { get; set; }
    [JsonPropertyName("startsAt")] public DateTime StartsAt { get; set; }
    [JsonPropertyName("expiresAt")] public DateTime? ExpiresAt { get; set; }
    // Anchor of the monthly credit window ("subscription month"): original purchase instant.
    [JsonPropertyName("periodAnchor")] public DateTime PeriodAnchor { get; set; }
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }
    // Store state behind ExpiresAt (grace period, billing retry, refund…); null on rows written before E10.
    [JsonPropertyName("state")] public StoreSubscriptionState? State { get; set; }
    [JsonPropertyName("environment")] public string? Environment { get; set; }
    // Store time of the newest event applied (signedDate / eventTime): an older, late notification never rolls state back.
    [JsonPropertyName("lastEventAt")] public DateTime? LastEventAt { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#entitlement";
    public static string GetSk(EntitlementSource source, string id) => $"{source.ToString().ToLowerInvariant()}#{id}";
}
