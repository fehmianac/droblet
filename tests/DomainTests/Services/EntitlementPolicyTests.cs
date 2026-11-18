using Domain.Constant;
using Domain.Entity;
using Domain.Enum;
using Domain.Services;

namespace DomainTests.Services;

public class EntitlementPolicyTests
{
    private static readonly CreditBalance Plenty = new(30, 12, 0, DateTime.UtcNow.AddDays(10));
    private static readonly CreditBalance Empty = new(30, 0, 0, DateTime.UtcNow.AddDays(10));

    // Expected matrix (README §9.1): AI features need membership; wardrobe-related stay open (A-1 for limits).
    public static TheoryData<Tier, Capability, bool> Matrix => new()
    {
        { Tier.Free, Capability.TryOn, false },
        { Tier.Free, Capability.DailyStylist, false },
        { Tier.Free, Capability.SmartSuitcase, false },
        { Tier.Free, Capability.PaletteAnalysis, false },
        { Tier.Free, Capability.CompleteLook, true },
        { Tier.Free, Capability.ItemProcessing, true },
        { Tier.Free, Capability.WardrobeItem, true },
        { Tier.Premium, Capability.TryOn, true },
        { Tier.Premium, Capability.DailyStylist, true },
        { Tier.Premium, Capability.SmartSuitcase, true },
        { Tier.Premium, Capability.PaletteAnalysis, true },
        { Tier.Premium, Capability.CompleteLook, true },
        { Tier.Premium, Capability.ItemProcessing, true },
        { Tier.Premium, Capability.WardrobeItem, true },
    };

    [Theory]
    [MemberData(nameof(Matrix))]
    public void EntitlementPolicy_Matrix_EveryCell(Tier tier, Capability capability, bool allowed)
    {
        var decision = EntitlementPolicy.Check(tier, capability, Plenty);

        Assert.Equal(allowed, decision.Allowed);
        if (!allowed)
            Assert.Equal(ErrorCodes.PremiumRequired, decision.Reason);
    }

    [Fact]
    public void EntitlementPolicy_MatrixCoversEveryCapability()
    {
        var covered = Matrix.Select(row => (Capability)row[1]).Distinct().Count();
        Assert.Equal(System.Enum.GetValues<Capability>().Length, covered);
    }

    [Fact]
    public void EntitlementPolicy_WhenPremiumOutOfCredits_TryOnDeniedWithCreditsExhausted()
    {
        var decision = EntitlementPolicy.Check(Tier.Premium, Capability.TryOn, Empty);

        Assert.False(decision.Allowed);
        Assert.Equal(ErrorCodes.CreditsExhausted, decision.Reason);
    }

    [Fact]
    public void EntitlementPolicy_WhenPremiumOutOfCredits_TextStylistStillAllowed()
    {
        Assert.True(EntitlementPolicy.Check(Tier.Premium, Capability.DailyStylist, Empty).Allowed);
    }

    [Fact]
    public void EntitlementPolicy_WhenOnlyPackCreditsLeft_TryOnAllowed()
    {
        var decision = EntitlementPolicy.Check(Tier.Premium, Capability.TryOn, new CreditBalance(30, 0, 3, null));

        Assert.True(decision.Allowed);
        Assert.Equal(1, decision.CreditCost);
    }

    [Fact]
    public void EntitlementPolicy_WhenCreditsUnknown_TryOnDenied()
    {
        Assert.False(EntitlementPolicy.Check(Tier.Premium, Capability.TryOn, null).Allowed);
    }

    [Theory]
    [InlineData(Capability.TryOn, 1)]
    [InlineData(Capability.DailyStylist, 0)]
    [InlineData(Capability.SmartSuitcase, 0)]
    [InlineData(Capability.PaletteAnalysis, 0)]
    [InlineData(Capability.CompleteLook, 0)]
    public void EntitlementPolicy_CreditCost_OnlyTryOnCosts(Capability capability, int cost)
    {
        Assert.Equal(cost, EntitlementPolicy.CreditCost(capability));
    }
}

public class EntitlementResolverTests
{
    private static readonly DateTime Now = new(2026, 11, 18, 12, 0, 0, DateTimeKind.Utc);

    private static EntitlementEntity Premium(DateTime starts, DateTime? expires) => new()
    {
        Id = Guid.NewGuid().ToString(),
        TenantId = "t1",
        Tier = Tier.Premium,
        Source = EntitlementSource.Store,
        StartsAt = starts,
        ExpiresAt = expires,
        PeriodAnchor = starts,
    };

