using System.Text.Json.Serialization;
using Domain.Entity.Base;
using Domain.Enum;

namespace Domain.Entity;

// Owner decision 2026-11-18: affiliate network AND direct brand deals. Every outbound click carries click_id.
public class AffiliateClickEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(ClickId);

    [JsonPropertyName("clickId")] public string ClickId { get; set; } = null!;
    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("brandId")] public string BrandId { get; set; } = null!;
    [JsonPropertyName("productId")] public string? ProductId { get; set; }
    [JsonPropertyName("lookId")] public string? LookId { get; set; }
    [JsonPropertyName("source")] public AffiliateSource Source { get; set; }
    [JsonPropertyName("network")] public string? Network { get; set; }
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#affiliateclick";
    public static string GetSk(string clickId) => clickId;
}

// Global pointer click_id -> tenant so a postback (network or brand) can be matched to the user + look.
public class AffiliateClickIndexEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(ClickId);
    [JsonPropertyName("sk")] public string Sk => GetSk();

    [JsonPropertyName("clickId")] public string ClickId { get; set; } = null!;
    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;

    public static string GetPk(string clickId) => $"affiliateclick#{clickId}";
    public static string GetSk() => "index";
}

public class AffiliateConversionEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(Source, ExternalId);

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("source")] public AffiliateSource Source { get; set; }
    [JsonPropertyName("externalId")] public string ExternalId { get; set; } = null!;   // network/brand order reference
    [JsonPropertyName("clickId")] public string ClickId { get; set; } = null!;
    [JsonPropertyName("brandId")] public string BrandId { get; set; } = null!;
    [JsonPropertyName("lookId")] public string? LookId { get; set; }
    [JsonPropertyName("amountMinor")] public long AmountMinor { get; set; }              // kuruş
    [JsonPropertyName("currency")] public string Currency { get; set; } = "TRY";
    [JsonPropertyName("commissionMinor")] public long CommissionMinor { get; set; }
    [JsonPropertyName("status")] public AffiliateConversionStatus Status { get; set; }
    [JsonPropertyName("receivedAt")] public DateTime ReceivedAt { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#affiliateconversion";
    public static string GetSk(AffiliateSource source, string externalId) => $"{source.ToString().ToLowerInvariant()}#{externalId}";
}
