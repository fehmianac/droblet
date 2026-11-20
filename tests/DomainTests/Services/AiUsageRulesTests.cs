using Domain.Enum;
using Domain.Options;
using Domain.Services;
using Domain.Services.Admin;

namespace DomainTests.Services;

public class AiUsageRulesTests
{
    [Theory]
    [InlineData(JobKind.StylistOutfit, "outfit", null, AiUsageOperations.StylistOutfit)]
    [InlineData(JobKind.StylistComplete, "outfit", null, AiUsageOperations.StylistOutfit)]
    [InlineData(JobKind.StylistWeek, "week_plan", null, AiUsageOperations.StylistWeek)]
    [InlineData(JobKind.StylistPack, "packing", null, AiUsageOperations.StylistPack)]
    [InlineData(JobKind.ItemProcess, "item_detection", null, AiUsageOperations.ItemDetection)]
    [InlineData(JobKind.ItemProcess, "garment_draft", null, AiUsageOperations.ItemDetection)]
    [InlineData(JobKind.ItemProcess, "image_cleanup", null, AiUsageOperations.Cleanup)]
    [InlineData(JobKind.ItemSplit, "image_cleanup", null, AiUsageOperations.Cleanup)]
    [InlineData(JobKind.ItemClean, "image_cleanup", null, AiUsageOperations.MultiItem)]
    [InlineData(JobKind.ItemClean, "image_cleanup", "outfit_import", AiUsageOperations.ImportCleanup)]
    [InlineData(JobKind.OutfitImport, "item_detection", null, AiUsageOperations.ImportDetect)]
    [InlineData(JobKind.OutfitImport, "item_match", null, AiUsageOperations.ImportMatch)]
    [InlineData(JobKind.Palette, "palette_season", null, AiUsageOperations.Palette)]
    [InlineData(JobKind.TryOn, "photo_check", null, AiUsageOperations.PhotoCheck)]
    [InlineData(JobKind.TryOn, "image_tryon", null, AiUsageOperations.TryOn)]
    [InlineData(JobKind.AiTrial, "outfit", null, AiUsageOperations.AdminTrial)]
    [InlineData(JobKind.AiTrial, "photo_check", null, AiUsageOperations.PhotoCheck)]
    public void Classify_EveryAiPath_HasItsOperation(JobKind kind, string call, string? source, string expected) =>
        Assert.Equal(expected, AiUsageOperations.Classify(kind, call, source));

    [Fact]
    public void SourceOf_ReadsOnlyTheUsageSourceField()
    {
        Assert.Equal("outfit_import", AiUsageOperations.SourceOf("""{"usageSource":"outfit_import"}"""));
        Assert.Null(AiUsageOperations.SourceOf("""{"source":"body"}"""));
        Assert.Null(AiUsageOperations.SourceOf("not json usageSource"));
        Assert.Null(AiUsageOperations.SourceOf(null));
    }

    [Fact]
    public void Increments_JobOutcome_CallsTokensImagesCost_PerOperationAndModel()
    {
        var record = new AiUsageRecord("t", "j", JobKind.ItemProcess, AiUsageOutcome.Completed,
        [
            new AiUsageCall("item_detection", "gpt-6.1-terra", 200, 2900, 840, 240, 70, 2_900),
            new AiUsageCall("image_cleanup", "gpt-image-2.5-sunburst", 200, 991, 200, 0, 0, 12_500),
            new AiUsageCall("image_cleanup", "gpt-image-2.5-sunburst", 500, 0, 0, 0, 0, 0),
        ], DateTime.UtcNow);

        var add = AiUsageCounters.Increments(record);

        Assert.Equal((1L, 1L, 3L, 1L), (add[AiUsageCounters.Jobs], add[AiUsageCounters.Completed], add[AiUsageCounters.Calls], add[AiUsageCounters.CallErrors]));
        Assert.Equal((3891L, 1040L, 240L, 70L, 1L, 15_400L), (add["in"], add["out"], add["cached"], add["reasoning"], add["images"], add["cost"]));
        Assert.Equal(1, add["op|item_detection|jobs"]);
        Assert.Equal((2L, 12_500L, 1L), (add["op|cleanup|calls"], add["op|cleanup|cost"], add["op|cleanup|images"]));
        Assert.Equal((2L, 12_500L), (add["model|gpt-image-2.5-sunburst|calls"], add["model|gpt-image-2.5-sunburst|cost"]));
        Assert.DoesNotContain(AiUsageCounters.Failed, add.Keys);
    }