    [Fact]
    public void Resolve_WhenNoRecords_IsFree()
    {
        Assert.Equal(Tier.Free, EntitlementResolver.Resolve([], Now).Tier);
    }

    [Fact]
    public void Resolve_WhenActivePremium_IsPremium()
    {
        Assert.Equal(Tier.Premium, EntitlementResolver.Resolve([Premium(Now.AddDays(-40), Now.AddDays(5))], Now).Tier);
    }

    [Fact]
    public void Resolve_WhenPremiumExpired_IsFree_DataUntouched()
    {
        var expired = Premium(Now.AddDays(-40), Now.AddDays(-1));

        Assert.Equal(Tier.Free, EntitlementResolver.Resolve([expired], Now).Tier);
    }

    [Fact]
    public void CreditContextFor_WhenPremium_UsesSubscriptionMonthFromAnchor()
    {
        var active = EntitlementResolver.Resolve([Premium(new DateTime(2026, 9, 3, 0, 0, 0, DateTimeKind.Utc), Now.AddYears(1))], Now);

        var context = EntitlementResolver.CreditContextFor(active, Now, 30);

        Assert.Equal(new DateTime(2026, 11, 3, 0, 0, 0, DateTimeKind.Utc), context.PeriodStart);
        Assert.Equal(new DateTime(2026, 12, 3, 0, 0, 0, DateTimeKind.Utc), context.PeriodEnd);
        Assert.Equal(30, context.MonthlyAllowance);
    }

    [Fact]
    public void CreditContextFor_WhenSubscriptionEndsMidMonth_ResetDateIsExpiry()
    {
        var expires = Now.AddDays(2);
        var active = EntitlementResolver.Resolve([Premium(new DateTime(2026, 9, 3, 0, 0, 0, DateTimeKind.Utc), expires)], Now);

        Assert.Equal(expires, EntitlementResolver.CreditContextFor(active, Now, 30).PeriodEnd);
    }

    [Fact]
    public void CreditContextFor_WhenFree_NoAllowance()
    {
        Assert.False(EntitlementResolver.CreditContextFor(ActiveEntitlement.Free, Now, 30).HasAllowance);
    }
}

public class ItemRecognitionPolicyTests
{
    [Theory]
    [InlineData(10, 0, 10, 0, 10)]
    [InlineData(10, 4, 10, 4, 6)]
    [InlineData(10, 10, 10, 10, 0)]
    [InlineData(10, 13, 10, 10, 0)]   // limit lowered after use: never negative, used capped at the limit
    [InlineData(0, 0, 0, 0, 0)]
    [InlineData(-5, 0, 0, 0, 0)]
    public void NonMember_HasALifetimeAllowance(int limit, int used, int expectedLimit, int expectedUsed, int expectedRemaining)
    {
        var quota = EntitlementPolicy.ItemRecognition(Tier.Free, limit, used);

        Assert.Equal((expectedLimit, expectedUsed, expectedRemaining), (quota.Limit, quota.Used, quota.Remaining));
        Assert.False(quota.Unlimited);
    }

    [Fact]
    public void Member_IsUnlimited()
    {
        var quota = EntitlementPolicy.ItemRecognition(Tier.Premium, 10, 250);

        Assert.True(quota.Unlimited);
        Assert.Equal((null, 250, null), (quota.Limit, quota.Used, quota.Remaining));
        Assert.Equal(new ItemRecognitionGrant(30, 0, null), EntitlementPolicy.GrantItemRecognition(Tier.Premium, 0, 999, 30));
    }

    [Theory]
    [InlineData(10, 0, 1, 1, 0, null)]
    [InlineData(10, 9, 1, 1, 0, null)]                                        // the last one
    [InlineData(10, 7, 30, 3, 27, null)]                                      // bulk: up to what is left, the rest skipped
    [InlineData(10, 10, 1, 0, 1, ErrorCodes.ItemRecognitionLimitReached)]     // 402
    [InlineData(10, 10, 5, 0, 5, ErrorCodes.ItemRecognitionLimitReached)]
    [InlineData(0, 0, 1, 0, 1, ErrorCodes.PremiumRequired)]                   // limit 0 = members only → paywall
    [InlineData(10, 10, 0, 0, 0, null)]                                       // nothing requested, nothing refused
    public void Grant_ForANonMember(int limit, int used, int requested, int granted, int skipped, string? reason) =>
        Assert.Equal(new ItemRecognitionGrant(granted, skipped, reason), EntitlementPolicy.GrantItemRecognition(Tier.Free, limit, used, requested));
}
