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

    /// <summary>
    /// Owner decision 2026-11-18: a non-member gets <paramref name="freeLimit"/> AI garment recognitions for the lifetime
    /// of the account; members are unlimited. <paramref name="used"/> = completed + in-flight recognitions.
    /// </summary>
    public static ItemRecognitionQuota ItemRecognition(Tier tier, int freeLimit, int used)
    {
        used = Math.Max(0, used);
        if (tier == Tier.Premium)
            return new ItemRecognitionQuota(null, used, null);
        var limit = Math.Max(0, freeLimit);
        return new ItemRecognitionQuota(limit, Math.Min(used, limit), Math.Max(0, limit - used));
    }

    /// <summary>
    /// How many of <paramref name="requested"/> photos may start AI processing. A bulk request above the remaining
    /// allowance is cut to it (the rest is reported as skipped); limit 0 = members-only (paywall); nothing left = 402.
    /// </summary>
    public static ItemRecognitionGrant GrantItemRecognition(Tier tier, int freeLimit, int used, int requested)
    {
        requested = Math.Max(0, requested);
        var quota = ItemRecognition(tier, freeLimit, used);
        if (quota.Unlimited)
            return new ItemRecognitionGrant(requested, 0, null);
        if (quota.Limit == 0)
            return new ItemRecognitionGrant(0, requested, ErrorCodes.PremiumRequired);
        if (quota.Remaining == 0)
            return new ItemRecognitionGrant(0, requested, requested == 0 ? null : ErrorCodes.ItemRecognitionLimitReached);
        var granted = Math.Min(requested, quota.Remaining!.Value);
        return new ItemRecognitionGrant(granted, requested - granted, null);
    }

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

/// <summary>AI garment recognition allowance. Limit / Remaining null = unlimited (members).</summary>
public sealed record ItemRecognitionQuota(int? Limit, int Used, int? Remaining)
{
    public bool Unlimited => Limit is null;
}

/// <param name="Granted">How many of the requested photos may be processed (the first N, in request order).</param>
/// <param name="Skipped">Requested photos beyond the remaining allowance.</param>
/// <param name="DenyReason">Set when nothing is granted: premium_required (limit 0) or item_recognition_limit_reached.</param>
public sealed record ItemRecognitionGrant(int Granted, int Skipped, string? DenyReason);

public sealed record ActiveEntitlement(Tier Tier, EntitlementEntity? Source)
{
    public static readonly ActiveEntitlement Free = new(Tier.Free, null);
}

public static class EntitlementResolver
{
    /// <summary>
    /// Active tier = highest tier among entitlements active at `now` (startsAt ≤ now &lt; expiresAt). At the same tier a
    /// store purchase wins over an admin / self-serve grant, so a real subscription is always the one reported and the one
    /// whose month the credits follow.
    /// </summary>
    public static ActiveEntitlement Resolve(IEnumerable<EntitlementEntity> entitlements, DateTime now)
    {
        var best = entitlements
            .Where(e => IsActive(e, now))
            .OrderByDescending(e => e.Tier)
            .ThenBy(e => e.Source == EntitlementSource.Store ? 0 : 1)
            .ThenByDescending(e => e.ExpiresAt ?? DateTime.MaxValue)
            .FirstOrDefault();

        return best is null ? ActiveEntitlement.Free : new ActiveEntitlement(best.Tier, best);
    }

    public static bool IsActive(EntitlementEntity e, DateTime now) => e.StartsAt <= now && (e.ExpiresAt is null || e.ExpiresAt > now);

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
