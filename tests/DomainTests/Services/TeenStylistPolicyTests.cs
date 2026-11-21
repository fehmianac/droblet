using Domain.Constant;
using Domain.Entity;
using Domain.Enum;
using Domain.Options;
using Domain.Services;

namespace DomainTests.Services;

/// <summary>Teen:Stylist — the free-tier teen stylist allowance (owner decision 2026-11-21).</summary>
public class TeenStylistPolicyTests
{
    // Saturday 2026-11-21 12:00 Istanbul (09:00 UTC).
    private static readonly DateTime Now = new(2026, 11, 21, 9, 0, 0, DateTimeKind.Utc);
    private static readonly CreditBalance NoCredits = new(0, 0, 0, null);

    private static TeenStylistQuota Quota(int outfits = 0, int weekPlans = 0, TeenStylistOptions? options = null) =>
        TeenStylistQuota.Of(new TeenStylistUsageEntity
        {
            TenantId = "t", Day = "2026-11-21", OutfitsUsed = outfits, Week = "2026-11-16", WeekPlansUsed = weekPlans,
        }, options ?? new TeenStylistOptions(), Now);

    [Fact]
    public void Defaults_AreOn_ThreeOutfitsADay_OneWeekPlan_NoPacking()
    {
        var o = new TeenStylistOptions();
        Assert.Equal((true, 3, 1, 0), (o.Enabled, o.DailyLimit, o.WeekPlanPerWeek, o.TripPackPerWeek));
        Assert.Equal(new TeenOptions().Stylist.DailyLimit, o.DailyLimit);
    }

    [Fact]
    public void ApprovedTeen_WithAllowanceLeft_IsAllowed_ThroughTheAllowance()
    {
        var decision = EntitlementPolicy.CheckTeenStylist(Tier.Free, TeenStylistKind.Outfit, NoCredits, consentActive: true, Quota(outfits: 2));
        Assert.True(decision.Allowed);
        Assert.True(decision.UsesTeenAllowance);
        Assert.Equal(0, decision.CreditCost);
    }

    [Fact]
    public void OverTheDailyLimit_IsTheDistinctError_WithTheNextIstanbulMidnight()
    {
        var decision = EntitlementPolicy.CheckTeenStylist(Tier.Free, TeenStylistKind.Outfit, NoCredits, true, Quota(outfits: 3));
        Assert.False(decision.Allowed);
        Assert.Equal(ErrorCodes.TeenStylistDailyLimit, decision.Reason);
        Assert.Equal(new DateTime(2026, 11, 21, 21, 0, 0, DateTimeKind.Utc), decision.ResetsAt);   // 00:00 Istanbul
    }

    [Fact]
    public void WeekPlan_OverItsWeeklyLimit_ResetsOnMonday()
    {
        var decision = EntitlementPolicy.CheckTeenStylist(Tier.Free, TeenStylistKind.WeekPlan, NoCredits, true, Quota(weekPlans: 1));
        Assert.Equal(ErrorCodes.TeenStylistWeeklyLimit, decision.Reason);
        Assert.Equal(new DateTime(2026, 11, 22, 21, 0, 0, DateTimeKind.Utc), decision.ResetsAt);   // Monday 23 Nov 00:00 Istanbul
        // Outfits do not use the week plan allowance.
        Assert.True(EntitlementPolicy.CheckTeenStylist(Tier.Free, TeenStylistKind.Outfit, NoCredits, true, Quota(weekPlans: 1)).Allowed);
    }

    [Fact]
    public void PendingConsent_StaysParentalConsentRequired()
    {
        var decision = EntitlementPolicy.CheckTeenStylist(Tier.Free, TeenStylistKind.Outfit, NoCredits, consentActive: false, Quota());
        Assert.Equal(ErrorCodes.ParentalConsentRequired, decision.Reason);
        Assert.Null(decision.ResetsAt);
    }

