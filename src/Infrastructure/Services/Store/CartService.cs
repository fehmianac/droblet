using Domain.Domain;
using Domain.Entity;
using Domain.Entity.Base;
using Domain.Extensions;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Microsoft.Extensions.Options;

namespace Infrastructure.Services.Store;

/// <summary>
/// Cart (grouped by brand) and watch list. No payment data, no stored prices: totals are computed from the current
/// catalog on every read (BACKEND_ENGINEER.md rules 20–21).
/// </summary>
public sealed class CartService(
    IRepository repository,
    ICatalogService catalog,
    IAnalyticsService analytics,
    IOptionsMonitor<CatalogOptions> options,
    TimeProvider timeProvider) : ICartService
{
    public const string OneSize = "ONE";

    private DateTime Now => timeProvider.GetUtcNow().UtcDateTime;

    public async Task<CartDto> GetAsync(string tenantId, CancellationToken ct)
    {
        var lines = await repository.GetAllAsync<CartLineEntity>(CartLineEntity.GetPk(tenantId), ct);
        var brandNames = await catalog.GetBrandNamesAsync(ct);

        var groups = new List<CartGroupDto>();
        foreach (var group in lines.GroupBy(l => l.BrandId))
        {
            var dtos = new List<CartLineDto>();
            foreach (var line in group.OrderBy(l => l.AddedAt).ThenBy(l => l.LineId, StringComparer.Ordinal))
            {
                if (await catalog.GetProductAsync(line.ProductId, ct) is not { } product)
                    continue;
                dtos.Add(new CartLineDto(line.LineId, await catalog.ToDtoAsync(product, ct), line.Size,
                    StoreDtoMapper.ToLookRef(line.LookKind, line.LookId), line.AddedAt));
            }
            if (dtos.Count > 0)
                groups.Add(new CartGroupDto(group.Key, brandNames.GetValueOrDefault(group.Key) ?? group.Key, dtos, StoreDtoMapper.Total(dtos.Select(d => d.Product))));
        }

        groups = groups.OrderBy(g => g.BrandName, StringComparer.OrdinalIgnoreCase).ToList();
        return new CartDto(groups, groups.Sum(g => g.Lines.Count), groups.Sum(g => g.SubtotalMinor), StoreDtoMapper.Currency);
    }

    public async Task<CartResult> AddLinesAsync(string tenantId, IReadOnlyList<CartLineInput> lines, CancellationToken ct)
    {
        var now = Now;
        var existing = (await repository.GetKeysAsync(CartLineEntity.GetPk(tenantId), ct)).Select(k => k.Sk).ToHashSet(StringComparer.Ordinal);
        var additions = new Dictionary<string, CartLineEntity>(StringComparer.Ordinal);

        for (var i = 0; i < lines.Count; i++)
        {
            var input = lines[i];
            var product = await catalog.GetProductAsync(input.ProductId, ct);
            if (product is null)
                return new CartResult(CartOutcome.ProductNotFound, FailedIndex: i);
            if (product.Retired)
                return new CartResult(CartOutcome.ProductRetired, FailedIndex: i);
            if (ResolveSize(product, input.Size) is not { } size)
                return new CartResult(CartOutcome.SizeNotAvailable, FailedIndex: i);

            var line = new CartLineEntity
            {
                LineId = Ulid.New(now),
                TenantId = tenantId,
                BrandId = product.BrandId,
                ProductId = product.Id,
                Size = size,
                LookKind = input.Look?.Kind,
                LookId = input.Look?.Id,
                ClientMutationId = input.ClientMutationId,
                AddedAt = now,
            };
            // Same product + size again (offline replay, double tap) keeps the existing line.
            if (!existing.Contains(line.Sk))
                additions.TryAdd(line.Sk, line);
        }

        if (existing.Count + additions.Count > options.CurrentValue.MaxCartLines)
            return new CartResult(CartOutcome.CartFull);

        if (additions.Count > 0)
            await repository.BatchWriteAsync(additions.Values.Cast<IEntity>().ToList(), ct);

        foreach (var line in additions.Values)
        {
            await analytics.RecordServerEventAsync(AnalyticsRules.AddToCart, tenantId, new Dictionary<string, string?>
            {
                ["productId"] = line.ProductId,
                ["brandId"] = line.BrandId,
                ["lookKind"] = line.LookKind?.ToString().ToLowerInvariant(),
                ["lookId"] = line.LookId,
            }, ct);
        }

        return new CartResult(CartOutcome.Ok, await GetAsync(tenantId, ct));
    }

    public async Task<bool> RemoveLineAsync(string tenantId, string lineId, CancellationToken ct)
    {
        var lines = await repository.GetAllAsync<CartLineEntity>(CartLineEntity.GetPk(tenantId), ct);
        var line = lines.FirstOrDefault(l => l.LineId == lineId);
        if (line is null)
            return false;
        await repository.DeleteAsync(line.Pk, line.Sk, ct);
        return true;
    }

    /// <summary>Products with sizes need one of them; products without sizes (bags, accessories) are stored as ONE.</summary>
    public static string? ResolveSize(CatalogProductEntity product, string? requested)
    {
        if (product.Sizes.Count == 0)
            return OneSize;
        if (string.IsNullOrWhiteSpace(requested))
            return null;
        var size = CatalogRules.NormalizeSize(requested);
        return product.Sizes.Contains(size) ? size : null;
    }

    // ── Watch list ──────────────────────────────────────────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<WatchItemDto>> GetWatchListAsync(string tenantId, CancellationToken ct)
    {
        var items = await repository.GetAllAsync<WatchItemEntity>(WatchItemEntity.GetPk(tenantId), ct);
        var result = new List<WatchItemDto>();
        foreach (var item in items.OrderByDescending(i => i.AddedAt))
        {
            if (await ToDtoAsync(item, ct) is { } dto)
                result.Add(dto);
        }
        return result;
    }

    public async Task<(CartOutcome Outcome, WatchItemDto? Item)> WatchAsync(string tenantId, string productId, string? size, LookRefDto? look, CancellationToken ct)
    {
        var product = await catalog.GetProductAsync(productId, ct);
        if (product is null)
            return (CartOutcome.ProductNotFound, null);

        var pk = WatchItemEntity.GetPk(tenantId);
        var existing = await repository.GetAsync<WatchItemEntity>(pk, WatchItemEntity.GetSk(productId), ct);
        if (existing is not null)
            return (CartOutcome.Ok, await ToDtoAsync(existing, ct));

        if (product.Retired)
            return (CartOutcome.ProductRetired, null);
        if ((await repository.GetKeysAsync(pk, ct)).Count >= options.CurrentValue.MaxWatchItems)
            return (CartOutcome.WatchListFull, null);

        var item = new WatchItemEntity
        {
            TenantId = tenantId,
            ProductId = productId,
            Size = string.IsNullOrWhiteSpace(size) ? null : CatalogRules.NormalizeSize(size),
            LookKind = look?.Kind,
            LookId = look?.Id,
            PriceAtAddMinor = product.PriceMinor,
            AddedAt = Now,
        };
        await repository.TransactWriteAsync(
        [
            TransactWriteOperation.Put(item),
            TransactWriteOperation.Put(new ProductWatcherEntity { ProductId = productId, WatcherTenantId = tenantId }),
        ], ct);
        return (CartOutcome.Ok, await ToDtoAsync(item, ct));
    }

    public async Task<bool> UnwatchAsync(string tenantId, string productId, CancellationToken ct)
    {
        var pk = WatchItemEntity.GetPk(tenantId);
        if (await repository.GetAsync<WatchItemEntity>(pk, WatchItemEntity.GetSk(productId), ct) is null)
            return false;
        await repository.TransactWriteAsync(
        [
            TransactWriteOperation.Delete(pk, WatchItemEntity.GetSk(productId)),
            TransactWriteOperation.Delete(ProductWatcherEntity.GetPk(productId), ProductWatcherEntity.GetSk(tenantId)),
            // The auto-add pass (decision 10) must not bring back what the user removed.
            TransactWriteOperation.Put(new WatchRemovedEntity { TenantId = tenantId, ProductId = productId, RemovedAt = Now }),
        ], ct);
        return true;
    }

    // ── Favourite products ──────────────────────────────────────────────────────────────────────────────────────

    public async Task<FavoriteProductsDto> GetFavoriteProductsAsync(string tenantId, CancellationToken ct)
    {
        var favorites = await repository.GetAllAsync<FavoriteProductEntity>(FavoriteProductEntity.GetPk(tenantId), ct);
        var ids = new List<string>();
        foreach (var favorite in favorites.OrderByDescending(f => f.AddedAt).ThenBy(f => f.ProductId, StringComparer.Ordinal))
        {
            if (await catalog.GetProductAsync(favorite.ProductId, ct) is not null)
                ids.Add(favorite.ProductId);
        }
        return new FavoriteProductsDto(ids);
    }

    public async Task<CartOutcome> AddFavoriteProductAsync(string tenantId, string productId, CancellationToken ct)
    {
        var product = await catalog.GetProductAsync(productId, ct);
        if (product is null)
            return CartOutcome.ProductNotFound;

        var pk = FavoriteProductEntity.GetPk(tenantId);
        if (await repository.GetAsync<FavoriteProductEntity>(pk, FavoriteProductEntity.GetSk(productId), ct) is not null)
            return CartOutcome.Ok;

        if (product.Retired)
            return CartOutcome.ProductRetired;
        if ((await repository.GetKeysAsync(pk, ct)).Count >= options.CurrentValue.MaxFavoriteProducts)
            return CartOutcome.FavoriteListFull;

        await repository.SaveAsync(new FavoriteProductEntity { TenantId = tenantId, ProductId = productId, AddedAt = Now }, ct);
        return CartOutcome.Ok;
    }

    public Task RemoveFavoriteProductAsync(string tenantId, string productId, CancellationToken ct) =>
        repository.DeleteAsync(FavoriteProductEntity.GetPk(tenantId), FavoriteProductEntity.GetSk(productId), ct);

    private async Task<WatchItemDto?> ToDtoAsync(WatchItemEntity item, CancellationToken ct)
    {
        if (await catalog.GetProductAsync(item.ProductId, ct) is not { } product)
            return null;
        // Computed from the current price, so a later price rise clears the badge without another write.
        var dropped = CatalogRules.IsPriceDrop(item.PriceAtAddMinor, product.PriceMinor);
        return new WatchItemDto(await catalog.ToDtoAsync(product, ct), item.Size, StoreDtoMapper.ToLookRef(item.LookKind, item.LookId),
            item.PriceAtAddMinor, product.PriceMinor, dropped, dropped ? item.PriceAtAddMinor - product.PriceMinor : 0, item.AddedAt);
    }
}
