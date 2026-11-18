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
    [JsonPropertyName("productIds")] public List<string> ProductIds { get; set; } = [];
    [JsonPropertyName("lookKind")] public LookRefKind? LookKind { get; set; }
    [JsonPropertyName("lookId")] public string? LookId { get; set; }
    [JsonPropertyName("source")] public AffiliateSource Source { get; set; }
    [JsonPropertyName("network")] public string? Network { get; set; }
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#affiliateclick";
    public static string GetSk(string clickId) => clickId;
}

// Global pointer click_id -> tenant so a postback (network or brand) can be matched to the user + look.
// Carries everything the postback needs; account deletion clears TenantId (revenue stays, the person does not).
public class AffiliateClickIndexEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(ClickId);
    [JsonPropertyName("sk")] public string Sk => GetSk();

    [JsonPropertyName("clickId")] public string ClickId { get; set; } = null!;
    [JsonPropertyName("tenantId")] public string? TenantId { get; set; }
    [JsonPropertyName("brandId")] public string? BrandId { get; set; }
    [JsonPropertyName("productIds")] public List<string> ProductIds { get; set; } = [];
    [JsonPropertyName("lookKind")] public LookRefKind? LookKind { get; set; }
    [JsonPropertyName("lookId")] public string? LookId { get; set; }
    [JsonPropertyName("source")] public AffiliateSource Source { get; set; }
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }

    public static string GetPk(string clickId) => $"affiliateclick#{clickId}";
    public static string GetSk() => "index";
}

public class AffiliateConversionEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(Source, ExternalId);

    [JsonPropertyName("id")] public string? Id { get; set; }
    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("source")] public AffiliateSource Source { get; set; }
    [JsonPropertyName("externalId")] public string ExternalId { get; set; } = null!;   // network/brand order reference
    [JsonPropertyName("clickId")] public string ClickId { get; set; } = null!;
    [JsonPropertyName("brandId")] public string BrandId { get; set; } = null!;
    [JsonPropertyName("productIds")] public List<string> ProductIds { get; set; } = [];
    [JsonPropertyName("lookKind")] public LookRefKind? LookKind { get; set; }
    [JsonPropertyName("lookId")] public string? LookId { get; set; }
    [JsonPropertyName("amountMinor")] public long AmountMinor { get; set; }              // kuruş
    [JsonPropertyName("currency")] public string Currency { get; set; } = "TRY";
    [JsonPropertyName("commissionMinor")] public long CommissionMinor { get; set; }
    [JsonPropertyName("status")] public AffiliateConversionStatus Status { get; set; }
    /// <summary>Brief §5.5: "Gardıroba ekleyelim mi?" for the purchased pieces.</summary>
    [JsonPropertyName("wardrobePrompt")] public WardrobePromptStatus WardrobePrompt { get; set; }
    [JsonPropertyName("receivedAt")] public DateTime ReceivedAt { get; set; }
    [JsonPropertyName("updatedAt")] public DateTime? UpdatedAt { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#affiliateconversion";
    public static string GetSk(AffiliateSource source, string externalId) => $"{source.ToString().ToLowerInvariant()}#{externalId}";
}

/// <summary>Global idempotency record of a postback: one per (source, order reference).</summary>
public class AffiliateConversionIndexEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(Source, ExternalId);
    [JsonPropertyName("sk")] public string Sk => GetSk();

    [JsonPropertyName("source")] public AffiliateSource Source { get; set; }
    [JsonPropertyName("externalId")] public string ExternalId { get; set; } = null!;
    [JsonPropertyName("ledgerMonth")] public string LedgerMonth { get; set; } = null!;
    [JsonPropertyName("receivedAt")] public DateTime ReceivedAt { get; set; }

    public static string GetPk(AffiliateSource source, string externalId) => $"affiliateconversion#{source.ToString().ToLowerInvariant()}#{externalId}";
    public static string GetSk() => "index";
}

/// <summary>
/// Global revenue ledger (basis of the GMV / commission report). Survives account deletion: deletion clears TenantId.
/// </summary>
public class AffiliateConversionLedgerEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(Month);
    [JsonPropertyName("sk")] public string Sk => GetSk(Source, ExternalId);

    /// <summary>yyyy-MM of ReceivedAt (UTC).</summary>
    [JsonPropertyName("month")] public string Month { get; set; } = null!;
    [JsonPropertyName("source")] public AffiliateSource Source { get; set; }
    [JsonPropertyName("externalId")] public string ExternalId { get; set; } = null!;
    [JsonPropertyName("clickId")] public string ClickId { get; set; } = null!;
    [JsonPropertyName("brandId")] public string BrandId { get; set; } = null!;
    [JsonPropertyName("tenantId")] public string? TenantId { get; set; }
    [JsonPropertyName("productIds")] public List<string> ProductIds { get; set; } = [];
    [JsonPropertyName("lookKind")] public LookRefKind? LookKind { get; set; }
    [JsonPropertyName("lookId")] public string? LookId { get; set; }
    [JsonPropertyName("amountMinor")] public long AmountMinor { get; set; }
    [JsonPropertyName("currency")] public string Currency { get; set; } = "TRY";
    [JsonPropertyName("commissionRateBps")] public int CommissionRateBps { get; set; }
    [JsonPropertyName("commissionMinor")] public long CommissionMinor { get; set; }
    [JsonPropertyName("status")] public AffiliateConversionStatus Status { get; set; }
    [JsonPropertyName("receivedAt")] public DateTime ReceivedAt { get; set; }
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }

    public static string GetPk(string month) => $"affiliateledger#{month}";
    public static string GetSk(AffiliateSource source, string externalId) => $"{source.ToString().ToLowerInvariant()}#{externalId}";
}
