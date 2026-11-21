using Domain.Entity;
using Domain.Enum;
using Domain.Services;
using Domain.Services.Ai;
using Domain.Services.Styling;

namespace Domain.Domain;

// ── E2 wardrobe ───────────────────────────────────────────────────────────────────────────────────────────────────

public record ItemDto(
    string Id,
    string? Name,
    ItemCategory Category,
    IReadOnlyList<string> ColorIds,
    string? Fabric,
    IReadOnlyList<Season> Seasons,
    string? Size,
    string? Brand,
    ItemSource Source,
    string? ProductId,
    string? LibraryItemId,
    string? ImageUrl,
    DateTime? ImageUrlExpiresAt,
    bool HasOriginalImage,
    bool UseOriginalImage,
    int WearCount,
    string? LastWornAt,
    ItemListingStatus ListingStatus,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    long Version,
    string? Subcategory = null,
    string? FabricText = null,
    string? ColorHex = null,
    // Owner-only: { hidden: true, reason } when a moderator removed the item from everyone else; null otherwise.
    ModerationDto? Moderation = null,
    // docs/images.md: imageUrl = full size (viewer), mediumUrl = 768 px (detail), thumbUrl = 256 px (lists). Public CDN URLs
    // (imageUrlExpiresAt null) once Photos:PublicUrlsEnabled is on; presigned otherwise. imageCacheKey stays the same while
    // the image does — the app's image cache key.
    string? ThumbUrl = null,
    string? MediumUrl = null,
    string? ImageCacheKey = null);

public record ItemDetailDto(ItemDto Item, IReadOnlyList<LookDto> Looks);

public record ItemUploadDto(string UploadId, string Url, IReadOnlyDictionary<string, string> Fields, DateTime ExpiresAt, long MaxBytes);

public record ItemUploadsDto(IReadOnlyList<ItemUploadDto> Uploads);

public record ItemDraftDto(
    string Id,
    ItemDraftKind Kind,
    ItemDraftStatus Status,
    string? JobId,
    string? ParentDraftId,
    string? ImageUrl,
    string? OriginalImageUrl,
    DateTime? ImageUrlExpiresAt,
    string? Name,
    ItemCategory? Category,
    IReadOnlyList<string> ColorIds,
    string? Fabric,
    IReadOnlyList<Season> Seasons,
    IReadOnlyList<string> FlaggedFields,
    bool NeedsReview,
    string? Language,
    DateTime CreatedAt,
    string? Subcategory = null,
    string? GroupId = null,
    BoundingBox? Box = null,
    int? Index = null,
    double? Confidence = null,
    bool Selected = false,
    int? ItemCount = null,
    int? PhotoWidth = null,
    int? PhotoHeight = null,
    JobFailure? Failure = null);

/// <param name="Total">Drafts that are (or were) being processed; with Processed this is the "8 / 12" progress card.</param>
public record ItemDraftsDto(IReadOnlyList<ItemDraftDto> Drafts, int Total, int Processed);

/// <param name="SkippedCount">Photos of a bulk request that were NOT processed because a non-member's recognition allowance ran out.</param>
/// <param name="SkippedUploadIds">Their upload ids (the uploads are untouched: they can be sent again with manual = true).</param>
/// <param name="ItemRecognition">The allowance after this request (null limit = unlimited).</param>
public record StartDraftsDto(
    IReadOnlyList<ItemDraftDto> Drafts,
    IReadOnlyList<JobDto> Jobs,
    int SkippedCount = 0,
    IReadOnlyList<string>? SkippedUploadIds = null,
    ItemRecognitionDto? ItemRecognition = null);

public enum ItemCreateOutcome { Created, AlreadyApplied, Rejected }

/// <param name="RefId">draftId, libraryItemId or productId of the request row this result belongs to.</param>
public record ItemCreateResultDto(string RefId, ItemCreateOutcome Outcome, string? Code, IReadOnlyList<string>? Errors, ItemDto? Item);

public record ItemCreateResultsDto(IReadOnlyList<ItemCreateResultDto> Results, int CreatedCount);

