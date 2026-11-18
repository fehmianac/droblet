using Domain.Entity;
using Domain.Enum;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Microsoft.Extensions.Options;

namespace Infrastructure.Services;

public enum PurchaseApplyOutcome { SubscriptionActivated, CreditsAdded, UnknownProduct }

public interface IPurchaseService
{
    /// <summary>Applies a store-verified purchase. Only ever called with a Verified result from IPurchaseVerifier.</summary>
    Task<PurchaseApplyOutcome> ApplyAsync(string tenantId, StorePlatform platform, PurchaseVerificationResult verified, CancellationToken ct);
}

/// <summary>Maps product ids (Store.ProductIds / Store.CreditPacks in config) to an entitlement or pack credits. Prices never live on the server.</summary>
public sealed class PurchaseService(IRepository repository, ICreditService credits, IOptionsMonitor<StoreOptions> store, TimeProvider timeProvider) : IPurchaseService
{
    public async Task<PurchaseApplyOutcome> ApplyAsync(string tenantId, StorePlatform platform, PurchaseVerificationResult verified, CancellationToken ct)
    {
        if (verified.Status != PurchaseVerificationStatus.Verified || verified.ProductId is null || verified.OriginalTransactionId is null)
            throw new ArgumentException("Only verified purchases can be applied.", nameof(verified));

        var options = store.CurrentValue;
        var now = timeProvider.GetUtcNow().UtcDateTime;

        if (options.ProductIds.Premium.Contains(verified.ProductId))
        {
            var existing = await repository.GetAsync<EntitlementEntity>(
                EntitlementEntity.GetPk(tenantId), EntitlementEntity.GetSk(EntitlementSource.Store, verified.OriginalTransactionId), ct);
            await repository.SaveAsync(new EntitlementEntity
            {
                Id = verified.OriginalTransactionId,
                TenantId = tenantId,
                Tier = Tier.Premium,
                Source = EntitlementSource.Store,
                Platform = platform,
                ProductId = verified.ProductId,
                StartsAt = existing?.StartsAt ?? verified.PurchasedAt ?? now,
                ExpiresAt = verified.ExpiresAt,
                PeriodAnchor = existing?.PeriodAnchor ?? verified.PurchasedAt ?? now,
                UpdatedAt = now,
            }, ct);
            return PurchaseApplyOutcome.SubscriptionActivated;
        }

        if (options.CreditPacks.TryGetValue(verified.ProductId, out var packCredits) && packCredits > 0)
        {
            await credits.AddPackCreditsAsync(tenantId, packCredits, $"{platform}:{verified.OriginalTransactionId}", ct);
            return PurchaseApplyOutcome.CreditsAdded;
        }

        return PurchaseApplyOutcome.UnknownProduct;
    }
}
