using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using Domain.Entity;
using Domain.Entity.Base;
using Infrastructure.Services.Integration;
using Domain.Options;
using Domain.Services;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Infrastructure.Storage;

/// <summary>
/// <see cref="IItemImagePublisher"/>: server-side S3 copies from tenant/{id}/items/ to public/{stage}/items/{hash}/ under a fresh
/// 128-bit random version. Best effort: a failed copy (e.g. AccessDenied while the template that grants public/{stage}/items/* is
/// not deployed yet) leaves the item unpublished — it keeps its presigned private image — and removes partial copies.
/// </summary>
public sealed class ItemImagePublisher(IObjectStorage storage, ICdnCache cdn, ILogger<ItemImagePublisher> logger) : IItemImagePublisher
{
    public async Task<PublishedItemImage?> PublishAsync(ItemEntity item, CancellationToken ct)
    {
        if (item.ImageKey is not { } cleaned || !cleaned.StartsWith(StorageKeys.ItemsPrefix(item.TenantId), StringComparison.Ordinal)
            || !cleaned.EndsWith(".webp", StringComparison.Ordinal) || item.IsModerationHidden())
            return null;

        var version = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16));
        var copied = new List<string>(3);
        try
        {
            if (await storage.HeadAsync(cleaned, ct) is not { } info)
                return null;
            var full = StorageKeys.PublicItemImage(item.TenantId, item.Id, version, "full");
            if (!await storage.CopyAsync(cleaned, full, info.ContentType ?? "image/webp", ItemImageRenditions.PublicCacheControl, ct))
                return null;
            copied.Add(full);

            var medium = await CopyRenditionAsync(ItemImageRenditions.Medium);
            var thumb = await CopyRenditionAsync(ItemImageRenditions.Thumb);
            return new PublishedItemImage(full, medium, thumb);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning("Item image of {ItemId} (tenant {TenantId}) could not be published ({Error}); it stays private", item.Id, item.TenantId, ex.GetType().Name);
            await DeleteQuietlyAsync(copied, ct);
            return null;
        }

        async Task<string?> CopyRenditionAsync(int width)
        {
            var key = StorageKeys.PublicItemImage(item.TenantId, item.Id, version, width.ToString(System.Globalization.CultureInfo.InvariantCulture));
            if (!await storage.CopyAsync(StorageKeys.ItemImageRendition(cleaned, width), key, "image/webp", ItemImageRenditions.PublicCacheControl, ct))
                return null;
            copied.Add(key);
            return key;
        }
    }

    public async Task UnpublishAsync(string tenantId, IEnumerable<string?> keys, CancellationToken ct)
    {
        var own = keys.OfType<string>().Where(k => StorageKeys.IsPublicItemKeyOf(k, tenantId)).Distinct(StringComparer.Ordinal).ToList();
        if (own.Count == 0)
            return;
        await DeleteQuietlyAsync(own, ct);
        await cdn.PurgeAsync(own, ct);
    }

    private async Task DeleteQuietlyAsync(IReadOnlyList<string> keys, CancellationToken ct)
    {
        foreach (var key in keys)
        {
            try
            {
                await storage.DeleteAsync(key, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning("A public item image could not be deleted ({Error})", ex.GetType().Name);
            }
        }
    }
}

