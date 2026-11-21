using Domain.Constant;
using Domain.Entity;
using Domain.Enum;
using Domain.Options;
using Domain.Services;
using Infrastructure.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using Tests.Shared;

namespace InfrastructureTests;

/// <summary>Teen:Stylist allowance: reserve on start, commit on completion, release on failure (docs/api/teen.md §4.2).</summary>
public class StylistAllowanceTests
{
    private const string Tenant = "tenant-teen";
    // Saturday 2026-11-21 12:00 Istanbul.
    private static readonly DateTime Now = new(2026, 11, 21, 9, 0, 0, DateTimeKind.Utc);

    private sealed record Setup(StylistAllowanceService Allowance, JobLifecycle Jobs, InMemoryRepository Repository, FakeTimeProvider Clock, TeenOptions Teen);

    private static async Task<Setup> CreateAsync(bool teen = true, ParentalConsentStatus consent = ParentalConsentStatus.Active, Action<TeenStylistOptions>? configure = null)
    {
        var repository = new InMemoryRepository();
        var clock = new FakeTimeProvider(new DateTimeOffset(Now));
        var options = new TeenOptions();
        configure?.Invoke(options.Stylist);
        var allowance = Fixtures.Allowance(repository, clock, options);
        var credits = new CreditService(repository, Fixtures.Entitlements(), clock, NullLogger<CreditService>.Instance);
        var jobs = new JobLifecycle(repository, credits, new ItemRecognitionQuotaService(repository, Fixtures.Entitlements(), clock), allowance,
            new AiUsageRecorder(repository, NullLogger<AiUsageRecorder>.Instance), clock, NullLogger<JobLifecycle>.Instance);
        await repository.SaveAsync(new TenantEntity { Id = Tenant, AgeBand = teen ? AgeBand.Teen : AgeBand.Adult });
        if (teen)
            await repository.SaveAsync(new ParentalConsentEntity { TenantId = Tenant, UserId = "u", Status = consent });
        return new Setup(allowance, jobs, repository, clock, options);
    }

    private static async Task<JobEntity> JobAsync(Setup s, string id, JobKind kind = JobKind.StylistOutfit)
    {
        var job = new JobEntity { Id = id, TenantId = Tenant, Kind = kind, Status = JobStatus.Processing, CreatedAt = Now, UpdatedAt = Now };
        await s.Repository.SaveAsync(job);
        return job;
    }

    private static Task<EntitlementDecision> Outfit(Setup s, string id) => s.Allowance.ReserveAsync(Tenant, id, TeenStylistKind.Outfit, default);

    private static async Task<TeenStylistDto> QuotaAsync(Setup s) =>
        TeenStylistQuota.Of(await StylistAllowanceService.LoadAsync(s.Repository, Tenant, default), s.Teen.Stylist, s.Clock.GetUtcNow().UtcDateTime).ToDto();

    [Fact]
    public async Task ApprovedTeen_GetsThreeADay_TheFourthIsTheDailyLimit()
    {
        var s = await CreateAsync();
        foreach (var id in new[] { "a", "b", "c" })
            Assert.True((await Outfit(s, id)).Allowed);
        var over = await Outfit(s, "d");

        Assert.Equal(ErrorCodes.TeenStylistDailyLimit, over.Reason);
        Assert.Equal(new DateTime(2026, 11, 21, 21, 0, 0, DateTimeKind.Utc), over.ResetsAt);
        Assert.Equal((3, 0), ((await QuotaAsync(s)).UsedToday, (await QuotaAsync(s)).RemainingToday));   // in-flight counts
        // The same job started again (request retry) keeps its one slot.
        Assert.True((await Outfit(s, "a")).Allowed);
    }

    [Fact]
    public async Task FailedJob_IsNotCounted_CompletedIs_SettlingTwiceChangesNothing()
    {
        var s = await CreateAsync();
        await Outfit(s, "a");
        await Outfit(s, "b");
        await s.Jobs.CompleteAsync(await JobAsync(s, "a"), "{}", default);
        await s.Jobs.FailAsync(await JobAsync(s, "b"), JobFailure.ProviderError, default);
        await s.Allowance.CommitAsync(Tenant, "a", default);
        await s.Allowance.ReleaseAsync(Tenant, "b", default);
        await s.Allowance.CommitAsync(Tenant, "b", default);

        var quota = await QuotaAsync(s);
        Assert.Equal((1, 2), (quota.UsedToday, quota.RemainingToday));
        Assert.Empty((await StylistAllowanceService.LoadAsync(s.Repository, Tenant, default))!.Pending);
    }

