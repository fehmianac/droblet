using Domain.Entity;
using Domain.Enum;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Domain.Services.Ai;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Infrastructure.Services.Integration;

/// <summary>
/// ICatalogProductLookup on the real catalog (ICatalogService, cached). The wardrobe side gets the product in its own
/// vocabulary: ItemCategory (CatalogRules.ItemCategoryOf), colour ids as stored (unknown ones are dropped by the
/// wardrobe when an item is created) and the name in the request language (workers: the default language).
/// ImageKey = the product's first image URL (https, public — not user data).
/// </summary>
public sealed class CatalogProductLookup(
    ICatalogService catalog,
    IRequestLanguage requestLanguage,
    HttpClient http,
    IOptionsMonitor<CatalogOptions> options,
    ILogger<CatalogProductLookup> logger) : ICatalogProductLookup
{
    private static readonly HashSet<string> ImageTypes = new(StringComparer.OrdinalIgnoreCase) { "image/jpeg", "image/png", "image/webp" };

    public async Task<ProductSnapshot?> GetAsync(string productId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(productId))
            return null;
        var product = await catalog.GetProductAsync(productId, ct);
        if (product is null)
            return null;

        var language = await requestLanguage.GetAsync(ct);
        var brandName = (await catalog.GetBrandNamesAsync(ct)).GetValueOrDefault(product.BrandId);
        return new ProductSnapshot(
            product.Id,
            LocalizedText.Resolve(product.Name, language, requestLanguage.Default) ?? "",
            product.BrandId,
            brandName,
            CatalogRules.ItemCategoryOf(product.Category),
            product.Colors,
            Fabric: null,
            Seasons: [],
            product.Images.FirstOrDefault(),
            product.Retired);
    }

    /// <summary>Downloads the product's first image for the try-on renderer. null = no usable image (the job fails and the credit is refunded).</summary>
    public async Task<ImageInput?> ReadImageAsync(ProductSnapshot product, CancellationToken ct)
    {
        var settings = options.CurrentValue;
        if (!IsAllowedImageUrl(product.ImageKey, settings.ImageHosts, out var uri))
            return null;

        try
        {
            using var response = await http.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, ct);
            var contentType = response.Content.Headers.ContentType?.MediaType;
            if (!response.IsSuccessStatusCode || contentType is null || !ImageTypes.Contains(contentType))
                return null;
            if (response.Content.Headers.ContentLength is { } length && length > settings.MaxImageBytes)
                return null;

            await using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var buffer = new MemoryStream();
            var chunk = new byte[81920];
            int read;
            while ((read = await stream.ReadAsync(chunk, ct)) > 0)
            {
                if (buffer.Length + read > settings.MaxImageBytes)
                    return null;
                buffer.Write(chunk, 0, read);
            }
            return buffer.Length == 0 ? null : new ImageInput(buffer.ToArray(), contentType);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            // The URL is catalog data, but it is still never logged with its query string.
            logger.LogWarning("Product image download failed for product {ProductId}: {Error}", product.Id, ex.GetType().Name);
            return null;
        }
    }

    /// <summary>https only, no credentials in the URL, and — when Catalog:ImageHosts is set — only those hosts (or their sub-domains).</summary>
    public static bool IsAllowedImageUrl(string? url, IReadOnlyCollection<string> allowedHosts, out Uri uri)
    {
        uri = null!;
        if (string.IsNullOrWhiteSpace(url) || !Uri.TryCreate(url, UriKind.Absolute, out var parsed))
            return false;
        if (parsed.Scheme != Uri.UriSchemeHttps || !string.IsNullOrEmpty(parsed.UserInfo) || parsed.IsLoopback || parsed.HostNameType != UriHostNameType.Dns)
            return false;
        var hosts = allowedHosts.Where(h => !string.IsNullOrWhiteSpace(h)).Select(h => h.Trim().ToLowerInvariant()).ToList();
        if (hosts.Count > 0 && !hosts.Any(h => parsed.Host.Equals(h, StringComparison.OrdinalIgnoreCase) || parsed.Host.EndsWith("." + h, StringComparison.OrdinalIgnoreCase)))
            return false;
        uri = parsed;
        return true;
    }
}

/// <summary>IEditLookLookup on the weekly edits and content collections (published, not retired).</summary>
public sealed class EditLookLookup(IContentService content) : IEditLookLookup
{
    public async Task<IReadOnlyList<string>?> GetProductIdsAsync(string editLookId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(editLookId) || editLookId.Length > 200)
            return null;

        // "{collectionId}/{lookId}"
        if (editLookId.Split('/') is [{ Length: > 0 } collectionId, { Length: > 0 } collectionLookId])
        {
            foreach (var kind in Enum.GetValues<ContentCollectionKind>())
            {
                if (await content.GetCollectionLooksAsync(kind, collectionId, ct) is { } looks)
                    return looks.FirstOrDefault(l => l.Id == collectionLookId)?.Products.Select(p => p.Id).ToList();
            }
            return null;
        }

        // "{editLookId}" or "{editLookId}@{priceBand}"
        var parts = editLookId.Split('@');
        if (parts.Length > 2)
            return null;
        PriceBand? band = null;
        if (parts.Length == 2)
        {
            if (!Enum.TryParse<PriceBand>(parts[1], ignoreCase: true, out var parsed) || !Enum.IsDefined(parsed))
                return null;
            band = parsed;
        }

        var look = (await content.ListEditsAsync(ct))
            .Where(e => e is { Published: true, Retired: false })
            .SelectMany(e => e.Looks)
            .FirstOrDefault(l => l.Id == parts[0]);
        var variant = look?.Variants.OrderBy(v => v.PriceBand).FirstOrDefault(v => band is null || v.PriceBand == band);
        return variant?.ProductIds.ToList();
    }
}

/// <summary>IFeedPostLookup on the Akış posts: only a live post (published, not retired, publish time come) resolves.</summary>
public sealed class FeedPostLookup(IRepository repository, TimeProvider timeProvider) : IFeedPostLookup
{
    public async Task<IReadOnlyList<string>?> GetProductIdsAsync(string postId, CancellationToken ct)
    {
        if (!Domain.Validation.FeedInputRules.IsId(postId))
            return null;
        var post = await repository.GetAsync<FeedPostEntity>(FeedPostEntity.GetPk(), FeedPostEntity.GetSk(postId), ct);
        return post is not null && FeedRules.IsLive(post, timeProvider.GetUtcNow().UtcDateTime) ? post.ProductIds.ToList() : null;
    }
}