    [Fact]
    public void Increments_RefundedIsAFailureToo_DetectStageCountsNoJob_NothingIsEmpty()
    {
        var refunded = AiUsageCounters.Increments(new AiUsageRecord("t", "j", JobKind.TryOn, AiUsageOutcome.Refunded, [], DateTime.UtcNow));
        Assert.Equal((1L, 1L, 1L, 1L), (refunded["failed"], refunded["refunded"], refunded["op|tryon|failed"], refunded["op|tryon|refunded"]));

        var detect = AiUsageCounters.Increments(new AiUsageRecord("t", "oi", JobKind.OutfitImport, AiUsageOutcome.Completed,
            [new AiUsageCall("item_detection", "m", 200, 10, 5, CostMicroUsd: 3)], DateTime.UtcNow, CountsJob: false));
        Assert.DoesNotContain("jobs", detect.Keys);
        Assert.Equal(3, detect["op|import_detect|cost"]);

        Assert.Empty(AiUsageCounters.Increments(new AiUsageRecord("t", "x", JobKind.Palette, AiUsageOutcome.Completed, [], DateTime.UtcNow, CountsJob: false)));
    }

    [Fact]
    public void ModelIds_AreCleanedForAttributeNames()
    {
        Assert.Equal("gpt-6.1-terra", AiUsageCounters.Clean("gpt-6.1-terra"));
        Assert.Equal("a_b_c", AiUsageCounters.Clean("a|b c"));
        Assert.Equal("unknown", AiUsageCounters.Clean("  "));
    }

    [Fact]
    public void FromJobCost_OneCallPerCount_CostOnTheFirst_ModelOnlyWhenUnique()
    {
        var calls = AiUsageCounters.FromJobCost(new Dictionary<string, long> { ["calls.image_cleanup"] = 2, ["image_cleanup"] = 25_000, ["total"] = 25_000 }, ["gpt-image-2.5-sunburst"]);
        Assert.Equal([25_000L, 0L], calls.Select(c => c.CostMicroUsd));
        Assert.All(calls, c => Assert.Equal("gpt-image-2.5-sunburst", c.Model));
        Assert.All(AiUsageCounters.FromJobCost(new Dictionary<string, long> { ["calls.outfit"] = 1 }, ["a", "b"]), c => Assert.Null(c.Model));
        Assert.Empty(AiUsageCounters.FromJobCost(null, null));
    }

    // ── Views ─────────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Operations_AndModels_ParseTheCounterNames_MostExpensiveFirst()
    {
        var counters = new Dictionary<string, long>
        {
            ["op|stylist_outfit|cost"] = 10, ["op|stylist_outfit|calls"] = 2, ["op|tryon|cost"] = 30, ["op|tryon|images"] = 1,
            ["model|gpt-6.1-terra|cost"] = 7, ["model|gpt-6.1-terra|calls"] = 3, ["cost"] = 40,
        };
        Assert.Equal(["tryon", "stylist_outfit"], AiUsageMath.Operations(counters).Select(o => o.Operation));
        Assert.Equal(2, AiUsageMath.Operations(counters)[1].Calls);
        var model = Assert.Single(AiUsageMath.Models(counters));
        Assert.Equal(("gpt-6.1-terra", 3L, 7L), (model.Model, model.Calls, model.CostMicroUsd));
        Assert.Equal(40, AiUsageMath.Totals(counters).CostMicroUsd);
    }

    [Fact]
    public void Plan_CostPerActiveUser_ScaledTo30Days_ShareOfNetPrice_PremiumOnly()
    {
        var options = new AiUsageOptions();   // ₺43/$, ₺141.66 monthly net, ₺88.54 yearly per month
        var counters = new Dictionary<string, long> { ["cost"] = 2_090_000 * 2 / 2 * 3 };   // $6.27 over 15 days for 3 users

        var premium = AiUsageMath.Plan(AiUsagePlans.Premium, 3, counters, 15, options);

        Assert.Equal(2_090_000, premium.CostPerActiveUserMicroUsd);
        Assert.Equal(4_180_000, premium.CostPerActiveUserPer30DaysMicroUsd);
        Assert.Equal(Math.Round(4.18m * 43m / 141.66m, 4), premium.ShareOfMonthlyNet);
        Assert.Equal(Math.Round(4.18m * 43m / 88.54m, 4), premium.ShareOfYearlyNet);
        Assert.Null(AiUsageMath.Plan(AiUsagePlans.Free, 3, counters, 15, options).ShareOfMonthlyNet);
        Assert.Equal(0, AiUsageMath.Plan(AiUsagePlans.Premium, 0, counters, 15, options).CostPerActiveUserMicroUsd);
    }

