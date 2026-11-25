using System.Text.Json;
using System.Text.Json.Serialization;
using Domain.Enum;
using Domain.Services.Ai;

namespace Domain.Services.Styling;

/// <summary>
/// JSON of job inputs and job results (drafts). camelCase properties and camelCase enum names — the result is returned
/// verbatim inside GET v1/tenant/job/{id}, so it has to look like every other Api response.
/// </summary>
public static class StylingJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    public static string Serialize<T>(T value) => JsonSerializer.Serialize(value, Options);

    /// <summary>null when the text is not valid JSON for T — callers treat that as "no usable output".</summary>
    public static T? TryDeserialize<T>(string? json) where T : class
    {
        if (string.IsNullOrWhiteSpace(json))
            return null;
        try
        {
            return JsonSerializer.Deserialize<T>(json, Options);
        }
        catch (JsonException)
        {
            return null;
        }
    }
}

// ── Job inputs (JobEntity.Input), written by the Api, read by the workers ────────────────────────────────────────

public sealed record OutfitJobInput(
    string Date,
    Occasion? Occasion,
    string? FreeText,
    bool OnlyMyWardrobe,
    string? PinnedItemId,
    string? CityId,
    double? Latitude,
    double? Longitude,
    string Language);

public sealed record WeekDayRequest(string Date, Occasion? Occasion);

public sealed record WeekJobInput(
    string WeekStart,
    IReadOnlyList<WeekDayRequest> Days,
    bool OnlyMyWardrobe,
    string? CityId,
    double? Latitude,
    double? Longitude,
    string Language);

public sealed record PackJobInput(string TripId, string Language);

/// <param name="ReferenceKey">Photo try-on: the outfit photo (StorageKeys.TryOnReferenceUpload) worn by someone; no pieces then.</param>
public sealed record TryOnJobInput(IReadOnlyList<OutfitPiece> Pieces, string? ReferenceKey = null, string? ReferenceContentType = null);

// ── Candidates ────────────────────────────────────────────────────────────────────────────────────────────────────

/// <summary>What the model sees of a wardrobe piece: id + attributes. Never a photo, never a name the user typed.</summary>
public sealed record CandidateItem(
    string Id,
    ItemCategory Category,
    IReadOnlyList<string> ColorIds,
    string? Fabric,
    IReadOnlyList<Season> Seasons,
    int WearCount = 0,
    string? LastWornAt = null,
    // The controlled sub-type id ("oxford-shirt", ItemTaxonomy) — never free text. Only the packing prompt sends it.
    string? Subcategory = null);

// ── Job results (JobEntity.Result) — drafts; nothing is written to Look / PlanDay / Trip until the user accepts ───

/// <param name="LibraryItemId">Gap filling (owner decision 3): a ready-library piece the rules picked for this slot (free, "Gardıroba ekle").</param>
/// <param name="ProductId">A catalog piece for the slot ("Önerilen · Mağaza") — from the model's catalog candidates or the gap filling.</param>
public sealed record MissingPiece(OutfitSlot Slot, ItemCategory? Category, MissingPieceReason Reason, string? ProductId = null, string? LibraryItemId = null);

/// <summary>Title / explanation are AI text in the language recorded on the enclosing result (Language).</summary>
/// <param name="Source">"model" or "rule" (rule-based fallback; title and explanation are then null).</param>
public sealed record SuggestedOutfit(
    int Index,
    string? Title,
    string? Explanation,
    string Source,
    IReadOnlyList<SlotRef> Slots,
    IReadOnlyList<MissingPiece> Missing);

/// <param name="GapFilled">True when some suggestion carries pieces Droblet picked from the library / catalog (thin wardrobe) — the app shows the soft banner.</param>
public sealed record OutfitResult(
    string Date,
    Occasion? Occasion,
    bool OnlyMyWardrobe,
    string? Refusal,
    IReadOnlyList<SuggestedOutfit> Suggestions,
    string Language = Localized.Default,
    bool GapFilled = false);

public sealed record WeekDayPlan(string Date, Occasion? Occasion, SuggestedOutfit? Outfit);

public sealed record WeekResult(string WeekStart, string? Refusal, IReadOnlyList<WeekDayPlan> Days, string Language = Localized.Default, bool GapFilled = false);

public sealed record PackItem(string ItemId, int PlannedWears);

public sealed record PackDay(string Date, string? Label, Occasion? Occasion, IReadOnlyList<SlotRef> Slots);

/// <param name="EveryPieceWornTwice">True only when the "Her parça en az 2 kez giyiliyor" claim holds (never on 1-day trips).</param>
/// <param name="CabinLimit">The piece limit applied to a cabin-only trip (Packing:CabinMaxItems); null = no limit applied.</param>
/// <param name="CabinTrimmed">True when pieces were left out to stay within CabinLimit (the list would have been longer).</param>
/// <param name="DroppedItemIds">The pieces a rule removed from the stylist's list for the cabin limit (empty when the shorter list was built from scratch).</param>
public sealed record PackResult(
    string TripId,
    bool CabinOnly,
    bool EveryPieceWornTwice,
    string Source,
    string? Refusal,
    IReadOnlyList<PackItem> Items,
    IReadOnlyList<PackDay> Days,
    IReadOnlyList<MissingPiece> Missing,
    string Language = Localized.Default,
    int? CabinLimit = null,
    bool CabinTrimmed = false,
    IReadOnlyList<string>? DroppedItemIds = null,
    bool GapFilled = false);

public static class StylistRefusals
{
    public const string OutOfScope = "out_of_scope";
    /// <summary>Internal only since owner decision 3: answered only when even the ready library cannot fill the gaps.</summary>
    public const string InsufficientWardrobe = "insufficient_wardrobe";
    public const string PhotoUnsuitable = "photo_unsuitable";
}

// ── Raw model output (strict JSON schema, see StylistSchemas). Everything is nullable: the guard decides. ─────────

public sealed record ModelSlots(string? Top, string? Bottom, string? Outerwear, string? Shoes, string? BagAccessory)
{
    public IReadOnlyList<SlotRef> ToRefs()
    {
        var refs = new List<SlotRef>();
        void Add(OutfitSlot slot, string? id)
        {
            if (!string.IsNullOrWhiteSpace(id))
                refs.Add(new SlotRef(slot, ItemId: id));
        }

        Add(OutfitSlot.Top, Top);
        Add(OutfitSlot.Bottom, Bottom);
        Add(OutfitSlot.Outerwear, Outerwear);
        Add(OutfitSlot.Shoes, Shoes);
        Add(OutfitSlot.BagAccessory, BagAccessory);
        return refs;
    }
}

public sealed record ModelMissing(string? Slot, string? Category, string? ProductId);

public sealed record ModelOutfit(string? Title, string? Explanation, ModelSlots? Slots, IReadOnlyList<ModelMissing>? Missing);

public sealed record ModelOutfitOutput(IReadOnlyList<ModelOutfit>? Suggestions, string? Refusal);

public sealed record ModelDay(string? Date, string? Title, string? Explanation, string? Occasion, ModelSlots? Slots);

public sealed record ModelWeekOutput(IReadOnlyList<ModelDay>? Days, string? Refusal);

public sealed record ModelPackOutput(IReadOnlyList<string>? ItemIds, IReadOnlyList<ModelDay>? Days, string? Refusal);
