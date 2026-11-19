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
        var usage = await repository.GetAsync<ItemRecognitionUsageEntity>(ItemRecognitionUsageEntity.GetPk(tenantId), ItemRecognitionUsageEntity.GetSk(), ct);
        var now = timeProvider.GetUtcNow().UtcDateTime;
        return new EntitlementSnapshot(active, CreditLedger.Balance(CreditContextLoader.StateOf(account), context),
            EntitlementPolicy.ItemRecognition(active.Tier, options.CurrentValue.Free.ItemRecognitionLimit, ItemRecognitionQuotaService.UsedOf(usage, now)),
            EntitlementPolicy.OutfitImportMaxPhotos(active.Tier, options.CurrentValue));
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

/// <summary>
/// The non-member AI recognition counter (ItemRecognitionUsageEntity, one row per tenant, optimistic versioning).
/// A reservation that was neither committed nor released within <see cref="PendingLifetime"/> (a job that died in the
/// DLQ) stops counting, so a lost job can never cost the user a slot for good.
/// </summary>
public sealed class ItemRecognitionQuotaService(IRepository repository, IOptionsMonitor<EntitlementOptions> options, TimeProvider timeProvider) : IItemRecognitionQuotaService
{
    public static readonly TimeSpan PendingLifetime = TimeSpan.FromHours(24);
    private const int Retries = 8;

    private DateTime Now => timeProvider.GetUtcNow().UtcDateTime;

    public static int UsedOf(ItemRecognitionUsageEntity? usage, DateTime now) =>
        usage is null ? 0 : usage.Used + usage.Pending.Count(p => now - p.At < PendingLifetime);

    private Task<ItemRecognitionUsageEntity?> LoadAsync(string tenantId, CancellationToken ct) =>
        repository.GetAsync<ItemRecognitionUsageEntity>(ItemRecognitionUsageEntity.GetPk(tenantId), ItemRecognitionUsageEntity.GetSk(), ct);

    private async Task<Tier> TierAsync(string tenantId, CancellationToken ct) =>
        EntitlementResolver.Resolve(await repository.GetAllAsync<EntitlementEntity>(EntitlementEntity.GetPk(tenantId), ct), Now).Tier;

    public async Task<ItemRecognitionQuota> GetAsync(string tenantId, CancellationToken ct) =>
        EntitlementPolicy.ItemRecognition(await TierAsync(tenantId, ct), options.CurrentValue.Free.ItemRecognitionLimit, UsedOf(await LoadAsync(tenantId, ct), Now));

    public async Task<ItemRecognitionGrant> ReserveAsync(string tenantId, IReadOnlyList<string> jobIds, CancellationToken ct)
    {
        var tier = await TierAsync(tenantId, ct);
        var limit = options.CurrentValue.Free.ItemRecognitionLimit;
        for (var attempt = 0; attempt < Retries; attempt++)
        {
            var now = Now;
            var usage = await LoadAsync(tenantId, ct) ?? new ItemRecognitionUsageEntity { TenantId = tenantId };
            usage.Pending.RemoveAll(p => now - p.At >= PendingLifetime);
            // A retried request: ids that already hold a slot are not counted twice.
            var fresh = jobIds.Where(id => usage.Pending.All(p => p.JobId != id)).ToList();
            var grant = EntitlementPolicy.GrantItemRecognition(tier, limit, usage.Used + usage.Pending.Count, fresh.Count);
            if (tier == Tier.Premium || grant.Granted == 0)
                return grant with { Granted = grant.Granted + (jobIds.Count - fresh.Count), DenyReason = jobIds.Count - fresh.Count > 0 ? null : grant.DenyReason };

            usage.Pending.AddRange(fresh.Take(grant.Granted).Select(id => new ItemRecognitionPending { JobId = id, At = now }));
            usage.UpdatedAt = now;
            if (await repository.SaveIfVersionAsync(usage, usage.Version, ct))
                return grant with { Granted = grant.Granted + (jobIds.Count - fresh.Count) };
        }
        throw new InvalidOperationException("Item recognition quota could not be reserved (too many concurrent writers).");
    }

    public Task CommitAsync(string tenantId, string jobId, CancellationToken ct) => SettleAsync(tenantId, jobId, consumed: true, ct);

    public Task ReleaseAsync(string tenantId, string jobId, CancellationToken ct) => SettleAsync(tenantId, jobId, consumed: false, ct);

    private async Task SettleAsync(string tenantId, string jobId, bool consumed, CancellationToken ct)
    {
        for (var attempt = 0; attempt < Retries; attempt++)
        {
            var usage = await LoadAsync(tenantId, ct);
            // No reservation = a member's job, or this job was settled already: nothing to do (idempotent).
            if (usage is null || usage.Pending.RemoveAll(p => p.JobId == jobId) == 0)
                return;
            if (consumed)
                usage.Used++;
            usage.UpdatedAt = Now;
            if (await repository.SaveIfVersionAsync(usage, usage.Version, ct))
                return;
        }
        throw new InvalidOperationException("Item recognition quota could not be settled (too many concurrent writers).");
    }
}
