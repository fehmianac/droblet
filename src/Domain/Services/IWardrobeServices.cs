using Domain.Domain;
using Domain.Enum;
using Domain.Services.Ai;
using Domain.Services.Styling;

namespace Domain.Services;

// Commands are also the Api request bodies (validators live next to the endpoints).

// ── E2 ────────────────────────────────────────────────────────────────────────────────────────────────────────────

public sealed record UpdateItemCommand(
    string? Name,
    ItemCategory Category,
    IReadOnlyList<string> ColorIds,
    string? Fabric,
    IReadOnlyList<Season> Seasons,
    string? Size,
    string? Brand,
    bool? UseOriginalImage,
    long BaseVersion,
    string? Subcategory = null,
    string? FabricText = null,
    string? ColorHex = null);

/// <summary>"Fotoğrafsız ekle": a piece typed in by hand. The new item id is itemId ?? clientMutationId.</summary>
public sealed record CreateItemCommand(
    string ClientMutationId,
    ItemCategory? Category,
    IReadOnlyList<string>? ColorIds,
    IReadOnlyList<Season>? Seasons,
    string? ItemId = null,
    string? Name = null,
    string? Subcategory = null,
    string? ColorHex = null,
    string? Fabric = null,
    string? FabricText = null,
    string? Size = null,
    string? Brand = null);

public sealed record ItemUploadsCommand(int Count, string ContentType);

/// <param name="SplitOutfit">Legacy and ignored: every AI photo runs the multi-item detection (one piece → a single draft, more → a draft group).</param>
/// <param name="Manual">
/// True = no AI: every photo becomes a ready draft without suggestions that the user fills in by hand (no job, no
/// recognition allowance used). This is how a non-member adds a piece after the free recognitions are used up.
/// </param>
public sealed record StartDraftsCommand(string RequestId, IReadOnlyList<string> UploadIds, bool SplitOutfit = false, bool Manual = false);

public sealed record ConfirmDraftCommand(
    string DraftId,
    string ClientMutationId,
    bool Reviewed,
    string? Name,
    ItemCategory? Category,
    IReadOnlyList<string>? ColorIds,
    string? Fabric,
    IReadOnlyList<Season>? Seasons,
    string? Size,
    string? Brand,
    bool UseOriginalImage = false,
    string? ItemId = null,
    string? Subcategory = null,
    string? FabricText = null,
    string? ColorHex = null);

public sealed record ConfirmDraftsCommand(IReadOnlyList<ConfirmDraftCommand> Items);

/// <summary>The user's values for a detected piece, edited in the form before it was selected (replace the AI suggestion).</summary>
public sealed record DetectedPieceEdit(
    string DraftId,
    string? Name,
    ItemCategory? Category,
    string? Subcategory,
    IReadOnlyList<string>? ColorIds,
    string? Fabric,
    IReadOnlyList<Season>? Seasons);

/// <summary>"N parçayı ekle" on a draft group: the pieces to keep (their background removal is queued); every other detected piece is discarded.</summary>
public sealed record SelectDraftsCommand(IReadOnlyList<string> DraftIds, IReadOnlyList<DetectedPieceEdit>? Edits = null);

public sealed record AddLibraryItemCommand(string ClientMutationId, string LibraryItemId, string? Size = null, string? ItemId = null);

public sealed record AddLibraryItemsCommand(IReadOnlyList<AddLibraryItemCommand> Items);

public sealed record AddProductItemCommand(string ClientMutationId, string ProductId, string? Size = null, string? ItemId = null);

public interface IWardrobeService
{
    Task<IReadOnlyList<ItemDto>> GetItemsAsync(string tenantId, CancellationToken ct);
    /// <summary>Outfit import commit: one new piece as a wardrobe item (receipt + item; its original crop is the image until cleaned).</summary>
    Task<ItemCreateResultDto> CreateImportedItemAsync(string tenantId, ImportedItemCommand command, CancellationToken ct);
    Task<ItemDetailDto?> GetItemAsync(string tenantId, string id, CancellationToken ct);
    Task<ServiceResult<ItemDto>> UpdateItemAsync(string tenantId, string id, UpdateItemCommand command, CancellationToken ct);
    Task<bool> DeleteItemAsync(string tenantId, string id, CancellationToken ct);
    /// <summary>Manual piece without a photo (source = manual). Idempotent by clientMutationId.</summary>
    Task<ItemCreateResultDto> CreateItemAsync(string tenantId, CreateItemCommand command, CancellationToken ct);

