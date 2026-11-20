using System.Net;
using Amazon.Extensions.Configuration.SystemsManager;
using Amazon.SimpleSystemsManagement.Model;
using Domain.Entity;
using Domain.Enum;
using Domain.Options;
using Domain.Services;
using Infrastructure;
using Infrastructure.Storage;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Tests.Shared;

namespace InfrastructureTests;

/// <summary>Public cleaned item images (docs/images.md): keys, publication, URLs / fallback, CDN purge, configuration.</summary>
public class ItemImageTests
{
    private const string Tenant = "01JTENANT0000000000000000A";
    private const string Cdn = "https://cdn.droblet.test";

    private readonly FakeObjectStorage _storage = new();
    private readonly FakeCdnCache _cdn = new();

    private ItemImagePublisher Publisher() => new(_storage, _cdn, NullLogger<ItemImagePublisher>.Instance);

    private ItemImageUrls Urls(string? publicBaseUrl, bool enabled = true) => new(_storage,
        Fixtures.Monitor(new PhotoOptions { ReadUrlTtlSeconds = 3600, PublicBaseUrl = publicBaseUrl, PublicUrlsEnabled = enabled }),
        Fixtures.Monitor(new WardrobeOptions { PublicAssetBaseUrl = "https://catalog.test" }), Fixtures.Clock());

    private async Task<ItemEntity> CleanedItemAsync(bool renditions = true, string id = "item-1")
    {
        var cleaned = StorageKeys.ItemImage(Tenant, "draft-" + id);
        await _storage.PutAsync(cleaned, [1, 2, 3], "image/webp", default);
        if (renditions)
            foreach (var key in ItemImageRenditions.KeysOf(cleaned))
                await _storage.PutAsync(key, [9], "image/webp", default);
        await _storage.PutAsync(StorageKeys.ItemOriginal(Tenant, "draft-" + id, "jpg"), [7], "image/jpeg", default);
        return new ItemEntity
        {
            Id = id, TenantId = Tenant, Category = ItemCategory.Top, Source = ItemSource.Photo, ImageKey = cleaned,
            OriginalImageKey = StorageKeys.ItemOriginal(Tenant, "draft-" + id, "jpg"), Version = 1,
        };
    }

    // ── Keys ───────────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void PublicKeys_HideTheTenant_AreStablePerTenant_AndDifferBetweenTenants()
    {
        var root = StorageKeys.PublicItemsRoot(Tenant);

        Assert.Matches("^public/dev/items/[0-9a-f]{32}/$", root);
        Assert.DoesNotContain(Tenant, root);
        Assert.Equal(root, StorageKeys.PublicItemsRoot(Tenant));
        Assert.NotEqual(root, StorageKeys.PublicItemsRoot("01JTENANT0000000000000000B"));
        Assert.Equal($"{root}item-1-abc-256.webp", StorageKeys.PublicItemImage(Tenant, "item-1", "abc", "256"));
        Assert.True(StorageKeys.IsPublicItemKeyOf(StorageKeys.PublicItemImage(Tenant, "i", "v", "full"), Tenant));
        Assert.False(StorageKeys.IsPublicItemKeyOf(StorageKeys.PublicItemImage("other", "i", "v", "full"), Tenant));
        Assert.False(StorageKeys.BelongsToTenant(StorageKeys.PublicItemImage(Tenant, "i", "v", "full"), Tenant)); // never presigned as "own private"
        Assert.Throws<ArgumentException>(() => StorageKeys.PublicItemImage(Tenant, "../x", "v", "full"));
    }

    [Fact]
    public void Renditions_SitNextToTheCleanedImage()
    {
        var cleaned = StorageKeys.ItemImage(Tenant, "d1");
        Assert.Equal($"tenant/{Tenant}/items/d1-256.webp", StorageKeys.ItemImageRendition(cleaned, 256));
        Assert.Equal([$"tenant/{Tenant}/items/d1-256.webp", $"tenant/{Tenant}/items/d1-768.webp"], ItemImageRenditions.KeysOf(cleaned));
        Assert.Throws<ArgumentException>(() => StorageKeys.ItemImageRendition(StorageKeys.ItemOriginal(Tenant, "d1", "jpg"), 256));
    }

    [Fact]
    public async Task WriteRenditions_WritesBothSizes_AsWebp()
    {
        var cleaned = StorageKeys.ItemImage(Tenant, "d1");
        var thumbnailer = new FakeThumbnailer();

        var written = await ItemImageRenditions.WriteAsync(_storage, thumbnailer, cleaned, [1, 2], default);

        Assert.Equal(ItemImageRenditions.KeysOf(cleaned), written);
        Assert.Equal([256, 768], thumbnailer.Sizes);
        Assert.All(written, k => Assert.Equal("image/webp", _storage.Objects[k].ContentType));
    }