    [Fact]
    public void Median_OddEvenEmpty()
    {
        Assert.Equal(3, AiUsageMath.Median([5, 1, 3]));
        Assert.Equal(2, AiUsageMath.Median([1, 3]));
        Assert.Null(AiUsageMath.Median([]));
    }

    [Fact]
    public void AnomalyRule_AboveXTimesTheMedian_NeedsHistoryAndAFloor_OrAboveTheAbsoluteThreshold()
    {
        var options = new AiUsageOptions { AnomalyMedianMultiplier = 5, AnomalyMinHistoryDays = 3, AnomalyMinDayUsd = 0.10m, AnomalyAbsoluteDayUsd = 2 };
        var day = new DateOnly(2026, 11, 18);
        Dictionary<DateOnly, long> History(long today, params long[] before)
        {
            var map = new Dictionary<DateOnly, long> { [day] = today };
            for (var i = 0; i < before.Length; i++)
                map[day.AddDays(-(i + 1))] = before[i];
            return map;
        }

        var spike = AiUsageMath.Check(day, History(600_000, 100_000, 100_000, 100_000), options);
        Assert.Equal([AiUsageMath.ReasonMedian], spike.Reasons);
        Assert.Equal((100_000L, 6m), (spike.Median!.Value, spike.Multiple!.Value));
        Assert.Empty(AiUsageMath.Check(day, History(500_000, 100_000, 100_000, 100_000), options).Reasons);         // exactly 5×: not above
        Assert.Empty(AiUsageMath.Check(day, History(600_000, 100_000, 100_000), options).Reasons);                  // too little history
        Assert.Empty(AiUsageMath.Check(day, History(90_000, 1_000, 1_000, 1_000), options).Reasons);                // 90× but under $0.10
        Assert.Equal([AiUsageMath.ReasonAbsolute], AiUsageMath.Check(day, History(2_500_000), options).Reasons);     // no history, above $2
        var old = new Dictionary<DateOnly, long> { [day] = 600_000, [day.AddDays(-31)] = 1, [day.AddDays(-32)] = 1, [day.AddDays(-33)] = 1 };
        Assert.Empty(AiUsageMath.Check(day, old, options).Reasons);                                                  // only the previous 30 days count
    }

    [Fact]
    public void Masking_KeepsOnlyTheFirstLetters()
    {
        Assert.Equal("a***@g***.com", AiUsageMath.MaskEmail("ayse.kaya@gmail.com"));
        Assert.Equal("x***", AiUsageMath.MaskEmail("x-no-at"));
        Assert.Null(AiUsageMath.MaskEmail(null));
        Assert.Equal("ay***", AiUsageMath.MaskHandle("aysekaya"));
        Assert.Equal("a***", AiUsageMath.MaskHandle("ab"));
        Assert.Null(AiUsageMath.MaskHandle(""));
    }

    [Fact]
    public void Permission_AiUsageView_SuperAdminAndEveryAiManageHolder_NotEditorsOrModerators()
    {
        Assert.True(AdminPermissions.Has(AdminRole.SuperAdmin, AdminPermissions.AiUsageView));
        Assert.Contains(AdminPermissions.AiUsageView, AdminPermissions.Of(AdminRole.SuperAdmin));
        Assert.False(AdminPermissions.Has(AdminRole.ContentEditor, AdminPermissions.AiUsageView));
        Assert.False(AdminPermissions.Has(AdminRole.Moderator, AdminPermissions.AiUsageView));
        Assert.DoesNotContain(AdminPermissions.AiUsageView, AdminPermissions.Of(AdminRole.Moderator));
        // The rule: whoever holds ai.manage can see the usage too.
        Assert.All(Enum.GetValues<AdminRole>(), role =>
            Assert.True(!AdminPermissions.Has(role, AdminPermissions.AiManage) || AdminPermissions.Has(role, AdminPermissions.AiUsageView)));
    }
}
