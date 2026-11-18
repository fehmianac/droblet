using Domain.Constant;
using Domain.Entity;
using Domain.Enum;

namespace Domain.Services;

public sealed record EntitlementDecision(bool Allowed, string? Reason, int CreditCost)
{
    public static EntitlementDecision Allow(int creditCost = 0) => new(true, null, creditCost);
    public static EntitlementDecision Deny(string reason) => new(false, reason, 0);
}

/// <summary>
/// Capability -> tier matrix. The only place a tier decision is made (no `if (tier == Premium)` elsewhere).
/// README §9.1: non-members get the paywall on any AI feature; wardrobe, looks, calendar, shop, social are free.
/// Premium: 30 try-on images / subscription month (credits), text stylist, smart suitcase, palette.
/// Subscription end never deletes data — only new jobs are gated.
/// </summary>
public static class EntitlementPolicy
{
    private static readonly HashSet<Capability> PremiumOnly =
    [
        Capability.TryOn,
        Capability.DailyStylist,
        Capability.SmartSuitcase,
        Capability.PaletteAnalysis,
    ];

    public static int CreditCost(Capability capability) => capability == Capability.TryOn ? 1 : 0;

    public static bool RequiresPremium(Capability capability) => PremiumOnly.Contains(capability);

    /// <param name="credits">Current balance; required for credit-consuming capabilities.</param>
    public static EntitlementDecision Check(Tier tier, Capability capability, CreditBalance? credits)
    {
        if (RequiresPremium(capability) && tier != Tier.Premium)
            return EntitlementDecision.Deny(ErrorCodes.PremiumRequired);

        var cost = CreditCost(capability);
        if (cost == 0)
            return EntitlementDecision.Allow();

        if (credits is null || credits.TotalRemaining < cost)
            return EntitlementDecision.Deny(ErrorCodes.CreditsExhausted);

        return EntitlementDecision.Allow(cost);
    }
}

public sealed record ActiveEntitlement(Tier Tier, EntitlementEntity? Source)
{
    public static readonly ActiveEntitlement Free = new(Tier.Free, null);
}

public static class EntitlementResolver
{
    /// <summary>Active tier = highest tier among entitlements active at `now` (startsAt ≤ now &lt; expiresAt).</summary>
    public static ActiveEntitlement Resolve(IEnumerable<EntitlementEntity> entitlements, DateTime now)
    {
        var best = entitlements
            .Where(e => e.StartsAt <= now && (e.ExpiresAt is null || e.ExpiresAt > now))
            .OrderByDescending(e => e.Tier)
            .ThenByDescending(e => e.ExpiresAt ?? DateTime.MaxValue)
            .FirstOrDefault();

        return best is null ? ActiveEntitlement.Free : new ActiveEntitlement(best.Tier, best);
    }

    public static CreditContext CreditContextFor(ActiveEntitlement active, DateTime now, int monthlyAllowance)
    {
        if (active.Tier != Tier.Premium || active.Source is null || monthlyAllowance <= 0)
            return CreditContext.NoAllowance;

        var (start, end) = CreditPeriod.Containing(active.Source.PeriodAnchor, now);
        // A month window never outlives the subscription itself.
        if (active.Source.ExpiresAt is { } expires && expires < end)
            end = expires;
        return new CreditContext(start, end, monthlyAllowance);
    }
}