    Task<ItemUploadsDto> CreateUploadsAsync(string tenantId, ItemUploadsCommand command, CancellationToken ct);
    Task<ServiceResult<StartDraftsDto>> StartDraftsAsync(string tenantId, StartDraftsCommand command, string? requestLanguage, CancellationToken ct);
    /// <summary>"Tekrar dene": queues a new ItemProcessor job for a failed draft, on the photo it already has.</summary>
    Task<ServiceResult<StartDraftsDto>> RetryDraftAsync(string tenantId, string draftId, string? requestLanguage, CancellationToken ct);
    Task<ItemDraftsDto> GetDraftsAsync(string tenantId, CancellationToken ct);
    Task<bool> DeleteDraftAsync(string tenantId, string draftId, CancellationToken ct);
    Task<ItemCreateResultsDto> ConfirmDraftsAsync(string tenantId, IReadOnlyList<ConfirmDraftCommand> items, CancellationToken ct);
    /// <summary>Selection on a draft group: keeps the chosen pieces (one background-removal job each, no recognition), discards the rest.</summary>
    Task<ServiceResult<StartDraftsDto>> SelectDraftsAsync(string tenantId, string groupId, SelectDraftsCommand command, CancellationToken ct);

    Task<IReadOnlyList<LibraryItemDto>> GetLibraryAsync(string tenantId, string? requestLanguage, CancellationToken ct);
    Task<ItemCreateResultsDto> AddFromLibraryAsync(string tenantId, IReadOnlyList<AddLibraryItemCommand> items, string? requestLanguage, CancellationToken ct);

    /// <summary>
    /// Hook for the catalog side ("Gardıroba ekle", screen 22; "satın alınan parçayı gardıroba ekleyelim mi?").
    /// The caller passes the product snapshot it already holds; the wardrobe never reads catalog tables itself here.
    /// Idempotent by clientMutationId; the new item id is itemId ?? clientMutationId.
    /// </summary>
    Task<ItemCreateResultDto> AddFromProductAsync(string tenantId, ProductSnapshot product, string clientMutationId, string? size, string? itemId, CancellationToken ct);

    /// <summary>ItemDto (with short-lived image URLs) for entities the caller already loaded.</summary>
    Task<ItemDto> ToDtoAsync(Entity.ItemEntity item, CancellationToken ct);
}

// ── E3 ────────────────────────────────────────────────────────────────────────────────────────────────────────────

public sealed record LookSlotInput(OutfitSlot Slot, string? ItemId = null, string? ProductId = null);

public sealed record CreateLookCommand(
    string Id,
    string? Name,
    Occasion? Occasion,
    IReadOnlyList<LookSlotInput> Slots,
    bool Favorite = false,
    LookSource Source = LookSource.User);

public sealed record UpdateLookCommand(string? Name, Occasion? Occasion, IReadOnlyList<LookSlotInput> Slots, bool Favorite, long BaseVersion);

public interface ILookService
{
    Task<IReadOnlyList<LookDto>> GetAllAsync(string tenantId, CancellationToken ct);
    Task<LookDto?> GetAsync(string tenantId, string id, CancellationToken ct);
    Task<ServiceResult<LookDto>> CreateAsync(string tenantId, CreateLookCommand command, CancellationToken ct);
    Task<ServiceResult<LookDto>> UpdateAsync(string tenantId, string id, UpdateLookCommand command, CancellationToken ct);
    Task<bool> DeleteAsync(string tenantId, string id, CancellationToken ct);

    /// <summary>Resolves slot references inside the caller's tenant (+ catalog) and returns OutfitSlotRules violations.</summary>
    Task<IReadOnlyList<string>> ValidateSlotsAsync(string tenantId, IReadOnlyList<SlotRef> slots, CancellationToken ct);
}

