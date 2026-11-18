using Domain.Entity;
using Domain.Enum;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Microsoft.Extensions.Options;

namespace Infrastructure.Services;

/// <summary>Tier is read from the store-backed records on every request (never from the JWT); the decision is EntitlementPolicy's.</summary>
public sealed class EntitlementService(IRepository repository, IOptionsMonitor<EntitlementOptions> options, TimeProvider timeProvider) : IEntitlementService
{
    public async Task<EntitlementSnapshot> GetAsync(string tenantId, CancellationToken ct)
    {
        var (active, context, account) = await CreditContextLoader.LoadAsync(repository, tenantId, options.CurrentValue, timeProvider, ct);
        return new EntitlementSnapshot(active, CreditLedger.Balance(CreditContextLoader.StateOf(account), context));
    }

    public async Task<EntitlementDecision> CheckAsync(string tenantId, Capability capability, CancellationToken ct)
    {
        var snapshot = await GetAsync(tenantId, ct);
        return EntitlementPolicy.Check(snapshot.Active.Tier, capability, snapshot.Credits);
    }
}

internal static class CreditContextLoader
{
    public static async Task<(ActiveEntitlement Active, CreditContext Context, CreditAccountEntity? Account)> LoadAsync(
        IRepository repository, string tenantId, EntitlementOptions options, TimeProvider timeProvider, CancellationToken ct)
    {
        var now = timeProvider.GetUtcNow().UtcDateTime;
        var entitlements = await repository.GetAllAsync<EntitlementEntity>(EntitlementEntity.GetPk(tenantId), ct);
        var active = EntitlementResolver.Resolve(entitlements, now);
        var context = EntitlementResolver.CreditContextFor(active, now, options.Premium.TryOnCreditsPerMonth);
        var account = await repository.GetAsync<CreditAccountEntity>(CreditAccountEntity.GetPk(tenantId), CreditAccountEntity.GetSk(), ct);
        return (active, context, account);
    }

    public static CreditState StateOf(CreditAccountEntity? account) =>
        account is null ? CreditState.Empty : new CreditState(account.PeriodStart, account.AllowanceUsed, account.PackBalance);

    public static void Apply(CreditAccountEntity account, CreditState state, DateTime now)
    {
        account.PeriodStart = state.PeriodStart;
        account.AllowanceUsed = state.AllowanceUsed;
        account.PackBalance = state.PackBalance;
        account.UpdatedAt = now;
    }
}
