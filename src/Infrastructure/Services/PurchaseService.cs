using Domain.Entity;
using Domain.Enum;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Infrastructure.Services;

public enum PurchaseApplyOutcome
{
    SubscriptionActivated,
    CreditsAdded,
    UnknownProduct,
    /// <summary>The purchase is already linked to another (existing) Droblet account.</summary>
    OwnedByAnotherAccount,
    /// <summary>appAccountToken / obfuscatedAccountId names another account than the caller.</summary>
    AccountMismatch,
    /// <summary>Android pending purchase (or Ask to Buy): nothing is granted until the store completes it.</summary>
    Pending,
    Revoked,
    /// <summary>A late, older event: newer state is already applied.</summary>
    Stale,
}

public interface IPurchaseService
{
    /// <summary>Applies a store-verified purchase for the signed-in tenant (claims it). Only called with a Verified result.</summary>
    Task<PurchaseApplyOutcome> ApplyAsync(string tenantId, StorePlatform platform, PurchaseVerificationResult verified, CancellationToken ct);

    /// <summary>
    /// A store event (notification / re-read): the tenant comes from the purchase index or the account token.
    /// Returns the tenant it was applied to, or null when no account owns the purchase.
    /// </summary>
    Task<(string? TenantId, PurchaseApplyOutcome Outcome)> ApplyStoreEventAsync(StorePlatform platform, PurchaseVerificationResult verified, StoreNotificationAction action, CancellationToken ct);

    /// <summary>Refund / revoke of a purchase by key when the store payload has nothing else (Play voided purchase).</summary>
    Task<string?> RevokeByKeyAsync(StorePlatform platform, string key, DateTime revokedAt, CancellationToken ct);
}

