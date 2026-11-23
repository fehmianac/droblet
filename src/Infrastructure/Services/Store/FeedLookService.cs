using Domain.Constant;
using Domain.Domain;
using Domain.Entity;
using Domain.Enum;
using Domain.Extensions;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Domain.Validation;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Infrastructure.Services.Store;

/// <summary>
/// "Looklarıma ekle" on an Akış editor post that was split into pieces (owner decision 2026-11-23).
/// Inspiration: the post's photograph is copied under the member's prefix and becomes the cover of a look without pieces
/// (LookSource.Inspiration) — no AI cover, never shareable, nothing added to the wardrobe.
/// Pieces: every piece becomes a wardrobe item (its clean picture copied into the member's storage and published like a
/// confirmed item's; no background removal, no recognition — nothing here calls an AI model) and a normal own look is made
/// of them, one piece per slot. That look's AI cover is requested by the rule of every saved look (ILookCoverService).
/// Pictures are read from the public catalog image bucket only (IPublicImageReader). Image keys and URLs are never logged.
/// </summary>
public sealed class FeedLookService(
    IRepository repository,
    IObjectStorage storage,
    IPublicImageReader publicImages,
    IWardrobeService wardrobe,
    IEntitlementService entitlements,
    ILookCoverService covers,
    IRequestLanguage requestLanguage,
    IOptionsMonitor<PhotoOptions> photoOptions,
    TimeProvider timeProvider,
    ILogger<FeedLookService> logger) : IFeedLookService
{
    /// <summary>Same cap as a look name sent by the app (CreateLookCommandValidator).</summary>
    public const int MaxNameLength = 60;

    private DateTime Now => timeProvider.GetUtcNow().UtcDateTime;

    public async Task<ServiceResult<LookDto>> SaveAsLookAsync(string tenantId, string postId, SaveFeedPostAsLookCommand command, CancellationToken ct)
    {
        // Editor posts only: a weekly-edit stand-in or a shared look of another user has no pieces to save.
        if (FeedRules.IsUserPostId(postId) || FeedRules.EditLookIdOf(postId) is not null || !FeedInputRules.IsId(postId))
            return ServiceResult.NotFound<LookDto>(ErrorCodes.NotFound);
        var post = await repository.GetAsync<FeedPostEntity>(FeedPostEntity.GetPk(), FeedPostEntity.GetSk(postId), ct);
        if (post is null || !FeedRules.IsLive(post, Now))
            return ServiceResult.NotFound<LookDto>(ErrorCodes.NotFound);
        if (!FeedRules.CanSaveAsLook(post, command.Mode))
            return ServiceResult.Invalid<LookDto>(StoreSocialErrorCodes.LookNotSavable);

        // The same post in the same mode again: the look made then, while it exists (a deleted one is made anew).
        var looks = await repository.GetAllAsync<LookEntity>(LookEntity.GetPk(tenantId), ct);
        if (looks.FirstOrDefault(l => FeedRules.IsLookOf(l, postId, command.Mode)) is { } existing)
            return ServiceResult.Ok(await ToDtoAsync(existing, await covers.GetAsync(tenantId, existing.Id, ct), ct));
        if (looks.Any(l => l.Id == command.RequestId))
            return ServiceResult.Conflict<LookDto>(null, ErrorCodes.LookIdTaken);

        var language = await requestLanguage.GetAsync(ct);
        var name = Name(post, language);
        return command.Mode == FeedLookMode.Inspiration
            ? await InspirationAsync(tenantId, post, command.RequestId, name, ct)
            : await PiecesAsync(tenantId, post, command.RequestId, name, language, ct);
    }

    // ── İlham olarak kaydet ───────────────────────────────────────────────────────────────────────────────────────

    private async Task<ServiceResult<LookDto>> InspirationAsync(string tenantId, FeedPostEntity post, string lookId, string? name, CancellationToken ct)
    {
        var raw = await publicImages.ReadAsync(post.ImageUrls[0].Trim(), photoOptions.CurrentValue.MaxUploadBytes, ct);
        if (raw is null || Picture(raw) is not { } photo)
            return ServiceResult.Invalid<LookDto>(StoreSocialErrorCodes.LookNotSavable);

        var key = StorageKeys.LookPhoto(tenantId, lookId, photo.Extension);
        await storage.PutAsync(key, photo.Data, photo.ContentType, ct);
        var now = Now;
        var look = new LookEntity
        {
            Id = lookId,
            TenantId = tenantId,
            Name = name,
            Occasion = post.Occasion,
            Slots = [],
            Source = LookSource.Inspiration,
            CoverImageKey = key,
            FeedPostId = post.Id,
            CreatedAt = now,
            UpdatedAt = now,
        };
        if (!await repository.SaveIfVersionAsync(look, 0, ct))
            return await RaceAsync(tenantId, post.Id, FeedLookMode.Inspiration, lookId, ct);
        logger.LogInformation("Feed post {PostId} saved as an inspiration look {LookId} by tenant {TenantId}", post.Id, lookId, tenantId);
        return ServiceResult.Created(await ToDtoAsync(look, null, ct));
    }

    // ── Parçalarıyla kaydet ───────────────────────────────────────────────────────────────────────────────────────

    private async Task<ServiceResult<LookDto>> PiecesAsync(string tenantId, FeedPostEntity post, string lookId, string? name, string language, CancellationToken ct)
    {
        // The same gate as every way of adding a piece (Capability.WardrobeItem), asked once before anything is copied.
        var decision = await entitlements.CheckAsync(tenantId, Capability.WardrobeItem, ct);
        if (!decision.Allowed)
            return ServiceResult.Denied<LookDto>(decision);

        // Every picture first: a piece whose picture cannot be read is left out, and a look still needs two pieces.
        var maxBytes = photoOptions.CurrentValue.MaxUploadBytes;
        var readable = new List<(FeedPostPiece Piece, int Index, StoredPicture Picture)>(post.Pieces.Count);
        for (var index = 0; index < post.Pieces.Count; index++)
        {
            var piece = post.Pieces[index];
            if (await publicImages.ReadAsync(piece.ImageUrl.Trim(), maxBytes, ct) is { } raw && Picture(raw) is { } picture)
                readable.Add((piece, index, picture));
        }
        var slots = FeedRules.LookSlots(readable.Select(r => r.Piece.Category).ToList());
        if (slots.Count < OutfitSlotRules.MinPieces)
            return ServiceResult.Invalid<LookDto>(StoreSocialErrorCodes.LookNotSavable);

        var lookSlots = new List<LookSlotValue>(slots.Count);
        for (var position = 0; position < readable.Count; position++)
        {
            var (piece, index, picture) = readable[position];
            // Ids are a function of the request: a retry writes the same objects and finds the same receipts.
            var itemId = Ulid.Deterministic(post.PublishAt, $"feed-look:{tenantId}:{lookId}:{index}");
            string? cleanedKey = null, originalKey = null;
            if (picture.IsWebp)
            {
                // Already a clean piece picture: stored where a confirmed item's cleaned image lives. The 256 / 768 renditions
                // are not made here — the Api cannot resample (SkiaSharp lives in the item processor): the piece shows its
                // full picture (the split already capped its size) until publish-item-images adds them.
                cleanedKey = StorageKeys.ItemImage(tenantId, itemId);
                await storage.PutAsync(cleanedKey, picture.Data, picture.ContentType, ct);
            }
            else
            {
                originalKey = StorageKeys.ItemOriginal(tenantId, itemId, picture.Extension);
                await storage.PutAsync(originalKey, picture.Data, picture.ContentType, ct);
            }

            var subcategory = ItemRules.IsValidSubcategory(piece.Subcategory?.Trim()) ? piece.Subcategory?.Trim() : null;
            // The name is the piece's kind in the request language ("Blazer", else the category: "Dış giyim"). What a piece of
            // a photograph does not know takes the neutral value: the colour "other", every season, no size / brand /
            // fabric — the member edits the piece like any other.
            var result = await wardrobe.CreateImportedItemAsync(tenantId, new ImportedItemCommand(
                $"fp-{lookId}-{index}", itemId, PieceName(piece.Category, subcategory, language), piece.Category, subcategory, [ColorCatalog.OtherId], null,
                OutfitImportRules.SeasonsOrAll([]), originalKey, cleanedKey), ct);
            if (result.Outcome == ItemCreateOutcome.Rejected)
            {
                foreach (var key in new[] { cleanedKey, originalKey }.OfType<string>())
                    await storage.DeleteAsync(key, ct);
                if (result.Code == ErrorCodes.PremiumRequired)
                    return ServiceResult.Forbidden<LookDto>(ErrorCodes.PremiumRequired);
                continue;
            }
            // AlreadyApplied without an item = created by an earlier try of this request and deleted since: left out.
            if (result.Item is not null && slots.TryGetValue(position, out var slot))
                lookSlots.Add(new LookSlotValue { Slot = slot, ItemId = result.Item.Id });
        }
        if (lookSlots.Count < OutfitSlotRules.MinPieces)
            return ServiceResult.Invalid<LookDto>(StoreSocialErrorCodes.LookNotSavable);

        var now = Now;
        var look = new LookEntity
        {
            Id = lookId,
            TenantId = tenantId,
            Name = name,
            Occasion = post.Occasion,
            Slots = lookSlots.OrderBy(s => s.Slot).ToList(),
            Source = LookSource.User,
            FeedPostId = post.Id,
            CreatedAt = now,
            UpdatedAt = now,
        };
        if (!await repository.SaveIfVersionAsync(look, 0, ct))
            return await RaceAsync(tenantId, post.Id, FeedLookMode.Pieces, lookId, ct);
        // A look of own pieces: its AI flat-lay cover is asked for exactly as when the member saves a look (best effort).
        var cover = await covers.RequestAsync(look, ct);
        logger.LogInformation("Feed post {PostId} saved with its pieces as look {LookId} by tenant {TenantId}: {Items} item(s), {Slots} slot(s)",
            post.Id, lookId, tenantId, readable.Count, look.Slots.Count);
        return ServiceResult.Created(await ToDtoAsync(look, cover, ct));
    }

    // ── Helpers ───────────────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>The same request twice at once: the other one's look.</summary>
    private async Task<ServiceResult<LookDto>> RaceAsync(string tenantId, string postId, FeedLookMode mode, string lookId, CancellationToken ct)
    {
        var stored = await repository.GetAsync<LookEntity>(LookEntity.GetPk(tenantId), LookEntity.GetSk(lookId), ct);
        return stored is not null && FeedRules.IsLookOf(stored, postId, mode)
            ? ServiceResult.Ok(await ToDtoAsync(stored, await covers.GetAsync(tenantId, lookId, ct), ct))
            : ServiceResult.Conflict<LookDto>(null, ErrorCodes.LookIdTaken);
    }

    private async Task<LookDto> ToDtoAsync(LookEntity look, LookCoverEntity? cover, CancellationToken ct) =>
        await covers.WithCoverAsync(look, look.ToDto(await LookService.ItemIdsAsync(repository, look.TenantId, ct)), cover, ct);

    /// <summary>The post's title in the request language, cut to a look name's length.</summary>
    private string? Name(FeedPostEntity post, string language)
    {
        var title = LocalizedText.Resolve(post.Title, language, requestLanguage.Default)?.Trim();
        if (string.IsNullOrEmpty(title))
            return null;
        return title.Length > MaxNameLength ? title[..MaxNameLength].TrimEnd() : title;
    }

    private static readonly IReadOnlyDictionary<ItemCategory, TaxonomyLabel> CategoryNames = new Dictionary<ItemCategory, TaxonomyLabel>
    {
        [ItemCategory.Top] = new("Üst", "Top"),
        [ItemCategory.Bottom] = new("Alt", "Bottom"),
        [ItemCategory.Dress] = new("Elbise", "Dress"),
        [ItemCategory.Outerwear] = new("Dış giyim", "Outerwear"),
        [ItemCategory.Shoes] = new("Ayakkabı", "Shoes"),
        [ItemCategory.Bag] = new("Çanta", "Bag"),
        [ItemCategory.Accessory] = new("Aksesuar", "Accessory"),
        [ItemCategory.Beachwear] = new("Plaj giyim", "Beachwear"),
        [ItemCategory.Skiwear] = new("Kayak giyim", "Skiwear"),
    };

    /// <summary>A new piece's default name: its sub-type's label when it is a known one of that category, else the category's.</summary>
    public static string? PieceName(ItemCategory category, string? subcategory, string language)
    {
        var label = SubcategoryCatalog.All.FirstOrDefault(e => e.Id == subcategory && e.Category == category)?.Name
                    ?? CategoryNames.GetValueOrDefault(category);
        return label is null ? null : Localized.Resolve(label.ToMap(), language);
    }

    private sealed record StoredPicture(byte[] Data, string ContentType, string Extension, bool IsWebp);

    /// <summary>A WebP as it is (the split's piece pictures); a JPEG / PNG without its metadata; anything else is not a picture we keep.</summary>
    private static StoredPicture? Picture(byte[] data)
    {
        if (data.Length >= 12 && data.AsSpan(0, 4).SequenceEqual("RIFF"u8) && data.AsSpan(8, 4).SequenceEqual("WEBP"u8))
            return new StoredPicture(data, "image/webp", "webp", true);
        return ImageMetadataStripper.Strip(data) is { } clean ? new StoredPicture(clean.Data, clean.ContentType, clean.Extension, false) : null;
    }
}