    // ── Publisher ────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Publish_CopiesFullAndThumbnails_UnderOneRandomVersion_WithCacheControl()
    {
        var item = await CleanedItemAsync();

        var first = (await Publisher().PublishAsync(item, default))!;
        var second = (await Publisher().PublishAsync(item, default))!;

        Assert.All(first.Keys, k => Assert.StartsWith(StorageKeys.PublicItemsRoot(Tenant) + "item-1-", k));
        Assert.EndsWith("-full.webp", first.FullKey);
        Assert.EndsWith("-768.webp", first.MediumKey);
        Assert.EndsWith("-256.webp", first.ThumbKey);
        var version = first.FullKey.Split('-')[^2];
        Assert.Matches("^[0-9a-f]{32}$", version);                     // 128 random bits
        Assert.All(first.Keys, k => Assert.Contains($"-{version}-", k));
        Assert.NotEqual(first.FullKey, second.FullKey);                 // a new publication never reuses a key
        Assert.All(first.Keys, k => Assert.Equal(ItemImageRenditions.PublicCacheControl, _storage.CacheControls[k]));
        Assert.Equal([1, 2, 3], _storage.Objects[first.FullKey].Data);
    }

    [Fact]
    public async Task Publish_WithoutRenditions_PublishesTheFullImageOnly()
    {
        var item = await CleanedItemAsync(renditions: false);

        var image = (await Publisher().PublishAsync(item, default))!;

        Assert.Equal((null, null), (image.MediumKey, image.ThumbKey));
        Assert.Single(image.Keys);
    }