    [Fact]
    public async Task TheDayResets_AtIstanbulMidnight()
    {
        var s = await CreateAsync();
        foreach (var id in new[] { "a", "b", "c" })
        {
            await Outfit(s, id);
            await s.Jobs.CompleteAsync(await JobAsync(s, id), "{}", default);
        }
        s.Clock.SetUtcNow(new DateTimeOffset(new DateTime(2026, 11, 21, 20, 59, 0, DateTimeKind.Utc)));   // 23:59 Istanbul
        Assert.Equal(ErrorCodes.TeenStylistDailyLimit, (await Outfit(s, "d")).Reason);

        s.Clock.SetUtcNow(new DateTimeOffset(new DateTime(2026, 11, 21, 21, 0, 0, DateTimeKind.Utc)));    // 00:00 Istanbul
        Assert.Equal(0, (await QuotaAsync(s)).UsedToday);
        Assert.True((await Outfit(s, "e")).Allowed);
        await s.Jobs.CompleteAsync(await JobAsync(s, "e"), "{}", default);
        var row = (await StylistAllowanceService.LoadAsync(s.Repository, Tenant, default))!;
        Assert.Equal(("2026-11-22", 1), (row.Day, row.OutfitsUsed));
    }

    [Fact]
    public async Task WeekPlan_OncePerWeek_PackingOffByDefault()
    {
        var s = await CreateAsync();
        Assert.True((await s.Allowance.ReserveAsync(Tenant, "w1", TeenStylistKind.WeekPlan, default)).Allowed);
        await s.Jobs.CompleteAsync(await JobAsync(s, "w1", JobKind.StylistWeek), "{}", default);
        var second = await s.Allowance.ReserveAsync(Tenant, "w2", TeenStylistKind.WeekPlan, default);
        var pack = await s.Allowance.ReserveAsync(Tenant, "p1", TeenStylistKind.TripPack, default);

        Assert.Equal(ErrorCodes.TeenStylistWeeklyLimit, second.Reason);
        Assert.Equal(new DateTime(2026, 11, 22, 21, 0, 0, DateTimeKind.Utc), second.ResetsAt);
        Assert.Equal(ErrorCodes.TeenStylistUnavailable, pack.Reason);
        Assert.Equal((1, 0), ((await QuotaAsync(s)).WeekPlanUsed, (await QuotaAsync(s)).WeekPlanRemaining));
        Assert.True((await Outfit(s, "o")).Allowed);   // outfits have their own allowance
    }

    [Fact]
    public async Task Disabled_OrZero_IsUnavailable_AndStoresNothing()
    {
        var off = await CreateAsync(configure: o => o.Enabled = false);
        var zero = await CreateAsync(configure: o => o.DailyLimit = 0);

        Assert.Equal(ErrorCodes.TeenStylistUnavailable, (await Outfit(off, "a")).Reason);
        Assert.Equal(ErrorCodes.TeenStylistUnavailable, (await Outfit(zero, "a")).Reason);
        Assert.Null(await StylistAllowanceService.LoadAsync(off.Repository, Tenant, default));
        Assert.Null(await StylistAllowanceService.LoadAsync(zero.Repository, Tenant, default));
    }

    [Fact]
    public async Task PendingTeen_IsBlocked_WithParentalConsentRequired()
    {
        var s = await CreateAsync(consent: ParentalConsentStatus.PendingParentalConsent);
        Assert.Equal(ErrorCodes.ParentalConsentRequired, (await Outfit(s, "a")).Reason);
    }

    [Fact]
    public async Task Adults_AreUnchanged_FreeGetsPremiumRequired_PremiumIsNeverCounted()
    {
        var s = await CreateAsync(teen: false);
        Assert.Equal(ErrorCodes.PremiumRequired, (await Outfit(s, "a")).Reason);
        Assert.Equal(ErrorCodes.PremiumRequired, (await s.Allowance.ReserveAsync(Tenant, "p", TeenStylistKind.TripPack, default)).Reason);

        await s.Repository.SaveAsync(Fixtures.Premium(Tenant, Now.AddDays(-1)));
        for (var i = 0; i < 10; i++)
        {
            var decision = await Outfit(s, $"m{i}");
            Assert.True(decision.Allowed);
            Assert.False(decision.UsesTeenAllowance);
            await s.Jobs.CompleteAsync(await JobAsync(s, $"m{i}"), "{}", default);
        }
        Assert.True((await s.Allowance.ReserveAsync(Tenant, "p", TeenStylistKind.TripPack, default)).Allowed);
        Assert.Null(await StylistAllowanceService.LoadAsync(s.Repository, Tenant, default));
    }
}