/// <summary>
/// AI flat-lay cover of saved looks, Api side (LookCoverRules; the TryOn worker renders it). Owner only: other tenants never
/// see it. Every user, no credit.
/// </summary>
public interface ILookCoverService
{
    /// <summary>
    /// Queues the cover when the look's current pieces never had one requested (create, update, stylist accept). Best effort:
    /// never throws (the look is already saved). Returns the look's cover row as it is afterwards (null = none).
    /// </summary>
    Task<Entity.LookCoverEntity?> RequestAsync(Entity.LookEntity look, CancellationToken ct);
    Task<Entity.LookCoverEntity?> GetAsync(string tenantId, string lookId, CancellationToken ct);
    /// <summary>Every cover row of the tenant, by look id (one partition read).</summary>
    Task<IReadOnlyDictionary<string, Entity.LookCoverEntity>> GetAllAsync(string tenantId, CancellationToken ct);
    /// <summary>coverImageUrl = the imported look's photo, else the ready AI cover of the look's current pieces; coverPending.</summary>
    Task<LookDto> WithCoverAsync(Entity.LookEntity look, LookDto dto, Entity.LookCoverEntity? cover, CancellationToken ct);
    /// <summary>Removes the cover row and its image (look deleted).</summary>
    Task DeleteAsync(string tenantId, string lookId, CancellationToken ct);
}

// ── E4 ────────────────────────────────────────────────────────────────────────────────────────────────────────────

public sealed record PutPlanDayCommand(Occasion? Occasion, string? LookId, long BaseVersion);

/// <summary>Either LookId or ItemIds. Date = the user's calendar day; OccurredAt = device instant (UTC).</summary>
public sealed record WearLogCommand(string ClientMutationId, string Date, DateTime OccurredAt, string? LookId = null, IReadOnlyList<string>? ItemIds = null);

public interface IPlanService
{
    Task<IReadOnlyList<PlanDayDto>> GetPlanDaysAsync(string tenantId, DateOnly from, DateOnly to, CancellationToken ct);
    Task<ServiceResult<PlanDayDto>> PutPlanDayAsync(string tenantId, string date, PutPlanDayCommand command, CancellationToken ct);
    Task<bool> DeletePlanDayAsync(string tenantId, string date, CancellationToken ct);

    Task<ServiceResult<WearLogResultDto>> LogWearAsync(string tenantId, WearLogCommand command, CancellationToken ct);
    Task<bool> DeleteWearLogAsync(string tenantId, string date, string id, CancellationToken ct);
    Task<IReadOnlyList<WearLogDto>> GetWearLogsAsync(string tenantId, DateOnly month, CancellationToken ct);
    Task<WearSummaryDto> GetWearSummaryAsync(string tenantId, DateOnly month, CancellationToken ct);

    Task<TodayDto> GetTodayAsync(string tenantId, DateOnly date, double? latitude, double? longitude, CancellationToken ct);
}

// ── E5 ────────────────────────────────────────────────────────────────────────────────────────────────────────────

public sealed record StartOutfitCommand(
    string RequestId,
    string Date,
    Occasion? Occasion = null,
    string? FreeText = null,
    bool OnlyMyWardrobe = true,
    string? PinnedItemId = null,
    string? CityId = null,
    double? Latitude = null,
    double? Longitude = null);

public sealed record StartWeekCommand(
    string RequestId,
    string WeekStart,
    IReadOnlyList<WeekDayRequest>? Days = null,
    bool OnlyMyWardrobe = true,
    string? CityId = null,
    double? Latitude = null,
    double? Longitude = null);

/// <param name="LookId">Id of the look to create (defaults to clientMutationId).</param>
/// <param name="PlanDate">"Takvime ekle": also plans the look on this day. null = only save to the lookbook.</param>
public sealed record AcceptSuggestionCommand(string ClientMutationId, string? LookId = null, string? Name = null, string? PlanDate = null, bool Favorite = false);

/// <param name="Dates">Days to accept; null = every day of the plan that has a look.</param>
public sealed record AcceptWeekCommand(string ClientMutationId, IReadOnlyList<string>? Dates = null);

public sealed record DislikeCommand(DislikeReason Reason = DislikeReason.Other);

public interface IStylistService
{
    Task<ServiceResult<JobDto>> StartOutfitAsync(string tenantId, StartOutfitCommand command, string? requestLanguage, CancellationToken ct);
    Task<ServiceResult<JobDto>> StartWeekAsync(string tenantId, StartWeekCommand command, string? requestLanguage, CancellationToken ct);
    Task<ServiceResult<AcceptedSuggestionDto>> AcceptSuggestionAsync(string tenantId, string jobId, int index, AcceptSuggestionCommand command, CancellationToken ct);
    Task<ServiceResult<AcceptedWeekDto>> AcceptWeekAsync(string tenantId, string jobId, AcceptWeekCommand command, CancellationToken ct);
    Task<ServiceResult<bool>> DislikeAsync(string tenantId, string jobId, int index, DislikeCommand command, CancellationToken ct);
}

