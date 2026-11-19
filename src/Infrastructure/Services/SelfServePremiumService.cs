using Domain.Domain;
using Domain.Entity;
using Domain.Enum;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Domain.Services.Admin;
using Microsoft.Extensions.Options;

namespace Infrastructure.Services;

public enum SelfPremiumOutcome { Ok, Disabled, StoreSubscriptionActive }

/// <summary>
/// Temporary self-serve premium (owner decision 2026-11-19, until store purchases are live): the user grants their own
/// account the same thing the admin "test premium" grant gives — Premium tier + the monthly try-on credits — as an admin
/// entitlement row with id / productId <see cref="Id"/> ("self_test"). Lives one subscription month; the user can turn it
/// on again afterwards while the switch is on. A store subscription always wins and is never written or deleted here.
/// Every grant / revoke is audited (actor = the user, no admin).
/// </summary>
public sealed class SelfServePremiumService(
    IRepository repository,
    IEntitlementService entitlements,
    IAuditLog audit,
    IOptionsMonitor<EntitlementOptions> options,
    TimeProvider timeProvider)
{
    /// <summary>Entitlement id and productId of the self-serve grant (the "source" the panel and the audit log show).</summary>
    public const string Id = "self_test";

    private bool Enabled => options.CurrentValue.SelfServePremium.Enabled;
    private DateTime Now => timeProvider.GetUtcNow().UtcDateTime;

    private Task<EntitlementEntity?> SelfRowAsync(string tenantId, CancellationToken ct) =>
        repository.GetAsync<EntitlementEntity>(EntitlementEntity.GetPk(tenantId), EntitlementEntity.GetSk(EntitlementSource.Admin, Id), ct);

    public async Task<SelfServePremiumDto> StatusAsync(string tenantId, CancellationToken ct)
    {
        var row = await SelfRowAsync(tenantId, ct);
        return new SelfServePremiumDto(Enabled, row is not null && EntitlementResolver.IsActive(row, Now));
    }

    /// <summary>The entitlement as GET v1/tenant/entitlement returns it, with the self-serve status.</summary>
    public async Task<EntitlementDto> EntitlementAsync(string tenantId, CancellationToken ct) =>
        (await entitlements.GetAsync(tenantId, ct)).ToDto(tenantId) with { SelfServePremium = await StatusAsync(tenantId, ct) };

    public async Task<SelfPremiumOutcome> GrantAsync(string tenantId, string userId, string? ip, CancellationToken ct)
    {
        if (!Enabled)
            return SelfPremiumOutcome.Disabled;
        var now = Now;
        var all = await repository.GetAllAsync<EntitlementEntity>(EntitlementEntity.GetPk(tenantId), ct);
        if (all.Any(e => e is { Source: EntitlementSource.Store, Tier: Tier.Premium } && EntitlementResolver.IsActive(e, now)))
            return SelfPremiumOutcome.StoreSubscriptionActive;

        // Idempotent: an active grant is kept as it is (its credit month is not restarted by tapping again).
        if (all.FirstOrDefault(e => e is { Source: EntitlementSource.Admin, Id: Id }) is { } existing && EntitlementResolver.IsActive(existing, now))
            return SelfPremiumOutcome.Ok;

        var grant = new EntitlementEntity
        {
            Id = Id,
            TenantId = tenantId,
            Tier = Tier.Premium,
            Source = EntitlementSource.Admin,
            ProductId = Id,
            StartsAt = now,
            ExpiresAt = now.AddMonths(1),
            PeriodAnchor = now,
            UpdatedAt = now,
        };
        await repository.SaveAsync(grant, ct);
        await audit.WriteAsync(null, "user.self_premium_grant", "user", userId, null, new { source = Id, tenantId, expiresAt = grant.ExpiresAt }, ip, ct);
        return SelfPremiumOutcome.Ok;
    }

    /// <summary>Removes only the self-serve row; a store subscription (or an admin test grant) stays untouched.</summary>
    public async Task<SelfPremiumOutcome> RevokeAsync(string tenantId, string userId, string? ip, CancellationToken ct)
    {
        if (!Enabled)
            return SelfPremiumOutcome.Disabled;
        if (await SelfRowAsync(tenantId, ct) is null)
            return SelfPremiumOutcome.Ok;
        await repository.DeleteAsync(EntitlementEntity.GetPk(tenantId), EntitlementEntity.GetSk(EntitlementSource.Admin, Id), ct);
        await audit.WriteAsync(null, "user.self_premium_revoke", "user", userId, new { source = Id, tenantId }, null, ip, ct);
        return SelfPremiumOutcome.Ok;
    }
}
