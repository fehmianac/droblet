using System.Globalization;
using Domain.Domain;
using Domain.Entity;
using Domain.Enum;
using Domain.Extensions;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Infrastructure.Services.Store;

/// <summary>
/// Revenue flow (brief §5.5): checkout creates a click (click_id → user, products, look, source) and returns the brand
/// link with the click id; the network / brand postback records the conversion against it. Payment never happens here.
/// </summary>
public sealed class AffiliateService(
    IRepository repository,
    ICatalogService catalog,
    ICatalogProductLookup productLookup,
    IWardrobeService wardrobe,
    IAnalyticsService analytics,
    IOptionsMonitor<AffiliateOptions> affiliateOptions,
    IOptionsMonitor<AffiliatePostbackOptions> postbackOptions,
    TimeProvider timeProvider,
    ILogger<AffiliateService> logger) : IAffiliateService
{
    private DateTime Now => timeProvider.GetUtcNow().UtcDateTime;

    public async Task<CheckoutResult> CheckoutBrandAsync(string tenantId, string brandId, CancellationToken ct)
    {
        var lines = await repository.GetAllAsync<CartLineEntity>(
            CartLineEntity.GetPk(tenantId), $"{brandId}#", SkOperator.BeginsWith, ct);
        if (lines.Count == 0)
            return new CheckoutResult(CheckoutOutcome.CartEmpty);

        var brand = await catalog.GetBrandAsync(brandId, ct);
        if (brand is null)
            return new CheckoutResult(CheckoutOutcome.BrandNotFound);

        var products = new List<CatalogProductEntity>();
        foreach (var productId in lines.OrderBy(l => l.AddedAt).Select(l => l.ProductId).Distinct())
        {
            if (await catalog.GetProductAsync(productId, ct) is { Retired: false } product)
                products.Add(product);
        }
        if (products.Count == 0)
            return new CheckoutResult(CheckoutOutcome.ProductRetired);

        var withLook = lines.FirstOrDefault(l => l.LookKind is not null && l.LookId is not null);
        return await CreateClickAsync(tenantId, brand, products, StoreDtoMapper.ToLookRef(withLook?.LookKind, withLook?.LookId), ct);
    }

    public async Task<CheckoutResult> CheckoutProductAsync(string tenantId, string productId, LookRefDto? look, CancellationToken ct)
    {
        var product = await catalog.GetProductAsync(productId, ct);
        if (product is null)
            return new CheckoutResult(CheckoutOutcome.ProductNotFound);
        if (product.Retired)
            return new CheckoutResult(CheckoutOutcome.ProductRetired);
        var brand = await catalog.GetBrandAsync(product.BrandId, ct);
        if (brand is null)
            return new CheckoutResult(CheckoutOutcome.BrandNotFound);
        return await CreateClickAsync(tenantId, brand, [product], look, ct);
    }

    private async Task<CheckoutResult> CreateClickAsync(string tenantId, BrandEntity brand, List<CatalogProductEntity> products, LookRefDto? look, CancellationToken ct)
    {
        var now = Now;
        var clickId = Ulid.New(now);
        var parameter = brand.ClickIdParameter ?? postbackOptions.CurrentValue.DefaultClickIdParameter;

        var productLinks = products
            .Where(p => AffiliateLinkBuilder.IsHttpsUrl(p.AffiliateUrl))
            .Select(p => new CheckoutProductDto(p.Id, AffiliateLinkBuilder.AppendClickId(p.AffiliateUrl!, parameter, clickId)))
            .ToList();

        // One product → its own link. Several → the brand's affiliate landing when there is one, else the first product link.
        var url = products.Count > 1 && AffiliateLinkBuilder.IsHttpsUrl(brand.CheckoutUrl)
            ? AffiliateLinkBuilder.AppendClickId(brand.CheckoutUrl!, parameter, clickId)
            : productLinks.FirstOrDefault()?.Url
              ?? (AffiliateLinkBuilder.IsHttpsUrl(brand.CheckoutUrl) ? AffiliateLinkBuilder.AppendClickId(brand.CheckoutUrl!, parameter, clickId) : null);
        if (url is null)
            return new CheckoutResult(CheckoutOutcome.AffiliateLinkMissing);

        var productIds = products.Select(p => p.Id).ToList();
        var click = new AffiliateClickEntity
        {
            ClickId = clickId,
            TenantId = tenantId,
            BrandId = brand.Id,
            ProductId = productIds.Count == 1 ? productIds[0] : null,
            ProductIds = productIds,
            LookKind = look?.Kind,
            LookId = look?.Id,
            Source = brand.Source,
            Network = brand.Network,
            CreatedAt = now,
        };
        var index = new AffiliateClickIndexEntity
        {
            ClickId = clickId,
            TenantId = tenantId,
            BrandId = brand.Id,
            ProductIds = productIds,
            LookKind = look?.Kind,
            LookId = look?.Id,
            Source = brand.Source,
            CreatedAt = now,
        };
        var ledger = new AffiliateClickLedgerEntity
        {
            Month = now.ToString("yyyy-MM", CultureInfo.InvariantCulture),
            ClickId = clickId,
            BrandId = brand.Id,
            Source = brand.Source,
            Network = brand.Network,
            CreatedAt = now,
        };
        var result = await repository.TransactWriteAsync(
            [TransactWriteOperation.Create(index), TransactWriteOperation.Put(click), TransactWriteOperation.Put(ledger)], ct);
        if (!result.Applied)
            throw new InvalidOperationException($"Click could not be recorded: {result.Outcome}.");

        await analytics.RecordServerEventAsync(AnalyticsRules.BrandSiteOpened, tenantId, new Dictionary<string, string?>
        {
            ["brandId"] = brand.Id,
            ["productId"] = click.ProductId,
            ["lookKind"] = look?.Kind.ToString().ToLowerInvariant(),
            ["lookId"] = look?.Id,
            ["count"] = productIds.Count.ToString(CultureInfo.InvariantCulture),
        }, ct);

        logger.LogInformation("Affiliate click {ClickId} for tenant {TenantId} brand {BrandId} ({Count} products)", clickId, tenantId, brand.Id, productIds.Count);
        return new CheckoutResult(CheckoutOutcome.Ok, new CheckoutDto(clickId, url, brand.Source, brand.Id, brand.Name, productLinks));
    }

    // ── Postback ────────────────────────────────────────────────────────────────────────────────────────────────

    public async Task<string?> BrandOfClickAsync(string clickId, CancellationToken ct) =>
        (await FindClickAsync(clickId, ct))?.BrandId;

    private async Task<AffiliateClickIndexEntity?> FindClickAsync(string clickId, CancellationToken ct)
    {
        var index = await repository.GetAsync<AffiliateClickIndexEntity>(AffiliateClickIndexEntity.GetPk(clickId), AffiliateClickIndexEntity.GetSk(), ct);
        if (index is null)
            return null;
        if (index.BrandId is not null)
            return index;
        if (index.TenantId is null)
            return null;

        // Pointer written before the index carried the click details.
        var click = await repository.GetAsync<AffiliateClickEntity>(AffiliateClickEntity.GetPk(index.TenantId), AffiliateClickEntity.GetSk(clickId), ct);
        if (click is null)
            return null;
        index.BrandId = click.BrandId;
        index.ProductIds = click.ProductIds.Count > 0 ? click.ProductIds : click.ProductId is null ? [] : [click.ProductId];
        index.LookKind = click.LookKind;
        index.LookId = click.LookId;
        index.Source = click.Source;
        return index;
    }

    public async Task<PostbackOutcome> RecordConversionAsync(AffiliateSource source, PostbackInput input, CancellationToken ct)
    {
        var click = await FindClickAsync(input.ClickId, ct);
        if (click?.BrandId is not { } brandId)
            return PostbackOutcome.ClickNotFound;

        var now = Now;
        var brand = await catalog.GetBrandAsync(brandId, ct);
        var rateBps = brand?.CommissionRateBps ?? AffiliateCommission.TermsFor(affiliateOptions.CurrentValue, brandId).RateBps;
        var commission = AffiliateCommission.Calculate(input.AmountMinor, rateBps);
        var currency = input.Currency ?? StoreDtoMapper.Currency;

        var indexPk = AffiliateConversionIndexEntity.GetPk(source, input.OrderId);
        var existingIndex = await repository.GetAsync<AffiliateConversionIndexEntity>(indexPk, AffiliateConversionIndexEntity.GetSk(), ct);

        if (existingIndex is null)
        {
            var month = now.ToString("yyyy-MM", CultureInfo.InvariantCulture);
            var ledger = new AffiliateConversionLedgerEntity
            {
                Month = month, Source = source, ExternalId = input.OrderId, ClickId = input.ClickId, BrandId = brandId,
                TenantId = click.TenantId, ProductIds = click.ProductIds, LookKind = click.LookKind, LookId = click.LookId,
                AmountMinor = input.AmountMinor, Currency = currency, CommissionRateBps = rateBps, CommissionMinor = commission,
                Status = input.Status, ReceivedAt = now, UpdatedAt = now,
            };
            var operations = new List<TransactWriteOperation>
            {
                TransactWriteOperation.Create(new AffiliateConversionIndexEntity { Source = source, ExternalId = input.OrderId, LedgerMonth = month, ReceivedAt = now }),
                TransactWriteOperation.Put(ledger),
            };
            if (click.TenantId is not null)
            {
                operations.Add(TransactWriteOperation.Put(new AffiliateConversionEntity
                {
                    Id = Ulid.New(now), TenantId = click.TenantId, Source = source, ExternalId = input.OrderId, ClickId = input.ClickId,
                    BrandId = brandId, ProductIds = click.ProductIds, LookKind = click.LookKind, LookId = click.LookId,
                    AmountMinor = input.AmountMinor, Currency = currency, CommissionMinor = commission, Status = input.Status,
                    WardrobePrompt = PromptFor(input.Status, click.ProductIds, WardrobePromptStatus.None),
                    ReceivedAt = now, UpdatedAt = now,
                }));
            }

            var result = await repository.TransactWriteAsync(operations, ct);
            if (result.Applied)
            {
                if (click.TenantId is not null)
                {
                    await analytics.RecordServerEventAsync(AnalyticsRules.Conversion, click.TenantId, new Dictionary<string, string?>
                    {
                        ["brandId"] = brandId,
                        ["source"] = source.ToString().ToLowerInvariant(),
                        ["lookKind"] = click.LookKind?.ToString().ToLowerInvariant(),
                        ["lookId"] = click.LookId,
                    }, ct);
                }
                logger.LogInformation("Conversion recorded for click {ClickId} brand {BrandId} source {Source} status {Status}", input.ClickId, brandId, source, input.Status);
                return PostbackOutcome.Recorded;
            }

            // Lost a race with the same postback: fall through and treat it as a repeat.
            existingIndex = await repository.GetAsync<AffiliateConversionIndexEntity>(indexPk, AffiliateConversionIndexEntity.GetSk(), ct);
            if (existingIndex is null)
                throw new InvalidOperationException($"Conversion could not be recorded: {result.Outcome}.");
        }

        var stored = await repository.GetAsync<AffiliateConversionLedgerEntity>(
            AffiliateConversionLedgerEntity.GetPk(existingIndex.LedgerMonth), AffiliateConversionLedgerEntity.GetSk(source, input.OrderId), ct);
        if (stored is null || (stored.Status == input.Status && stored.AmountMinor == input.AmountMinor))
            return PostbackOutcome.Duplicate;

        stored.Status = input.Status;
        stored.AmountMinor = input.AmountMinor;
        stored.CommissionMinor = AffiliateCommission.Calculate(input.AmountMinor, stored.CommissionRateBps);
        stored.UpdatedAt = now;
        await repository.SaveAsync(stored, ct);

        if (stored.TenantId is not null)
        {
            var conversion = await repository.GetAsync<AffiliateConversionEntity>(
                AffiliateConversionEntity.GetPk(stored.TenantId), AffiliateConversionEntity.GetSk(source, input.OrderId), ct);
            if (conversion is not null)
            {
                conversion.Status = input.Status;
                conversion.AmountMinor = input.AmountMinor;
                conversion.CommissionMinor = stored.CommissionMinor;
                conversion.WardrobePrompt = PromptFor(input.Status, conversion.ProductIds, conversion.WardrobePrompt);
                conversion.UpdatedAt = now;
                await repository.SaveAsync(conversion, ct);
            }
        }
        return PostbackOutcome.Updated;
    }

    /// <summary>"Gardıroba ekleyelim mi?" is asked once per purchase with known products; a rejected (returned) order withdraws it.</summary>
    internal static WardrobePromptStatus PromptFor(AffiliateConversionStatus status, IReadOnlyCollection<string> productIds, WardrobePromptStatus current)
    {
        if (status == AffiliateConversionStatus.Rejected)
            return current == WardrobePromptStatus.Pending ? WardrobePromptStatus.None : current;
        if (current != WardrobePromptStatus.None || productIds.Count == 0)
            return current;
        return WardrobePromptStatus.Pending;
    }

    // ── Purchase prompts ────────────────────────────────────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<PurchasePromptDto>> GetPurchasePromptsAsync(string tenantId, CancellationToken ct)
    {
        var conversions = await repository.GetAllAsync<AffiliateConversionEntity>(AffiliateConversionEntity.GetPk(tenantId), ct);
        var brandNames = await catalog.GetBrandNamesAsync(ct);
        var prompts = new List<PurchasePromptDto>();
        foreach (var c in conversions.Where(c => c.WardrobePrompt == WardrobePromptStatus.Pending && c.Id is not null).OrderByDescending(c => c.ReceivedAt))
        {
            var products = await catalog.ToDtosAsync(c.ProductIds, ct);
            if (products.Count == 0)
                continue;
            prompts.Add(new PurchasePromptDto(c.Id!, c.BrandId, brandNames.GetValueOrDefault(c.BrandId) ?? c.BrandId, products,
                StoreDtoMapper.ToLookRef(c.LookKind, c.LookId), c.WardrobePrompt, c.ReceivedAt));
        }
        return prompts;
    }

    public async Task<PurchasePromptAnswer?> AnswerPurchasePromptAsync(string tenantId, string promptId, bool accepted, CancellationToken ct)
    {
        var conversions = await repository.GetAllAsync<AffiliateConversionEntity>(AffiliateConversionEntity.GetPk(tenantId), ct);
        var conversion = conversions.FirstOrDefault(c => c.Id == promptId);
        if (conversion is null || conversion.WardrobePrompt == WardrobePromptStatus.None)
            return null;

        var items = new List<ItemCreateResultDto>();
        if (accepted)
        {
            // "Gardıroba ekleyelim mi?" → yes: every purchased product becomes a wardrobe item. The mutation id is
            // derived from the prompt, so answering twice (or a retry after a timeout) never adds a piece twice.
            foreach (var productId in conversion.ProductIds.Distinct(StringComparer.Ordinal))
            {
                var product = await productLookup.GetAsync(productId, ct);
                if (product is null)
                    continue; // the product left the catalog since the purchase
                var mutationId = Ulid.Deterministic(conversion.ReceivedAt, $"purchase-prompt|{promptId}|{productId}");
                items.Add(await wardrobe.AddFromProductAsync(tenantId, product, mutationId, size: null, itemId: mutationId, ct));
            }
            if (items.Any(i => i.Outcome == ItemCreateOutcome.Rejected))
                return new PurchasePromptAnswer(conversion.WardrobePrompt, items); // stays pending: the user can retry
        }

        conversion.WardrobePrompt = accepted ? WardrobePromptStatus.Accepted : WardrobePromptStatus.Dismissed;
        conversion.UpdatedAt = Now;
        await repository.SaveAsync(conversion, ct);
        return new PurchasePromptAnswer(conversion.WardrobePrompt, items);
    }

    // ── Report ──────────────────────────────────────────────────────────────────────────────────────────────────

    public async Task<RevenueReport> GetRevenueReportAsync(DateOnly from, DateOnly to, CancellationToken ct)
    {
        var rows = new List<AffiliateConversionLedgerEntity>();
        var clicks = new List<AffiliateClickLedgerEntity>();
        for (var month = new DateOnly(from.Year, from.Month, 1); month <= to; month = month.AddMonths(1))
        {
            var key = month.ToString("yyyy-MM", CultureInfo.InvariantCulture);
            rows.AddRange(await repository.GetAllAsync<AffiliateConversionLedgerEntity>(AffiliateConversionLedgerEntity.GetPk(key), ct));
            clicks.AddRange(await repository.GetAllAsync<AffiliateClickLedgerEntity>(AffiliateClickLedgerEntity.GetPk(key), ct));
        }
        var networks = (await catalog.GetBrandsAsync(ct)).ToDictionary(b => b.Id, b => b.Network, StringComparer.Ordinal);
        return RevenueReportRules.Build(rows, from, to, clicks: clicks, brandNetworks: networks);
    }
}