public record LibraryItemDto(
    string Id,
    string Name,
    ItemCategory Category,
    IReadOnlyList<string> ColorIds,
    string? Fabric,
    IReadOnlyList<Season> Seasons,
    string? ImageUrl,
    CatalogSegment Segment = CatalogSegment.Women);

// ── E3 looks ──────────────────────────────────────────────────────────────────────────────────────────────────────

/// <param name="Missing">True for a catalog product reference: a piece the user does not own ("Eksik parça").</param>
/// <param name="Unavailable">True when the referenced wardrobe item was deleted ("silinmiş parça").</param>
public record LookSlotDto(OutfitSlot Slot, string? ItemId, string? ProductId, bool Missing, bool Unavailable);

public record LookDto(
    string Id,
    string? Name,
    Occasion? Occasion,
    IReadOnlyList<LookSlotDto> Slots,
    int PieceCount,
    bool HasMissingPieces,
    bool Favorite,
    LookSource Source,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    long Version,
    // Friends' ratings of this look (average 1 decimal, count). Filled by GET look / GET look/{id}; null elsewhere and when nobody rated.
    LookRatingSummaryDto? Rating = null,
    // Owner-only: { hidden: true, reason } when a moderator removed the look from everyone else; null otherwise.
    ModerationDto? Moderation = null,
    // Imported look: presigned GET of the outfit photo it came from (GET look / look/{id}, owner only); null otherwise.
    string? CoverImageUrl = null,
    DateTime? CoverImageUrlExpiresAt = null);

public record LookRatingSummaryDto(double Average, long Count);

/// <summary>Screen 28 profile counters.</summary>
public record ProfileStatsDto(int ItemCount, int LookCount, int TripCount, int FollowerCount, int FollowingCount);

// ── E4 today / plan / calendar ────────────────────────────────────────────────────────────────────────────────────

public record WeatherDto(string Date, int MinTempC, int MaxTempC, WeatherCondition Condition, int? PrecipitationChance);

public record PlanDayDto(string Date, Occasion? Occasion, string? LookId, LookDto? Look, bool Worn, long Version, DateTime? UpdatedAt);

public record WearLogDto(string Id, string Date, string? LookId, IReadOnlyList<string> ItemIds, DateTime OccurredAt);

public record ItemWearDto(string ItemId, int WearCount, string? LastWornAt);

public record WearLogResultDto(WearLogDto Log, IReadOnlyList<ItemWearDto> Items);

public record MostWornItemDto(string ItemId, int Days, ItemDto? Item);

public record WearSummaryDto(string Month, int LoggedDays, int TotalWears, IReadOnlyList<MostWornItemDto> MostWorn);

public record WeekStripDayDto(string Date, bool HasPlan, bool Worn);

public record TodayDto(
    string Date,
    Season Season,
    WeatherDto? Weather,
    Occasion? Occasion,
    PlanDayDto? Plan,
    LookDto? Look,
    bool HasMissingPieces,
    IReadOnlyList<LookSlotDto> MissingPieces,
    bool Worn,
    IReadOnlyList<WeekStripDayDto> Week);

// ── E5 stylist / trips ────────────────────────────────────────────────────────────────────────────────────────────

public record AcceptedSuggestionDto(LookDto Look, PlanDayDto? PlanDay);

public record AcceptedWeekDto(IReadOnlyList<PlanDayDto> Days);

/// <param name="LibraryItemId">A ready-library piece Droblet picked to fill the gap ("Önerilen · Kütüphane"); ProductId = a shop piece ("Önerilen · Mağaza").</param>
public record MissingPieceDto(OutfitSlot Slot, ItemCategory? Category, MissingPieceReason Reason, string? ProductId, string? LibraryItemId = null);

public enum TripStatus { Upcoming, Active, Past }

public record TripDto(
    string Id,
    string CityId,
    string? CityName,
    string StartDate,
    string EndDate,
    IReadOnlyList<TripType> TripTypes,
    bool CabinOnly,
    TripStatus Status,
    bool Archived,
    DateTime? ArchivedAt,
    int DayCount,
    int ItemCount,
    int PackedCount,
    bool EveryPieceWornTwice,
    IReadOnlyList<MissingPieceDto> Missing,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    long Version);

