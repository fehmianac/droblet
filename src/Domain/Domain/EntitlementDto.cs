using Domain.Enum;
using Domain.Services;

namespace Domain.Domain;

public record CreditsDto(int MonthlyAllowance, int AllowanceRemaining, int PackRemaining, int TotalRemaining, DateTime? ResetsAt);

/// <summary>AI garment recognitions: limit / remaining null = unlimited (members). used = completed + in progress.</summary>
public record ItemRecognitionDto(int? Limit, int Used, int? Remaining);

public record EntitlementDto(Tier Tier, string? ProductId, StorePlatform? Platform, DateTime? ExpiresAt, CreditsDto Credits, ItemRecognitionDto ItemRecognition)
{
    /// <summary>Store state behind the tier: active | gracePeriod | billingRetry | expired | revoked (null = free / legacy row).</summary>
    public StoreSubscriptionState? State { get; init; }
    /// <summary>UUID the app passes as StoreKit appAccountToken / Play obfuscatedAccountId (StoreAccountToken).</summary>
    public string? StoreAccountToken { get; init; }
    /// <summary>Temporary self-serve premium (until store purchases are live): enabled = the switch is on, active = this account holds it. Null outside GET / self-premium.</summary>
    public SelfServePremiumDto? SelfServePremium { get; init; }
    /// <summary>"Kombinlerini içe aktar" limits of this plan (maxPhotos per session; server configuration, never hard-coded in the app).</summary>
    public OutfitImportLimitsDto? OutfitImport { get; init; }
}

public record OutfitImportLimitsDto(int MaxPhotos);

public record SelfServePremiumDto(bool Enabled, bool Active);

public static class EntitlementDtoMapper
{
    public static EntitlementDto ToDto(this EntitlementSnapshot snapshot) => new(
        snapshot.Active.Tier,
        snapshot.Active.Source?.ProductId,
        snapshot.Active.Source?.Platform,
        snapshot.Active.Source?.ExpiresAt,
        new CreditsDto(
            snapshot.Credits.MonthlyAllowance,
            snapshot.Credits.AllowanceRemaining,
            snapshot.Credits.PackRemaining,
            snapshot.Credits.TotalRemaining,
            snapshot.Credits.ResetsAt),
        (snapshot.ItemRecognition ?? EntitlementPolicy.ItemRecognition(snapshot.Active.Tier, 0, 0)).ToDto())
    {
        OutfitImport = snapshot.OutfitImportMaxPhotos is { } max ? new OutfitImportLimitsDto(max) : null,
    };

    /// <summary>The DTO for the signed-in tenant: adds the store account token the app passes to StoreKit / Play Billing.</summary>
    public static EntitlementDto ToDto(this EntitlementSnapshot snapshot, string tenantId) =>
        snapshot.ToDto() with { State = snapshot.Active.Source?.State, StoreAccountToken = Services.StoreAccountToken.FromTenantId(tenantId) };

    public static ItemRecognitionDto ToDto(this ItemRecognitionQuota quota) => new(quota.Limit, quota.Used, quota.Remaining);
}
