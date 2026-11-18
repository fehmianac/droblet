using Domain.Entity;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Infrastructure.Services.Store;

/// <summary>
/// Decision 10 (2026-11-19): when the user went to a brand's site and no conversion arrived within
/// <see cref="CatalogOptions.WatchAutoAddHours"/>, the clicked products drop onto the watch list on their own.
/// Runs with the Notifier's 15-minute pass over the candidate buckets that are due. Idempotent: a product already on
/// the list, bought (a conversion of the click or of the product), already in the wardrobe, removed by the user after
/// the click, retired or unknown is skipped; the candidate row is deleted once handled.
/// </summary>
public sealed class WatchListAutoAdd(
    IRepository repository,
    IOptionsMonitor<CatalogOptions> options,
    ILogger<WatchListAutoAdd> logger) : IWatchListAutoAdd
{
    /// <summary>Due buckets older than this are not read any more (their rows expire by TTL).</summary>
    public const int LookBackHours = 24;

    public async Task<int> RunAsync(DateTime nowUtc, CancellationToken ct)
    {
        var added = 0;
        for (var hour = 0; hour <= LookBackHours && !ct.IsCancellationRequested; hour++)
        {
            foreach (var candidate in await repository.GetAllAsync<WatchAutoAddCandidateEntity>(WatchAutoAddCandidateEntity.GetPk(nowUtc.AddHours(-hour)), ct))
            {
                if (candidate.DueAt > nowUtc)
                    continue; // same hour, a few minutes later
                added += await ProcessAsync(candidate, nowUtc, ct);
                await repository.DeleteAsync(candidate.Pk, candidate.Sk, ct);
            }
        }
        return added;
    }

    private async Task<int> ProcessAsync(WatchAutoAddCandidateEntity candidate, DateTime now, CancellationToken ct)
    {
        var tenantId = candidate.TenantId;
        if (await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(tenantId), ct) is null)
            return 0; // account deleted meanwhile

        var conversions = await repository.GetAllAsync<AffiliateConversionEntity>(AffiliateConversionEntity.GetPk(tenantId), ct);
        if (conversions.Any(c => c.ClickId == candidate.ClickId))
            return 0; // the click converted: nothing to remind about
        var purchased = conversions.SelectMany(c => c.ProductIds).ToHashSet(StringComparer.Ordinal);
        var owned = (await repository.GetAllAsync<ItemEntity>(ItemEntity.GetPk(tenantId), ct))
            .Where(i => i.ProductId is not null).Select(i => i.ProductId!).ToHashSet(StringComparer.Ordinal);

        var watchPk = WatchItemEntity.GetPk(tenantId);
        var watchCount = (await repository.GetKeysAsync(watchPk, ct)).Count;
        var added = 0;
        foreach (var productId in candidate.ProductIds.Distinct(StringComparer.Ordinal))
        {
            if (purchased.Contains(productId) || owned.Contains(productId))
                continue;
            if (watchCount >= options.CurrentValue.MaxWatchItems)
                break;
            if (await repository.GetAsync<WatchItemEntity>(watchPk, WatchItemEntity.GetSk(productId), ct) is not null)
                continue;
            var removed = await repository.GetAsync<WatchRemovedEntity>(WatchRemovedEntity.GetPk(tenantId), WatchRemovedEntity.GetSk(productId), ct);
            if (removed is not null && removed.RemovedAt >= candidate.ClickedAt)
                continue;
            var product = await repository.GetAsync<CatalogProductEntity>(CatalogProductEntity.GetPk(), CatalogProductEntity.GetSk(productId), ct);
            if (product is null || product.Retired)
                continue;

            var item = AutoWatchItem(tenantId, product, now);
            var result = await repository.TransactWriteAsync(
            [
                TransactWriteOperation.Create(item), // a concurrent manual add wins
                TransactWriteOperation.Put(new ProductWatcherEntity { ProductId = productId, WatcherTenantId = tenantId }),
            ], ct);
            if (!result.Applied)
                continue;
            watchCount++;
            added++;
        }

        if (added > 0)
            logger.LogInformation("Watch-list auto-add: {Count} products for tenant {TenantId} from click {ClickId}", added, tenantId, candidate.ClickId);
        return added;
    }

    private static WatchItemEntity AutoWatchItem(string tenantId, CatalogProductEntity product, DateTime now) => new()
    {
        TenantId = tenantId,
        ProductId = product.Id,
        PriceAtAddMinor = product.PriceMinor,
        AddedAt = now,
    };
}