    [Theory]
    [InlineData(false, 3, TeenStylistKind.Outfit)]       // switched off
    [InlineData(true, 0, TeenStylistKind.Outfit)]        // 0 = off
    [InlineData(true, 3, TeenStylistKind.TripPack)]      // packing 0 by default
    public void Disabled_OrZero_IsUnavailable(bool enabled, int daily, TeenStylistKind kind)
    {
        var options = new TeenStylistOptions { Enabled = enabled, DailyLimit = daily };
        var decision = EntitlementPolicy.CheckTeenStylist(Tier.Free, kind, NoCredits, true, Quota(options: options));
        Assert.Equal(ErrorCodes.TeenStylistUnavailable, decision.Reason);
        Assert.Null(decision.ResetsAt);
    }

    [Fact]
    public void PremiumTeen_IsTheNormalCheck_NotTheAllowance()
    {
        var decision = EntitlementPolicy.CheckTeenStylist(Tier.Premium, TeenStylistKind.TripPack, NoCredits, false, Quota(outfits: 9));
        Assert.True(decision.Allowed);
        Assert.False(decision.UsesTeenAllowance);
    }

    [Fact]
    public void Adults_AreUnchanged_FreeGetsPremiumRequired_PremiumIsAllowed()
    {
        foreach (var capability in new[] { Capability.DailyStylist, Capability.SmartSuitcase })
        {
            Assert.Equal(ErrorCodes.PremiumRequired, EntitlementPolicy.Check(Tier.Free, capability, NoCredits).Reason);
            Assert.True(EntitlementPolicy.Check(Tier.Premium, capability, NoCredits).Allowed);
        }
    }

    [Fact]
    public void Calendar_TheDayAndWeekTurnAtIstanbulMidnight()
    {
        var before = TeenStylistCalendar.Of(new DateTime(2026, 11, 22, 20, 59, 59, DateTimeKind.Utc));   // Sun 23:59:59 Istanbul
        var after = TeenStylistCalendar.Of(new DateTime(2026, 11, 22, 21, 0, 0, DateTimeKind.Utc));      // Mon 00:00 Istanbul
        Assert.Equal(("2026-11-22", "2026-11-16"), (before.Day, before.Week));
        Assert.Equal(("2026-11-23", "2026-11-23"), (after.Day, after.Week));
        Assert.Equal(new DateTime(2026, 11, 23, 21, 0, 0, DateTimeKind.Utc), after.DayResetsAt);
        Assert.Equal(new DateTime(2026, 11, 29, 21, 0, 0, DateTimeKind.Utc), after.WeekResetsAt);
    }

    [Fact]
    public void Quota_CountsPendingSlotsOfThePeriod_ForgetsOldDaysAndLostJobs()
    {
        var usage = new TeenStylistUsageEntity
        {
            TenantId = "t", Day = "2026-11-20", OutfitsUsed = 3, Week = "2026-11-16", WeekPlansUsed = 1,
            Pending =
            [
                new TeenStylistPending { JobId = "a", Kind = TeenStylistKind.Outfit, Day = "2026-11-21", Week = "2026-11-16", At = Now.AddMinutes(-1) },
                new TeenStylistPending { JobId = "b", Kind = TeenStylistKind.Outfit, Day = "2026-11-20", Week = "2026-11-16", At = Now.AddHours(-12) },
                new TeenStylistPending { JobId = "c", Kind = TeenStylistKind.Outfit, Day = "2026-11-21", Week = "2026-11-16", At = Now.AddHours(-25) },
            ],
        };
        var quota = TeenStylistQuota.Of(usage, new TeenStylistOptions(), Now);
        var dto = quota.ToDto();
        Assert.Equal((1, 2, 1, 0), (dto.UsedToday, dto.RemainingToday, dto.WeekPlanUsed, dto.WeekPlanRemaining));
        Assert.Equal((0, 0), (dto.TripPackLimit, dto.TripPackRemaining));
    }
}