/// <summary>
/// Writes what the store verified: subscription → EntitlementEntity (tier, access end, store state, credit month anchor);
/// consumable → pack credits through CreditService, added once and taken back once on refund. Every purchase is
/// recorded (StorePurchaseEntity) and indexed to its tenant (StorePurchaseIndexEntity) so notifications find it.
/// Product ids map through Store.ProductIds / Store.CreditPacks; prices never live on the server.
/// </summary>
public sealed class PurchaseService(
    IRepository repository,
    ICreditService credits,
    IOptionsMonitor<StoreOptions> store,
    TimeProvider timeProvider,
    ILogger<PurchaseService>? logger = null) : IPurchaseService
{
    private readonly ILogger _logger = logger ?? NullLogger<PurchaseService>.Instance;
    private DateTime Now => timeProvider.GetUtcNow().UtcDateTime;

    public async Task<PurchaseApplyOutcome> ApplyAsync(string tenantId, StorePlatform platform, PurchaseVerificationResult verified, CancellationToken ct)
    {
        if (verified.Status != PurchaseVerificationStatus.Verified || verified.ProductId is null || verified.OriginalTransactionId is null)
            throw new ArgumentException("Only verified purchases can be applied.", nameof(verified));

        var kind = KindOf(verified);
        if (kind is null)
            return PurchaseApplyOutcome.UnknownProduct;
        if (verified.State == StoreSubscriptionState.Pending)
            return PurchaseApplyOutcome.Pending;
        if (verified.AccountToken is { Length: > 0 } token && !StoreAccountToken.Matches(tenantId, token))
            return PurchaseApplyOutcome.AccountMismatch;
        if (!await ClaimAsync(tenantId, platform, verified.OriginalTransactionId, ct))
            return PurchaseApplyOutcome.OwnedByAnotherAccount;

        return await WriteAsync(tenantId, platform, verified, kind.Value, ct);
    }

    public async Task<(string? TenantId, PurchaseApplyOutcome Outcome)> ApplyStoreEventAsync(
        StorePlatform platform, PurchaseVerificationResult verified, StoreNotificationAction action, CancellationToken ct)
    {
        if (verified.Status != PurchaseVerificationStatus.Verified || verified.ProductId is null || verified.OriginalTransactionId is null)
            throw new ArgumentException("Only verified purchases can be applied.", nameof(verified));

        var kind = KindOf(verified);
        if (kind is null)
            return (null, PurchaseApplyOutcome.UnknownProduct);

        var tenantId = await ResolveTenantAsync(platform, verified.OriginalTransactionId, verified.AccountToken, ct);
        if (tenantId is null)
        {
            _logger.LogInformation("Store event for {Platform} purchase {Key} has no Droblet account; ignored", platform, verified.OriginalTransactionId);
            return (null, PurchaseApplyOutcome.OwnedByAnotherAccount);
        }
        if (!await ClaimAsync(tenantId, platform, verified.OriginalTransactionId, ct))
            return (null, PurchaseApplyOutcome.OwnedByAnotherAccount);

        if (action == StoreNotificationAction.Revoke)
        {
            await RevokeAsync(tenantId, platform, verified.OriginalTransactionId, kind.Value, verified.RevokedAt ?? Now, verified.EventAt, ct);
            return (tenantId, PurchaseApplyOutcome.Revoked);
        }
        if (verified.State == StoreSubscriptionState.Pending)
            return (tenantId, PurchaseApplyOutcome.Pending);
        return (tenantId, await WriteAsync(tenantId, platform, verified, kind.Value, ct));
    }

    public async Task<string?> RevokeByKeyAsync(StorePlatform platform, string key, DateTime revokedAt, CancellationToken ct)
    {
        var tenantId = await ResolveTenantAsync(platform, key, null, ct);
        if (tenantId is null)
            return null;
        var purchase = await repository.GetAsync<StorePurchaseEntity>(StorePurchaseEntity.GetPk(tenantId), StorePurchaseEntity.GetSk(platform, key), ct);
        var kind = purchase?.Kind ?? StoreProductKind.Subscription;
        await RevokeAsync(tenantId, platform, key, kind, revokedAt, null, ct);
        return tenantId;
    }

    // ── writes ───────────────────────────────────────────────────────────────────────────────────────────────────

    private async Task<PurchaseApplyOutcome> WriteAsync(string tenantId, StorePlatform platform, PurchaseVerificationResult verified, StoreProductKind kind, CancellationToken ct)
    {
        var key = verified.OriginalTransactionId!;
        var now = Now;
        var purchase = await repository.GetAsync<StorePurchaseEntity>(StorePurchaseEntity.GetPk(tenantId), StorePurchaseEntity.GetSk(platform, key), ct)
                       ?? new StorePurchaseEntity { TenantId = tenantId, Platform = platform, Key = key, Kind = kind, CreatedAt = now };
        purchase.ProductId = verified.ProductId!;
        purchase.TransactionId = verified.TransactionId ?? purchase.TransactionId;
        purchase.PurchaseToken = verified.PurchaseToken ?? purchase.PurchaseToken;
        purchase.Environment = verified.Environment ?? purchase.Environment;
        purchase.UpdatedAt = now;

        if (kind == StoreProductKind.Consumable)
        {
            if (verified.State == StoreSubscriptionState.Revoked)
            {
                await repository.SaveAsync(purchase, ct);
                await RevokeAsync(tenantId, platform, key, kind, verified.RevokedAt ?? now, verified.EventAt, ct);
                return PurchaseApplyOutcome.Revoked;
            }
            if (purchase.CreditsGranted)
                return PurchaseApplyOutcome.CreditsAdded; // the same purchase never adds credits twice

            purchase.Credits = store.CurrentValue.CreditPacks[verified.ProductId!] * Math.Max(1, verified.Quantity);
            await repository.SaveAsync(purchase, ct);
            // The receipt inside AddPackCredits dedupes a concurrent second call; the flag below is the permanent guard.
            await credits.AddPackCreditsAsync(tenantId, purchase.Credits, $"{platform}:{key}", ct);
            purchase.CreditsGranted = true;
            purchase.UpdatedAt = Now;
            await repository.SaveAsync(purchase, ct);
            return PurchaseApplyOutcome.CreditsAdded;
        }

        await repository.SaveAsync(purchase, ct);
        if (verified.Superseded)
            return PurchaseApplyOutcome.SubscriptionActivated; // the upgraded-to transaction carries the state

        var existing = await repository.GetAsync<EntitlementEntity>(EntitlementEntity.GetPk(tenantId), EntitlementEntity.GetSk(EntitlementSource.Store, key), ct);
        if (StoreRules.IsStale(existing?.LastEventAt, verified.EventAt))
            return PurchaseApplyOutcome.Stale;

        // Play upgrade / downgrade: a new token replaces the linked one; the credit month keeps its anchor.
        EntitlementEntity? replaced = null;
        if (verified.LinkedOriginalTransactionId is { } linkedKey && linkedKey != key)
        {
            replaced = await repository.GetAsync<EntitlementEntity>(EntitlementEntity.GetPk(tenantId), EntitlementEntity.GetSk(EntitlementSource.Store, linkedKey), ct);
            if (replaced is not null && (replaced.ExpiresAt is null || replaced.ExpiresAt > now))
            {
                replaced.ExpiresAt = now;
                replaced.State = StoreSubscriptionState.Expired;
                replaced.UpdatedAt = now;
                await repository.SaveAsync(replaced, ct);
            }
        }

        var anchor = existing?.PeriodAnchor ?? replaced?.PeriodAnchor ?? verified.PurchasedAt ?? now;
        await repository.SaveAsync(new EntitlementEntity
        {
            Id = key,
            TenantId = tenantId,
            Tier = Tier.Premium,
            Source = EntitlementSource.Store,
            Platform = platform,
            ProductId = verified.ProductId,
            StartsAt = existing?.StartsAt ?? replaced?.StartsAt ?? verified.PurchasedAt ?? now,
            // A subscription always has an end; a payload without one grants nothing rather than forever.
            ExpiresAt = verified.ExpiresAt ?? now,
            PeriodAnchor = anchor,
            State = verified.State,
            Environment = verified.Environment ?? existing?.Environment,
            LastEventAt = verified.EventAt ?? existing?.LastEventAt,
            UpdatedAt = now,
        }, ct);
        return verified.State == StoreSubscriptionState.Revoked ? PurchaseApplyOutcome.Revoked : PurchaseApplyOutcome.SubscriptionActivated;
    }

    private async Task RevokeAsync(string tenantId, StorePlatform platform, string key, StoreProductKind kind, DateTime revokedAt, DateTime? eventAt, CancellationToken ct)
    {
        var now = Now;
        var purchase = await repository.GetAsync<StorePurchaseEntity>(StorePurchaseEntity.GetPk(tenantId), StorePurchaseEntity.GetSk(platform, key), ct);

        if (kind == StoreProductKind.Consumable)
        {
            if (purchase is null || !purchase.CreditsGranted || purchase.CreditsRevoked)
                return;
            var removed = await credits.RemovePackCreditsAsync(tenantId, purchase.Credits, $"{platform}:{key}", ct);
            purchase.CreditsRevoked = true;
            purchase.RevokedAt = revokedAt;
            purchase.UpdatedAt = now;
            await repository.SaveAsync(purchase, ct);
            _logger.LogInformation("Refunded pack {Key}: {Removed} credits removed for tenant {TenantId}", key, removed, tenantId);
            return;
        }

        if (purchase is not null)
        {
            purchase.RevokedAt = revokedAt;
            purchase.UpdatedAt = now;
            await repository.SaveAsync(purchase, ct);
        }

        var entitlement = await repository.GetAsync<EntitlementEntity>(EntitlementEntity.GetPk(tenantId), EntitlementEntity.GetSk(EntitlementSource.Store, key), ct);
        if (entitlement is null)
            return;
        entitlement.ExpiresAt = entitlement.ExpiresAt is { } expires && expires < revokedAt ? expires : revokedAt;
        entitlement.State = StoreSubscriptionState.Revoked;
        entitlement.LastEventAt = eventAt is { } at && (entitlement.LastEventAt is null || at > entitlement.LastEventAt) ? at : entitlement.LastEventAt;
        entitlement.UpdatedAt = now;
        await repository.SaveAsync(entitlement, ct);
        _logger.LogInformation("Revoked subscription {Key} for tenant {TenantId}", key, tenantId);
    }

    // ── ownership ────────────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>First verified claim wins. A claim by a deleted account is released to the next one.</summary>
    private async Task<bool> ClaimAsync(string tenantId, StorePlatform platform, string key, CancellationToken ct)
    {
        for (var attempt = 0; attempt < 3; attempt++)
        {
            var index = await repository.GetAsync<StorePurchaseIndexEntity>(StorePurchaseIndexEntity.GetPk(), StorePurchaseIndexEntity.GetSk(platform, key), ct);
            if (index is not null)
            {
                if (index.TenantId == tenantId)
                    return true;
                if (await TenantExistsAsync(index.TenantId, ct))
                    return false;
                index.TenantId = tenantId;
                index.CreatedAt = Now;
                await repository.SaveAsync(index, ct);
                return true;
            }

            var created = await repository.TransactWriteAsync(
                [TransactWriteOperation.Create(new StorePurchaseIndexEntity { Platform = platform, Key = key, TenantId = tenantId, CreatedAt = Now })], ct);
            if (created.Applied)
                return true;
        }
        return false;
    }

    private async Task<string?> ResolveTenantAsync(StorePlatform platform, string key, string? accountToken, CancellationToken ct)
    {
        var index = await repository.GetAsync<StorePurchaseIndexEntity>(StorePurchaseIndexEntity.GetPk(), StorePurchaseIndexEntity.GetSk(platform, key), ct);
        if (index is not null && await TenantExistsAsync(index.TenantId, ct))
            return index.TenantId;
        var fromToken = StoreAccountToken.TryTenantId(accountToken);
        return fromToken is not null && await TenantExistsAsync(fromToken, ct) ? fromToken : null;
    }

    private async Task<bool> TenantExistsAsync(string tenantId, CancellationToken ct) =>
        await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(tenantId), ct) is not null;

    private StoreProductKind? KindOf(PurchaseVerificationResult verified)
    {
        var options = store.CurrentValue;
        if (options.ProductIds.Premium.Contains(verified.ProductId!))
            return StoreProductKind.Subscription;
        return options.CreditPacks.TryGetValue(verified.ProductId!, out var credits) && credits > 0 ? StoreProductKind.Consumable : null;
    }
}
