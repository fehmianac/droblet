using System.Text.Json.Serialization;
using Domain.Entity.Base;
using Domain.Enum;
using Domain.Extensions;

namespace Domain.Entity;

/// <summary>
/// One store purchase of the tenant (subscription chain or consumable). Key = Apple originalTransactionId (subscription)
/// / transactionId (consumable), Google = SHA-256 of the purchase token. Permanent: it is the idempotency record of a
/// consumable (credits are added once, removed once on refund) and lets restore / notifications re-read the store.
/// </summary>
public class StorePurchaseEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(Platform, Key);

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("platform")] public StorePlatform Platform { get; set; }
    [JsonPropertyName("key")] public string Key { get; set; } = null!;
    [JsonPropertyName("kind")] public StoreProductKind Kind { get; set; }
    [JsonPropertyName("productId")] public string ProductId { get; set; } = null!;
    [JsonPropertyName("transactionId")] public string? TransactionId { get; set; }
    // Google only: the purchase token (needed to re-read the purchase from the Play Developer API).
    [JsonPropertyName("purchaseToken")] public string? PurchaseToken { get; set; }
    [JsonPropertyName("environment")] public string? Environment { get; set; }
    [JsonPropertyName("credits")] public int Credits { get; set; }
    [JsonPropertyName("creditsGranted")] public bool CreditsGranted { get; set; }
    [JsonPropertyName("creditsRevoked")] public bool CreditsRevoked { get; set; }
    [JsonPropertyName("revokedAt")] public DateTime? RevokedAt { get; set; }
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#storepurchase";
    public static string GetSk(StorePlatform platform, string key) => $"{platform.ToString().ToLowerInvariant()}#{key}";
}

/// <summary>Store purchase → tenant (a store notification carries no user). First verified claim wins.</summary>
public class StorePurchaseIndexEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk();
    [JsonPropertyName("sk")] public string Sk => GetSk(Platform, Key);

    [JsonPropertyName("platform")] public StorePlatform Platform { get; set; }
    [JsonPropertyName("key")] public string Key { get; set; } = null!;
    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }
    // Last time the subscription moved to another Droblet account (restore on the device that holds it).
    [JsonPropertyName("transferredAt")] public DateTime? TransferredAt { get; set; }

    public static string GetPk() => "storepurchase";
    public static string GetSk(StorePlatform platform, string key) => $"{platform.ToString().ToLowerInvariant()}#{key}";
}

/// <summary>Processed store notification (Apple notificationUUID / Pub/Sub messageId): a redelivery is a no-op.</summary>
public class StoreNotificationReceiptEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk();
    [JsonPropertyName("sk")] public string Sk => GetSk(Platform, NotificationId);

    [JsonPropertyName("platform")] public StorePlatform Platform { get; set; }
    [JsonPropertyName("notificationId")] public string NotificationId { get; set; } = null!;
    [JsonPropertyName("kind")] public string? Kind { get; set; }
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }

    [JsonPropertyName("ttl")] public long Ttl => CreatedAt.AddDays(90).ToUnixTimeSeconds();

    public static string GetPk() => "storenotification";
    public static string GetSk(StorePlatform platform, string id) => $"{platform.ToString().ToLowerInvariant()}#{id}";
}