public record TripItemDto(string ItemId, int PlannedWears, bool Packed, DateTime? PackedAt, bool Unavailable);

public record TripDayDto(string Date, string? Label, Occasion? Occasion, IReadOnlyList<LookSlotDto> Slots, WeatherDto? Weather);

/// <summary>
/// Where the trip's forecast stands. <c>available</c> = every trip day is known · <c>partial</c> = the first days are known,
/// the rest is past the provider's horizon (or already over) · <c>beyondRange</c> = the trip starts after the horizon
/// ("not available yet", shown quietly) · <c>past</c> = the trip is over · <c>unavailable</c> = the provider failed and
/// nothing is cached (retry later) · <c>noLocation</c> = the trip's city could not be resolved to coordinates.
/// </summary>
public enum TripForecastStatus { Available, Partial, BeyondRange, Past, Unavailable, NoLocation }

/// <summary>The trip's daily forecast, independent of the packing list. <c>HorizonEnd</c> = last forecast day the provider covers.</summary>
public record TripForecastDto(TripForecastStatus Status, IReadOnlyList<WeatherDto> Days, string? HorizonEnd);

public record TripDetailDto(TripDto Trip, IReadOnlyList<TripItemDto> Items, IReadOnlyList<TripDayDto> Days, TripForecastDto? Forecast = null);

// ── E6 try-on ─────────────────────────────────────────────────────────────────────────────────────────────────────

public enum StartStatus { Cached, Queued }

/// <param name="Source">body = rendered on the body photo; face = built from the face photo + chosen body type (the app says so on the image).</param>
/// <param name="ReferenceUrl">Photo try-on: the outfit photo it was made from ("Kaynak fotoğraf"), presigned like Url; null otherwise.</param>
public record TryOnImageDto(string Id, string Url, DateTime UrlExpiresAt, DateTime CreatedAt, TryOnSource Source = TryOnSource.Body, string? ReferenceUrl = null);

/// <param name="Status">cached = image already exists (no credit charged); queued = a job is running (1 credit reserved).</param>
public record TryOnStartDto(StartStatus Status, TryOnImageDto? Image, JobDto? Job);

public record TryOnQuoteItemDto(string Date, string LookId, bool Cached, string? TryOnImageId);

public record TryOnQuoteDto(
    string WeekStart,
    int RequiredCredits,
    int CachedCount,
    int RemainingCredits,
    bool Sufficient,
    IReadOnlyList<TryOnQuoteItemDto> Items);

public record TryOnBatchItemDto(string Date, string LookId, StartStatus Status, TryOnImageDto? Image, JobDto? Job);

public record TryOnBatchDto(int ChargedCredits, IReadOnlyList<TryOnBatchItemDto> Items);

// ── E7 palette ────────────────────────────────────────────────────────────────────────────────────────────────────

public record PaletteColorDto(string Id, string Family, string Hex, string Name);

/// <param name="UnmatchedCount">Pieces whose colour is in none of the lists (only when Palette:NeutralColorIds is configured).</param>
/// <param name="NeutralsCountAsCompatible">How Percent was computed: true = (compatible + neutral) / total.</param>
public record PaletteCompatibilityDto(int? Percent, int TotalCount, int CompatibleCount, int NeutralCount, int IncompatibleCount,
    int UnmatchedCount = 0, bool NeutralsCountAsCompatible = true);

public record PaletteDto(
    string SeasonTypeId,
    string SeasonName,
    IReadOnlyList<PaletteColorDto> Flattering,
    IReadOnlyList<PaletteColorDto> Avoid,
    bool LowConfidence,
    bool SourcePhotoActive,
    DateTime AnalyzedAt,
    PaletteCompatibilityDto Compatibility);

public record PaletteStartDto(StartStatus Status, PaletteDto? Palette, JobDto? Job);

public record PaletteMismatchDto(IReadOnlyList<ItemDto> Items);

// ── Reference vocabularies ────────────────────────────────────────────────────────────────────────────────────────

