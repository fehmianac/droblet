using Domain.Entity;
using Domain.Enum;
using Domain.Services;
using Infrastructure.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using Tests.Shared;

namespace InfrastructureTests;

public class CreditServiceTests
{
    private const string Tenant = "t1";
    private readonly InMemoryRepository _repository = new();
    private readonly FakeTimeProvider _clock = Fixtures.Clock();

    private CreditService Credits() => new(_repository, Fixtures.Entitlements(), _clock, NullLogger<CreditService>.Instance);
    private EntitlementService Entitlement() => new(_repository, Fixtures.Entitlements(), _clock);

    private async Task MakePremiumAsync(DateTime anchor) => await _repository.SaveAsync(Fixtures.Premium(Tenant, anchor));

    [Fact]
    public async Task Reserve_WhenFree_HasNothingToSpend()
    {
        var result = await Credits().ReserveAsync(Tenant, "k1", "job1", default);

        Assert.Equal(ReserveOutcome.Insufficient, result.Outcome);
    }

    [Fact]
    public async Task Reserve_SameKeyTwice_ChargesOnce()
    {
        await MakePremiumAsync(Fixtures.Now.AddDays(-3));
        var credits = Credits();

        Assert.Equal(ReserveOutcome.Reserved, (await credits.ReserveAsync(Tenant, "outfit-A", "job1", default)).Outcome);
        Assert.Equal(ReserveOutcome.AlreadyReserved, (await credits.ReserveAsync(Tenant, "outfit-A", "job2", default)).Outcome);

        var snapshot = await Entitlement().GetAsync(Tenant, default);
        Assert.Equal(29, snapshot.Credits.AllowanceRemaining);
    }

    [Fact]
    public async Task Refund_AfterFailure_RestoresCredit_AndAllowsRetry()
    {
        await MakePremiumAsync(Fixtures.Now.AddDays(-3));
        var credits = Credits();
        await credits.ReserveAsync(Tenant, "outfit-A", "job1", default);

        await credits.RefundAsync(Tenant, "outfit-A", default);

        Assert.Equal(30, (await Entitlement().GetAsync(Tenant, default)).Credits.AllowanceRemaining);
        Assert.Equal(ReserveOutcome.Reserved, (await credits.ReserveAsync(Tenant, "outfit-A", "job2", default)).Outcome);
    }

    [Fact]
    public async Task Commit_ThenRefund_KeepsTheCharge()
    {
        await MakePremiumAsync(Fixtures.Now.AddDays(-3));
        var credits = Credits();
        await credits.ReserveAsync(Tenant, "outfit-A", "job1", default);

        await credits.CommitAsync(Tenant, "outfit-A", default);
        await credits.RefundAsync(Tenant, "outfit-A", default);

        Assert.Equal(29, (await Entitlement().GetAsync(Tenant, default)).Credits.AllowanceRemaining);
    }

    [Fact]
    public async Task Reserve_After30_UsesPackThenRunsOut()
    {
        await MakePremiumAsync(Fixtures.Now.AddDays(-3));
        var credits = Credits();
        await credits.AddPackCreditsAsync(Tenant, 1, "apple:tx-pack-1", default);

        for (var i = 0; i < 30; i++)
            Assert.Equal(ReserveOutcome.Reserved, (await credits.ReserveAsync(Tenant, $"k{i}", $"j{i}", default)).Outcome);

        Assert.Equal(ReserveOutcome.Reserved, (await credits.ReserveAsync(Tenant, "k30", "j30", default)).Outcome);
        Assert.Equal(ReserveOutcome.Insufficient, (await credits.ReserveAsync(Tenant, "k31", "j31", default)).Outcome);
    }

    [Fact]
    public async Task NewSubscriptionMonth_ResetsAllowance_PackStays()
    {
        await MakePremiumAsync(Fixtures.Now.AddDays(-3));
        var credits = Credits();
        await credits.AddPackCreditsAsync(Tenant, 20, "apple:tx-pack-1", default);
        for (var i = 0; i < 12; i++)
            await credits.ReserveAsync(Tenant, $"k{i}", $"j{i}", default);

        _clock.Advance(TimeSpan.FromDays(31));
        var snapshot = await Entitlement().GetAsync(Tenant, default);

        Assert.Equal(30, snapshot.Credits.AllowanceRemaining);
        Assert.Equal(20, snapshot.Credits.PackRemaining);
    }

    [Fact]
    public async Task AddPack_SameStoreTransactionTwice_AddsOnce()
    {
        var credits = Credits();

        await credits.AddPackCreditsAsync(Tenant, 20, "apple:tx-9", default);
        await credits.AddPackCreditsAsync(Tenant, 20, "apple:tx-9", default);

        Assert.Equal(20, (await Entitlement().GetAsync(Tenant, default)).Credits.PackRemaining);
    }

    [Fact]
    public async Task Ledger_RecordsEveryMovement()
    {
        await MakePremiumAsync(Fixtures.Now.AddDays(-3));
        var credits = Credits();
        await credits.ReserveAsync(Tenant, "a", "j1", default);
        await credits.RefundAsync(Tenant, "a", default);

        var entries = await _repository.GetAllAsync<CreditLedgerEntryEntity>(CreditLedgerEntryEntity.GetPk(Tenant));

        Assert.Equal([CreditLedgerEntryKind.AllowanceReserved, CreditLedgerEntryKind.Refunded], entries.Select(e => e.Kind).Order().ToArray());
    }
}
