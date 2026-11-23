using Domain.Domain;
using Domain.Entity;
using Domain.Enum;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Domain.Validation;
using FluentValidation;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Infrastructure.Services.Store;

/// <summary>
/// Global catalog. Phase 1 is a small admin-managed catalog (README §9.1), so the product partition is cached per
/// Lambda instance for Catalog:CacheSeconds; writes through this service invalidate the local cache.
/// Brands and products are never deleted — they are retired (carts, looks and wardrobe items point at them).
/// </summary>
public sealed class CatalogService(
    IRepository repository,
    IOptionsMonitor<CatalogOptions> options,
    IValidator<ProductInput> productValidator,
    IRequestLanguage requestLanguage,
    TimeProvider timeProvider,
    ILogger<CatalogService> logger) : ICatalogService
{
    private sealed record Snapshot(
        DateTime LoadedAt,
        IReadOnlyList<BrandEntity> Brands,
        IReadOnlyList<CatalogProductEntity> Products,
        Dictionary<string, CatalogProductEntity> ProductsById,
        Dictionary<string, string> BrandNames);

    private volatile Snapshot? _snapshot;

    private DateTime Now => timeProvider.GetUtcNow().UtcDateTime;

    public void InvalidateCache() => _snapshot = null;

    private async Task<Snapshot> LoadAsync(CancellationToken ct)
    {
        var current = _snapshot;
        var now = Now;
        if (current is not null && now - current.LoadedAt < TimeSpan.FromSeconds(options.CurrentValue.CacheSeconds))
            return current;

        var brands = await repository.GetAllAsync<BrandEntity>(BrandEntity.GetPk(), ct);
        var products = await repository.GetAllAsync<CatalogProductEntity>(CatalogProductEntity.GetPk(), ct);
        var snapshot = new Snapshot(now, brands, products,
            products.ToDictionary(p => p.Id, StringComparer.Ordinal),
            brands.ToDictionary(b => b.Id, b => b.Name, StringComparer.Ordinal));
        _snapshot = snapshot;
        return snapshot;
    }

    public async Task<IReadOnlyList<BrandEntity>> GetBrandsAsync(CancellationToken ct) => (await LoadAsync(ct)).Brands;

    public async Task<BrandEntity?> GetBrandAsync(string brandId, CancellationToken ct) =>
        (await LoadAsync(ct)).Brands.FirstOrDefault(b => b.Id == brandId);

    public async Task<IReadOnlyList<CatalogProductEntity>> GetProductsAsync(CancellationToken ct) => (await LoadAsync(ct)).Products;

    public async Task<CatalogProductEntity?> GetProductAsync(string productId, CancellationToken ct) =>
        (await LoadAsync(ct)).ProductsById.GetValueOrDefault(productId);

    public async Task<IReadOnlyDictionary<string, string>> GetBrandNamesAsync(CancellationToken ct) => (await LoadAsync(ct)).BrandNames;

    public async Task<IReadOnlyList<ProductDto>> ToDtosAsync(IEnumerable<string> productIds, CancellationToken ct)
    {
        var snapshot = await LoadAsync(ct);
        var language = await requestLanguage.GetAsync(ct);
        return productIds
            .Select(id => snapshot.ProductsById.GetValueOrDefault(id))
            .Where(p => p is not null)
            .Select(p => p!.ToDto(snapshot.BrandNames.GetValueOrDefault(p!.BrandId), language, requestLanguage.Default))
            .ToList();
    }

    public async Task<ProductDto> ToDtoAsync(CatalogProductEntity product, CancellationToken ct) =>
        product.ToDto((await LoadAsync(ct)).BrandNames.GetValueOrDefault(product.BrandId), await requestLanguage.GetAsync(ct), requestLanguage.Default);

    // ── Admin / seed ────────────────────────────────────────────────────────────────────────────────────────────

    public async Task<(CatalogWriteOutcome Outcome, BrandEntity Brand)> UpsertBrandAsync(BrandInput input, CancellationToken ct)
    {
        var now = Now;
        var existing = await repository.GetAsync<BrandEntity>(BrandEntity.GetPk(), BrandEntity.GetSk(input.Id), ct);
        var brand = new BrandEntity
        {
            Id = input.Id,
            Name = input.Name.Trim(),
            WebsiteUrl = NullIfEmpty(input.WebsiteUrl),
            LogoUrl = NullIfEmpty(input.LogoUrl),
            Source = input.Source,
            Network = NullIfEmpty(input.Network),
            CheckoutUrl = NullIfEmpty(input.CheckoutUrl),
            ClickIdParameter = NullIfEmpty(input.ClickIdParameter),
            CommissionRateBps = input.CommissionRateBps,
            Retired = input.Retired,
            CreatedAt = existing?.CreatedAt ?? now,
            UpdatedAt = now,
        };
        await repository.SaveAsync(brand, ct);
        InvalidateCache();
        return (existing is null ? CatalogWriteOutcome.Created : CatalogWriteOutcome.Updated, brand);
    }

    public async Task<bool> RetireBrandAsync(string brandId, CancellationToken ct)
    {
        var brand = await repository.GetAsync<BrandEntity>(BrandEntity.GetPk(), BrandEntity.GetSk(brandId), ct);
        if (brand is null)
            return false;
        brand.Retired = true;
        brand.UpdatedAt = Now;
        await repository.SaveAsync(brand, ct);
        InvalidateCache();
        return true;
    }

    public async Task<ProductWriteResult> UpsertProductAsync(ProductInput input, CancellationToken ct)
    {
        var brand = await repository.GetAsync<BrandEntity>(BrandEntity.GetPk(), BrandEntity.GetSk(input.BrandId), ct);
        if (brand is null)
            return new ProductWriteResult(CatalogWriteOutcome.BrandNotFound);

        var existing = await repository.GetAsync<CatalogProductEntity>(CatalogProductEntity.GetPk(), CatalogProductEntity.GetSk(input.Id), ct);
        var product = Map(input, brand, existing, Now);
        await repository.SaveAsync(product, ct);
        InvalidateCache();

        var dropped = existing is not null && CatalogRules.IsPriceDrop(existing.PriceMinor, product.PriceMinor);
        var flagged = dropped ? await FlagPriceDropAsync(product, ct) : 0;
        return new ProductWriteResult(existing is null ? CatalogWriteOutcome.Created : CatalogWriteOutcome.Updated, product, dropped, flagged);
    }

    public async Task<bool> RetireProductAsync(string productId, CancellationToken ct)
    {
        var product = await repository.GetAsync<CatalogProductEntity>(CatalogProductEntity.GetPk(), CatalogProductEntity.GetSk(productId), ct);
        if (product is null)
            return false;
        product.Retired = true;
        product.UpdatedAt = Now;
        await repository.SaveAsync(product, ct);
        InvalidateCache();
        return true;
    }

    public async Task<BulkUpsertResult> BulkUpsertProductsAsync(IReadOnlyList<ProductInput> inputs, CancellationToken ct, bool dryRun = false)
    {
        var now = Now;
        var brands = (await repository.GetAllAsync<BrandEntity>(BrandEntity.GetPk(), ct)).ToDictionary(b => b.Id, StringComparer.Ordinal);
        var existing = (await repository.GetAllAsync<CatalogProductEntity>(CatalogProductEntity.GetPk(), ct)).ToDictionary(p => p.Id, StringComparer.Ordinal);

        var rows = new List<BulkRowResult>(inputs.Count);
        var writes = new Dictionary<string, CatalogProductEntity>(StringComparer.Ordinal);
        var drops = new List<CatalogProductEntity>();
        int created = 0, updated = 0, failed = 0;

        for (var i = 0; i < inputs.Count; i++)
        {
            var input = inputs[i];
            var validation = input is null ? null : await productValidator.ValidateAsync(input, ct);
            if (input is null || validation is null || !validation.IsValid)
            {
                failed++;
                rows.Add(new BulkRowResult(i, input?.Id, "invalid", validation?.Errors
                    .GroupBy(e => char.ToLowerInvariant(e.PropertyName[0]) + e.PropertyName[1..])
                    .ToDictionary(g => g.Key, g => g.Select(e => e.ErrorCode).Distinct().ToArray())));
                continue;
            }
            if (!brands.TryGetValue(input.BrandId, out var brand))
            {
                failed++;
                rows.Add(new BulkRowResult(i, input.Id, Domain.Constant.StoreSocialErrorCodes.BrandNotFound));
                continue;
            }
            if (writes.ContainsKey(input.Id))
            {
                failed++;
                rows.Add(new BulkRowResult(i, input.Id, "duplicate_id"));
                continue;
            }

            existing.TryGetValue(input.Id, out var previous);
            var product = Map(input, brand, previous, now);
            writes[product.Id] = product;
            if (previous is not null && CatalogRules.IsPriceDrop(previous.PriceMinor, product.PriceMinor))
                drops.Add(product);
            if (previous is null) created++; else updated++;
            rows.Add(new BulkRowResult(i, input.Id, previous is null ? "created" : "updated"));
        }

        if (dryRun)
            return new BulkUpsertResult(created, updated, failed, rows); // validation preview: nothing is written

        if (writes.Count > 0)
            await repository.BatchWriteAsync(writes.Values.Cast<Domain.Entity.Base.IEntity>().ToList(), ct);
        InvalidateCache();

        foreach (var product in drops)
            await FlagPriceDropAsync(product, ct);

        logger.LogInformation("Catalog bulk upsert: {Created} created, {Updated} updated, {Failed} failed, {Drops} price drops", created, updated, failed, drops.Count);
        return new BulkUpsertResult(created, updated, failed, rows);
    }

    /// <summary>Price went down: every watch-list row of the product gets the price-drop flag (and a pending notification).</summary>
    private async Task<int> FlagPriceDropAsync(CatalogProductEntity product, CancellationToken ct)
    {
        var watchers = await repository.GetAllAsync<ProductWatcherEntity>(ProductWatcherEntity.GetPk(product.Id), ct);
        var flagged = 0;
        foreach (var watcher in watchers)
        {
            var item = await repository.GetAsync<WatchItemEntity>(WatchItemEntity.GetPk(watcher.WatcherTenantId), WatchItemEntity.GetSk(product.Id), ct);
            if (item is null || !CatalogRules.IsPriceDrop(item.PriceAtAddMinor, product.PriceMinor))
                continue;
            item.PriceDropped = true;
            item.DroppedToMinor = product.PriceMinor;
            item.DroppedAt = product.UpdatedAt;
            item.NotifyPending = true;
            await repository.SaveAsync(item, ct);
            // Outbox row for the price_drop push; the Notifier re-checks the preference and the item's bell before sending.
            await repository.SaveAsync(new NotificationQueueEntity
            {
                Type = NotificationType.PriceDrop, TenantId = watcher.WatcherTenantId, Key = product.Id, CreatedAt = Now,
            }, ct);
            flagged++;
        }
        return flagged;
    }

    private static CatalogProductEntity Map(ProductInput input, BrandEntity brand, CatalogProductEntity? existing, DateTime now)
    {
        var priceChanged = existing is not null && existing.PriceMinor != input.PriceMinor;
        return new CatalogProductEntity
        {
            Id = input.Id,
            BrandId = input.BrandId,
            Name = LocalizedText.Normalize(input.Name),
            Description = LocalizedText.NormalizeOptional(input.Description),
            Category = input.Category,
            Colors = (input.Colors ?? []).Select(CatalogRules.NormalizeColor).Distinct().ToList(),
            Sizes = (input.Sizes ?? []).Select(CatalogRules.NormalizeSize).Distinct().ToList(),
            PriceMinor = input.PriceMinor,
            Currency = StoreDtoMapper.Currency,
            PreviousPriceMinor = priceChanged ? existing!.PriceMinor : existing?.PreviousPriceMinor,
            PriceChangedAt = priceChanged ? now : existing?.PriceChangedAt,
            PriceBand = input.PriceBand,
            Images = (input.Images ?? []).ToList(),
            AffiliateUrl = NullIfEmpty(input.AffiliateUrl),
            AffiliateSource = input.AffiliateSource ?? brand.Source,
            Retired = input.Retired,
            // Omitted = unchanged on an update (feeds without the column keep the admin's choice), women on create.
            Segment = input.Segment ?? existing?.Segment ?? CatalogSegment.Women,
            // Only meaningful without a size list; a product that gets sizes loses the flag.
            SizesOnBrandSite = (input.Sizes ?? []).Count == 0 && (input.SizesOnBrandSite ?? existing?.SizesOnBrandSite ?? false),
            CreatedAt = existing?.CreatedAt ?? now,
            UpdatedAt = now,
        };
    }

    private static string? NullIfEmpty(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