    [Fact]
    public async Task Publish_RefusesWhatIsNotACleanedImageOfTheTenant_OrHidden()
    {
        var item = await CleanedItemAsync();

        Assert.Null(await Publisher().PublishAsync(new ItemEntity { Id = "x", TenantId = Tenant, OriginalImageKey = item.OriginalImageKey }, default));
        Assert.Null(await Publisher().PublishAsync(new ItemEntity { Id = "x", TenantId = "other", ImageKey = item.ImageKey }, default));
        Assert.Null(await Publisher().PublishAsync(new ItemEntity { Id = "x", TenantId = Tenant, GlobalImageKey = "library/a.webp" }, default));
        item.ModerationHiddenAt = Fixtures.Now;
        Assert.Null(await Publisher().PublishAsync(item, default));
        Assert.DoesNotContain(_storage.Objects.Keys, k => k.StartsWith("public/", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Publish_FailedCopy_LeavesNothingBehind_AndReturnsNull()
    {
        var item = await CleanedItemAsync();
        _storage.FailCopyTo = k => k.EndsWith("-256.webp", StringComparison.Ordinal); // e.g. AccessDenied before the infra deploy

        Assert.Null(await Publisher().PublishAsync(item, default));
        Assert.DoesNotContain(_storage.Objects.Keys, k => k.StartsWith("public/", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Unpublish_DeletesOnlyTheTenantsPublicKeys_AndPurgesThem()
    {
        var item = await CleanedItemAsync();
        var image = (await Publisher().PublishAsync(item, default))!;
        var foreign = StorageKeys.PublicItemImage("other", "i", "v", "full");
        await _storage.PutAsync(foreign, [1], "image/webp", default);

        await Publisher().UnpublishAsync(Tenant, [.. image.Keys, foreign, item.ImageKey, null], default);

        Assert.All(image.Keys, k => Assert.False(_storage.Objects.ContainsKey(k)));
        Assert.True(_storage.Objects.ContainsKey(foreign));
        Assert.True(_storage.Objects.ContainsKey(item.ImageKey!));      // the private image is not the publisher's to delete
        Assert.Equal(image.Keys.Order(), _cdn.Purged.Order());
    }

    // ── URLs ─────────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Urls_Published_WithBaseUrl_ArePublic_NoExpiry_ThreeSizes()
    {
        var item = await CleanedItemAsync();
        item.SetPublicImage(await Publisher().PublishAsync(item, default));

        var view = await Urls(Cdn + "/").GetAsync(item, default);

        Assert.Equal($"{Cdn}/{item.PublicImageKey}", view.ImageUrl);
        Assert.Equal($"{Cdn}/{item.PublicMediumKey}", view.MediumUrl);
        Assert.Equal($"{Cdn}/{item.PublicThumbKey}", view.ThumbUrl);
        Assert.Null(view.ExpiresAt);
        Assert.Equal(view.CacheKey, (await Urls(Cdn).GetAsync(item, default)).CacheKey);
        Assert.DoesNotContain(item.PublicImageKey!, view.CacheKey);
    }

    [Fact]
    public async Task Urls_Published_WithoutBaseUrl_FallBackToPresignedCopies_SameCacheKey()
    {
        var item = await CleanedItemAsync();
        item.SetPublicImage(await Publisher().PublishAsync(item, default));

        var fallback = await Urls(null).GetAsync(item, default);
        var placeholder = await Urls(ConfigSecret.Placeholder).GetAsync(item, default);
        var switchedOff = await Urls(Cdn, enabled: false).GetAsync(item, default);   // record not live yet
        Assert.Equal(fallback.ImageUrl, switchedOff.ImageUrl);
        var cdn = await Urls(Cdn).GetAsync(item, default);

        Assert.StartsWith($"https://s3.test/bucket/{item.PublicThumbKey}?X-Amz-Expires=3600", fallback.ThumbUrl);
        Assert.StartsWith($"https://s3.test/bucket/{item.PublicImageKey}?", fallback.ImageUrl);
        Assert.Equal(Fixtures.Now.AddHours(1), fallback.ExpiresAt);
        Assert.Equal(fallback.ImageUrl, placeholder.ImageUrl);           // CHANGE_ME = not configured
        Assert.Equal(cdn.CacheKey, fallback.CacheKey);                  // the app's cache survives the switch-over
    }

    [Fact]
    public async Task Urls_Unpublished_PresignThePrivateImage_ForAllSizes()
    {
        var item = await CleanedItemAsync();

        var view = await Urls(Cdn).GetAsync(item, default);

        Assert.StartsWith($"https://s3.test/bucket/{item.ImageKey}?", view.ImageUrl);
        Assert.Equal((view.ImageUrl, view.ImageUrl), (view.MediumUrl, view.ThumbUrl));
        Assert.NotNull(view.ExpiresAt);
        Assert.Equal(ItemImageUrls.CacheKey(item.Id, item.ImageKey!), view.CacheKey);
    }

    [Fact]
    public async Task Urls_OriginalChosen_IsPresigned_ForTheOwner_NeverForOthers()
    {
        var item = await CleanedItemAsync();
        item.SetPublicImage(await Publisher().PublishAsync(item, default));
        item.UseOriginalImage = true;

        var owner = await Urls(Cdn).GetAsync(item, default);
        var others = await Urls(Cdn).GetForOthersAsync(item, default);

        Assert.StartsWith($"https://s3.test/bucket/{item.OriginalImageKey}?", owner.ImageUrl);
        Assert.NotEqual(ItemImageUrls.CacheKey(item.Id, item.PublicImageKey!), owner.CacheKey);
        Assert.Equal($"{Cdn}/{item.PublicMediumKey}", others.MediumUrl);  // the cleaned image only
    }

    [Fact]
    public async Task Urls_ForOthers_WithoutACleanedImage_NeverFallBackToTheOriginal()
    {
        var item = new ItemEntity { Id = "i", TenantId = Tenant, OriginalImageKey = StorageKeys.ItemOriginal(Tenant, "d", "jpg"), UseOriginalImage = true };

        Assert.Equal(ItemImageView.None, await Urls(Cdn).GetForOthersAsync(item, default));
        Assert.NotNull((await Urls(Cdn).GetAsync(item, default)).ImageUrl);
    }

    [Fact]
    public async Task Urls_HiddenItem_IgnoresStalePublicKeys_TheOwnerSeesThePrivateImage()
    {
        var item = await CleanedItemAsync();
        item.SetPublicImage(await Publisher().PublishAsync(item, default));
        item.ModerationHiddenAt = Fixtures.Now;

        var view = await Urls(Cdn).GetAsync(item, default);

        Assert.StartsWith($"https://s3.test/bucket/{item.ImageKey}?", view.ImageUrl);
    }

    [Fact]
    public async Task Urls_LibraryPiece_UsesTheGlobalAsset()
    {
        var view = await Urls(Cdn).GetAsync(new ItemEntity { Id = "i", TenantId = Tenant, GlobalImageKey = "library/a.webp" }, default);

        Assert.Equal("https://catalog.test/library/a.webp", view.ThumbUrl);
        Assert.Null(view.ExpiresAt);
        Assert.Equal(ItemImageView.None, await Urls(Cdn).GetAsync(new ItemEntity { Id = "i", TenantId = Tenant }, default));
    }

    [Fact]
    public async Task Urls_ForeignKeys_AreNeverServed()
    {
        var item = new ItemEntity
        {
            Id = "i", TenantId = Tenant, ImageKey = StorageKeys.ItemImage("other", "d"),
            PublicImageKey = StorageKeys.PublicItemImage("other", "i", "v", "full"),
        };

        Assert.Equal(ItemImageView.None, await Urls(Cdn).GetAsync(item, default));
    }

    // ── Cloudflare purge ─────────────────────────────────────────────────────────────────────────────────────────

    private sealed class RecordingHandler : HttpMessageHandler
    {
        public List<(HttpRequestMessage Request, string Body)> Calls { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls.Add((request, request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken)));
            return new HttpResponseMessage(HttpStatusCode.OK);
        }
    }

    private static CloudflareCdnCache Purger(RecordingHandler handler, string? zone, string? token, string? baseUrl) => new(new HttpClient(handler),
        Fixtures.Monitor(new CloudflareOptions { ZoneId = zone, ApiToken = token }),
        Fixtures.Monitor(new PhotoOptions { PublicBaseUrl = baseUrl, PublicUrlsEnabled = true }), NullLogger<CloudflareCdnCache>.Instance);

    [Fact]
    public async Task Purge_IsSkipped_WhenNotConfigured()
    {
        var handler = new RecordingHandler();

        await Purger(handler, "CHANGE_ME", "CHANGE_ME", Cdn).PurgeAsync(["public/items/a/b.webp"], default);
        await Purger(handler, "zone", "token", null).PurgeAsync(["public/items/a/b.webp"], default);
        await Purger(handler, "zone", "token", Cdn).PurgeAsync([], default);

        Assert.Empty(handler.Calls);
    }

    [Fact]
    public async Task Purge_PostsTheUrls_InChunksOf30_WithTheToken()
    {
        var handler = new RecordingHandler();
        var keys = Enumerable.Range(0, 31).Select(i => $"public/items/h/i-{i}.webp").ToList();

        await Purger(handler, "zone-1", "token-1", Cdn).PurgeAsync(keys, default);

        Assert.Equal(2, handler.Calls.Count);
        var (request, body) = handler.Calls[0];
        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal("https://api.cloudflare.com/client/v4/zones/zone-1/purge_cache", request.RequestUri!.ToString());
        Assert.Equal(("Bearer", "token-1"), (request.Headers.Authorization!.Scheme, request.Headers.Authorization.Parameter));
        Assert.Contains($"\"{Cdn}/public/items/h/i-0.webp\"", body);
        Assert.Contains($"\"{Cdn}/public/items/h/i-30.webp\"", handler.Calls[1].Body);
    }

    // ── Configuration (SSM shapes created by template.yaml + deploy-infra) ───────────────────────────────────────

    [Theory]
    [InlineData("https://cdn.droblet.alatech.co", "https://cdn.droblet.alatech.co")]
    [InlineData("CHANGE_ME", null)]
    public void PublicBaseUrl_NestedParameter_BindsNextToTheTemplatePhotosJson(string value, string? expected)
    {
        const string path = "/droblet/dev/api";
        var processed = new JsonOrStringParameterProcessor().ProcessParameters(
        [
            new Parameter { Name = $"{path}/Photos", Value = """{"UploadUrlTtlSeconds":300,"ReadUrlTtlSeconds":3600}""" },
            new Parameter { Name = $"{path}/Photos/PublicBaseUrl", Value = value },
            new Parameter { Name = $"{path}/Photos/PublicUrlsEnabled", Value = "true" },
            new Parameter { Name = $"{path}/Cloudflare/ZoneId", Value = "CHANGE_ME" },
            new Parameter { Name = $"{path}/Cloudflare/ApiToken", Value = "CHANGE_ME" },
        ], path);
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddDrobletCore(new ConfigurationBuilder().AddInMemoryCollection(processed!).Build());
        services.AddSingleton<IObjectStorage>(_storage);
        using var provider = services.BuildServiceProvider();

        var photos = provider.GetRequiredService<IOptionsMonitor<PhotoOptions>>().CurrentValue;
        Assert.Equal((3600, expected, expected), (photos.ReadUrlTtlSeconds, photos.PublicBaseUrl, photos.EffectivePublicBaseUrl));
        Assert.True(photos.PublicUrlsEnabled);
        Assert.False(provider.GetRequiredService<IOptionsMonitor<CloudflareOptions>>().CurrentValue.IsConfigured);
        Assert.IsType<CloudflareCdnCache>(provider.GetRequiredService<ICdnCache>());
        Assert.IsType<ItemImagePublisher>(provider.GetRequiredService<IItemImagePublisher>());
    }
}