public sealed record CreateTripCommand(
    string Id,
    string CityId,
    string? CityName,
    string StartDate,
    string EndDate,
    IReadOnlyList<TripType>? TripTypes = null,
    bool CabinOnly = false);

public sealed record UpdateTripCommand(
    string CityId,
    string? CityName,
    string StartDate,
    string EndDate,
    IReadOnlyList<TripType>? TripTypes,
    bool CabinOnly,
    long BaseVersion);

public sealed record StartPackCommand(string RequestId);

public sealed record AcceptPackCommand(string ClientMutationId);

public sealed record MarkPackedCommand(bool Packed, string ClientMutationId, DateTime OccurredAt);

public interface ITripService
{
    Task<IReadOnlyList<TripDto>> GetAllAsync(string tenantId, CancellationToken ct);
    Task<TripDetailDto?> GetAsync(string tenantId, string id, CancellationToken ct);
    Task<ServiceResult<TripDto>> CreateAsync(string tenantId, CreateTripCommand command, CancellationToken ct);
    Task<ServiceResult<TripDto>> UpdateAsync(string tenantId, string id, UpdateTripCommand command, CancellationToken ct);
    Task<bool> DeleteAsync(string tenantId, string id, CancellationToken ct);
    Task<ServiceResult<TripDto>> ArchiveAsync(string tenantId, string id, bool archived, CancellationToken ct);
    Task<ServiceResult<JobDto>> StartPackAsync(string tenantId, string id, StartPackCommand command, string? requestLanguage, CancellationToken ct);
    Task<ServiceResult<TripDetailDto>> AcceptPackAsync(string tenantId, string id, string jobId, AcceptPackCommand command, CancellationToken ct);
    Task<ServiceResult<TripItemDto>> MarkPackedAsync(string tenantId, string id, string itemId, MarkPackedCommand command, CancellationToken ct);
}

// ── E6 ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/// <param name="Id">item id, look id, product id, edit look id — or the stylist job id for kind = suggestion.</param>
/// <param name="Index">Suggestion index (kind = suggestion only).</param>
public sealed record TryOnTargetInput(TryOnTargetKind Kind, string Id, int? Index = null);

public sealed record StartTryOnCommand(string RequestId, TryOnTargetInput Target);

/// <param name="ExpectedCredits">The requiredCredits the user confirmed on the quote ("7 kredi harcanacak").</param>
public sealed record TryOnWeekCommand(string RequestId, string WeekStart, int ExpectedCredits);

public interface ITryOnService
{
    Task<ServiceResult<TryOnStartDto>> StartAsync(string tenantId, StartTryOnCommand command, CancellationToken ct);
    Task<ServiceResult<TryOnImageDto>> FindAsync(string tenantId, TryOnTargetInput target, CancellationToken ct);
    Task<TryOnImageDto?> GetAsync(string tenantId, string imageId, CancellationToken ct);
    Task<ServiceResult<TryOnQuoteDto>> QuoteWeekAsync(string tenantId, string weekStart, CancellationToken ct);
    Task<ServiceResult<TryOnBatchDto>> StartWeekAsync(string tenantId, TryOnWeekCommand command, CancellationToken ct);

    /// <summary>The path a try-on would take now (body photo preferred, else face photo); null = no photo. Decides the consents asked for.</summary>
    Task<TryOnSource?> PathAsync(string tenantId, CancellationToken ct);
}

// ── E7 ────────────────────────────────────────────────────────────────────────────────────────────────────────────

public sealed record StartPaletteCommand(string RequestId);

public interface IPaletteService
{
    Task<ServiceResult<PaletteStartDto>> StartAsync(string tenantId, StartPaletteCommand command, string? requestLanguage, CancellationToken ct);
    Task<PaletteDto?> GetAsync(string tenantId, string? requestLanguage, CancellationToken ct);
    Task<PaletteMismatchDto?> GetMismatchAsync(string tenantId, CancellationToken ct);
    /// <summary>Flattering / avoid colour ids of the stored palette; null = no palette yet.</summary>
    Task<(IReadOnlySet<string> Flattering, IReadOnlySet<string> Avoid)?> GetColorsAsync(string tenantId, CancellationToken ct);
    Task DeleteAsync(string tenantId, CancellationToken ct);
}