public record SeasonTypeDto(string Id, string Name, IReadOnlyList<string> FlatteringColorIds, IReadOnlyList<string> AvoidColorIds);

public record SlotCategoriesDto(OutfitSlot Slot, IReadOnlyList<ItemCategory> Categories);

public record WardrobeReferenceDto(
    IReadOnlyList<PaletteColorDto> Colors,
    IReadOnlyList<string> Fabrics,
    IReadOnlyList<ItemCategory> Categories,
    IReadOnlyList<Season> Seasons,
    IReadOnlyList<Occasion> Occasions,
    IReadOnlyList<TripType> TripTypes,
    IReadOnlyList<SlotCategoriesDto> Slots,
    IReadOnlyList<SeasonTypeDto> SeasonTypes,
    int LookMinPieces,
    int MaxBulkItems,
    string Language);

public static class WardrobeDtoMapper
{
    public static LookSlotDto ToDto(this LookSlotValue slot, IReadOnlySet<string> existingItemIds) =>
        new(slot.Slot, slot.ItemId, slot.ProductId, slot.ProductId is not null, slot.ItemId is not null && !existingItemIds.Contains(slot.ItemId));

    public static LookDto ToDto(this LookEntity entity, IReadOnlySet<string> existingItemIds)
    {
        var slots = entity.Slots.OrderBy(s => s.Slot).Select(s => s.ToDto(existingItemIds)).ToList();
        return new LookDto(entity.Id, entity.Name, entity.Occasion, slots, slots.Count, slots.Any(s => s.Missing || s.Unavailable),
            entity.Favorite, entity.Source, entity.CreatedAt, entity.UpdatedAt, entity.Version, Moderation: entity.ToModerationDto());
    }

    public static WearLogDto ToDto(this WearLogEntity entity) =>
        new(entity.Id, entity.Date, entity.LookId, entity.ItemIds, entity.OccurredAt);

    public static WeatherDto ToDto(this DailyForecast forecast) =>
        new(forecast.Date, WeatherRules.WholeDegrees(forecast.MinC), WeatherRules.WholeDegrees(forecast.MaxC), forecast.Condition, forecast.PrecipitationProbability);

    public static MissingPieceDto ToDto(this MissingPieceValue value) => new(value.Slot, value.Category, value.Reason, value.ProductId, value.LibraryItemId);

    public static MissingPieceValue ToValue(this MissingPiece piece) =>
        new() { Slot = piece.Slot, Category = piece.Category, Reason = piece.Reason, ProductId = piece.ProductId, LibraryItemId = piece.LibraryItemId };

    public static LookSlotValue ToValue(this SlotRef slot) => new() { Slot = slot.Slot, ItemId = slot.ItemId, ProductId = slot.ProductId };

    public static PaletteColorDto ToDto(this ColorDefinition color, string? language) => new(color.Id, color.Family, color.Hex, Localized.Resolve(color.Name, language));

    public static CandidateItem ToCandidate(this ItemEntity item) =>
        new(item.Id, item.Category, item.ColorIds, item.Fabric, item.Seasons, item.WearCount, item.LastWornAt);

    public static WardrobeReferenceDto Reference(string? language) => new(
        ColorCatalog.All.Select(c => c.ToDto(language)).ToList(),
        FabricCatalog.Ids,
        System.Enum.GetValues<ItemCategory>(),
        System.Enum.GetValues<Season>(),
        System.Enum.GetValues<Occasion>(),
        System.Enum.GetValues<TripType>(),
        OutfitSlotRules.Slots.Select(s => new SlotCategoriesDto(s, System.Enum.GetValues<ItemCategory>().Where(c => OutfitSlotRules.Accepts(s, c)).ToList())).ToList(),
        SeasonTypeCatalog.All.Select(s => new SeasonTypeDto(s.Id, Localized.Resolve(s.Name, language), s.FlatteringColorIds, s.AvoidColorIds)).ToList(),
        OutfitSlotRules.MinPieces,
        ItemDraftRules.MaxBulk,
        Localized.Language(language));
}