/// <summary><see cref="IItemImageUrls"/> over Photos:PublicBaseUrl when PublicUrlsEnabled (public) with presigned GETs as the fallback.</summary>
public sealed class ItemImageUrls(
    IObjectStorage storage,
    IOptionsMonitor<PhotoOptions> photoOptions,
    IOptionsMonitor<WardrobeOptions> wardrobeOptions,
    TimeProvider timeProvider) : IItemImageUrls
{
    public Task<ItemImageView> GetAsync(ItemEntity item, CancellationToken ct) => GetAsync(item, allowOriginal: true, ct);

    public Task<ItemImageView> GetForOthersAsync(ItemEntity item, CancellationToken ct) => GetAsync(item, allowOriginal: false, ct);

    private async Task<ItemImageView> GetAsync(ItemEntity item, bool allowOriginal, CancellationToken ct)
    {
        var showOriginal = allowOriginal && item is { UseOriginalImage: true, OriginalImageKey: not null };
        if (!showOriginal && !item.IsModerationHidden() && item.PublicImageKey is { } full && StorageKeys.IsPublicItemKeyOf(full, item.TenantId))
        {
            var medium = Own(item.PublicMediumKey, item) ?? full;
            var thumb = Own(item.PublicThumbKey, item) ?? medium;
            var cacheKey = CacheKey(item.Id, full);
            if (photoOptions.CurrentValue.EffectivePublicBaseUrl is { } baseUrl)
                return new ItemImageView(Public(baseUrl, full), Public(baseUrl, medium), Public(baseUrl, thumb), null, cacheKey);

            // Not set up yet (no Cloudflare record): the published copies, presigned — same bucket, same objects.
            var (ttl, expires) = Ttl();
            var urls = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var key in new[] { full, medium, thumb }.Distinct(StringComparer.Ordinal))
                urls[key] = await storage.CreateReadUrlAsync(key, ttl, ct);
            return new ItemImageView(urls[full], urls[medium], urls[thumb], expires, cacheKey);
        }

        var privateKey = showOriginal ? item.OriginalImageKey : allowOriginal ? item.ImageKey ?? item.OriginalImageKey : item.ImageKey;
        if (privateKey is not null && StorageKeys.BelongsToTenant(privateKey, item.TenantId))
        {
            var (ttl, expires) = Ttl();
            var url = await storage.CreateReadUrlAsync(privateKey, ttl, ct);
            return new ItemImageView(url, url, url, expires, CacheKey(item.Id, privateKey));
        }

        if (GlobalAssets.PublicUrl(item.GlobalImageKey, wardrobeOptions.CurrentValue.PublicAssetBaseUrl) is { } global)
            return new ItemImageView(global, global, global, null, CacheKey(item.Id, global));
        return ItemImageView.None;
    }

    private (TimeSpan Ttl, DateTime ExpiresAt) Ttl()
    {
        var ttl = TimeSpan.FromSeconds(photoOptions.CurrentValue.ReadUrlTtlSeconds);
        return (ttl, timeProvider.GetUtcNow().UtcDateTime.Add(ttl));
    }

    private static string? Own(string? key, ItemEntity item) => key is not null && StorageKeys.IsPublicItemKeyOf(key, item.TenantId) ? key : null;

    public static string Public(string baseUrl, string key) => $"{baseUrl.TrimEnd('/')}/{key}";

    /// <summary>Same image (key) → same cache key; it never reveals the key (a short hash), and changes when the image does.</summary>
    public static string CacheKey(string itemId, string imageKey) =>
        $"item-{itemId}-{Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(imageKey)).AsSpan(0, 8))}";
}

/// <summary>Cloudflare "purge files by URL" (≤ 30 URLs per call). Failures are logged, never thrown: the cache expires anyway.</summary>
public sealed class CloudflareCdnCache(
    HttpClient http,
    IOptionsMonitor<CloudflareOptions> options,
    IOptionsMonitor<PhotoOptions> photoOptions,
    ILogger<CloudflareCdnCache> logger) : ICdnCache
{
    private const int MaxFilesPerCall = 30;

    public async Task PurgeAsync(IReadOnlyList<string> publicKeys, CancellationToken ct)
    {
        var settings = options.CurrentValue;
        if (publicKeys.Count == 0 || !settings.IsConfigured || photoOptions.CurrentValue.EffectivePublicBaseUrl is not { } baseUrl)
            return;

        foreach (var chunk in publicKeys.Select(k => ItemImageUrls.Public(baseUrl, k)).Chunk(MaxFilesPerCall))
        {
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Post, $"{settings.ApiBaseUrl.TrimEnd('/')}/zones/{settings.ZoneId}/purge_cache")
                {
                    Content = JsonContent.Create(new { files = chunk }),
                };
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", settings.ApiToken);
                using var response = await http.SendAsync(request, ct);
                if (!response.IsSuccessStatusCode)
                    logger.LogWarning("Cloudflare purge answered {Status}", (int)response.StatusCode);
            }
            catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
            {
                logger.LogWarning("Cloudflare purge failed ({Error})", ex.GetType().Name);
            }
        }
    }
}
