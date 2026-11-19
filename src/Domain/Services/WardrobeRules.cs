using Domain.Constant;
using Domain.Enum;
using Domain.Services.Ai;

namespace Domain.Services;

public sealed record GarmentDraftFields(
    string? Name,
    ItemCategory? Category,
    IReadOnlyList<string> ColorIds,
    string? Fabric,
    IReadOnlyList<Season> Seasons,
    IReadOnlyList<string> FlaggedFields,
    bool NeedsReview);

/// <summary>
/// ItemProcessor output guard. The model proposes, the server decides:
/// - a value outside the fixed vocabularies (category enum, colour dictionary, fabric list, season enum) is dropped — never guessed;
/// - a field whose confidence is below the threshold (or has no confidence at all) is kept but flagged;
/// - more than one garment in the frame flags the category;
/// - a flagged or missing category sets NeedsReview ("Kategoriyi kontrol et"). The guard only ever lowers trust.
/// </summary>
public static class GarmentVisionGuard
{
    public const string FieldCategory = "category";
    public const string FieldColors = "colorIds";
    public const string FieldFabric = "fabric";
    public const string FieldSeasons = "seasons";
    public const int MaxNameLength = 60;
    public const int MaxColors = 3;

    /// <summary>No garment in the picture -> the job fails with GuardRejected (nothing to draft).</summary>
    public static bool HasGarment(GarmentSuggestion suggestion) => suggestion.IsGarment && suggestion.GarmentCount >= 1;

    public static GarmentDraftFields Apply(GarmentSuggestion suggestion, double confidenceThreshold)
    {
        var flagged = new List<string>();
        void Flag(string field)
        {
            if (!flagged.Contains(field))
                flagged.Add(field);
        }

        bool Confident(string field) =>
            suggestion.Confidence.TryGetValue(field, out var value) && value >= confidenceThreshold;

        ItemCategory? category = suggestion.Category is { } hint
                                 && System.Enum.IsDefined(hint)
                                 && System.Enum.TryParse<ItemCategory>(hint.ToString(), out var parsed)
            ? parsed
            : null;
        if (category is null || !Confident(FieldCategory) || suggestion.GarmentCount > 1)
            Flag(FieldCategory);

        var colors = suggestion.ColorIds.Where(ColorCatalog.IsKnown).Distinct().Take(MaxColors).ToList();
        if (colors.Count == 0 || colors.Count != suggestion.ColorIds.Distinct().Take(MaxColors).Count() || !Confident(FieldColors))
            Flag(FieldColors);

        var fabric = FabricCatalog.IsKnown(suggestion.Fabric) ? suggestion.Fabric : null;
        if (fabric is null && !string.IsNullOrEmpty(suggestion.Fabric) || fabric is not null && !Confident(FieldFabric))
            Flag(FieldFabric);

        var seasons = suggestion.Seasons.Where(s => System.Enum.IsDefined(s)).Distinct().ToList();
        if (seasons.Count == 0 || seasons.Count != suggestion.Seasons.Distinct().Count() || !Confident(FieldSeasons))
            Flag(FieldSeasons);

        var name = suggestion.Name?.Trim();
        if (string.IsNullOrEmpty(name) || name.Length > MaxNameLength)
            name = null;

        return new GarmentDraftFields(name, category, colors, fabric, seasons, flagged, flagged.Contains(FieldCategory));
    }
}

/// <summary>The user's final values for a wardrobe piece (confirm, library, product, edit).</summary>
public sealed record ItemFields(
    string? Name,
    ItemCategory? Category,
    IReadOnlyList<string>? ColorIds,
    string? Fabric,
    IReadOnlyList<Season>? Seasons,
    string? Size,
    string? Brand,
    string? Subcategory = null,
    string? FabricText = null,
    string? ColorHex = null);

public static partial class ItemRules
{
    public const int MaxNameLength = 80;
    public const int MaxBrandLength = 60;
    public const int MaxSizeLength = 12;
    public const int MaxColors = 5;
    public const int MaxSubcategoryLength = 40;
    public const int MaxFabricTextLength = 60;

    [System.Text.RegularExpressions.GeneratedRegex("^[a-z0-9]+(-[a-z0-9]+)*$")]
    private static partial System.Text.RegularExpressions.Regex SubcategoryPattern();

    [System.Text.RegularExpressions.GeneratedRegex("^#[0-9A-Fa-f]{6}$")]
    private static partial System.Text.RegularExpressions.Regex HexPattern();

    /// <summary>Free sub-type id from the form ("blazer", "mini-skirt"): lower-case words joined by hyphens, at most 40 chars.</summary>
    public static bool IsValidSubcategory(string? value) =>
        value is null || value.Length <= MaxSubcategoryLength && SubcategoryPattern().IsMatch(value);

    /// <summary>Only meaningful with the colour id "other": the user's own colour as #RRGGBB.</summary>
    public static bool IsValidColorHex(string? value) => value is null || HexPattern().IsMatch(value);

    /// <summary>Normalises "#aabbcc" → "#AABBCC"; null when no "other" colour is selected (the hex would mean nothing).</summary>
    public static string? NormalizeColorHex(IReadOnlyList<string>? colorIds, string? hex) =>
        string.IsNullOrWhiteSpace(hex) || colorIds is null || !colorIds.Contains(ColorCatalog.OtherId) ? null : hex.Trim().ToUpperInvariant();

    /// <summary>
    /// Category, at least one colour and at least one season are mandatory (brief §4.3 form: "en az bir sezon zorunlu").
    /// Colours and fabric must come from the fixed vocabularies. Returns stable error codes; empty = valid.
    /// </summary>
    public static IReadOnlyList<string> Validate(ItemFields fields)
    {
        var errors = new List<string>();
        if (fields.Category is not { } category || !System.Enum.IsDefined(category))
            errors.Add(ErrorCodes.CategoryRequired);

        if (fields.ColorIds is not { Count: > 0 })
            errors.Add(ErrorCodes.ColorRequired);
        else if (fields.ColorIds.Count > MaxColors || fields.ColorIds.Any(c => !ColorCatalog.IsKnown(c)) || fields.ColorIds.Distinct().Count() != fields.ColorIds.Count)
            errors.Add(ErrorCodes.ColorUnknown);

        if (fields.Fabric is not null && !FabricCatalog.IsKnown(fields.Fabric))
            errors.Add(ErrorCodes.FabricUnknown);

        if (fields.Seasons is not { Count: > 0 } || fields.Seasons.Any(s => !System.Enum.IsDefined(s)))
            errors.Add(ErrorCodes.SeasonRequired);

        if (!IsValidSubcategory(fields.Subcategory))
            errors.Add(ErrorCodes.SubcategoryInvalid);

        if (fields.FabricText is { Length: > MaxFabricTextLength })
            errors.Add(ErrorCodes.FabricTextTooLong);

        if (!IsValidColorHex(string.IsNullOrWhiteSpace(fields.ColorHex) ? null : fields.ColorHex.Trim()))
            errors.Add(ErrorCodes.ColorHexInvalid);

        if (fields.Name is { Length: > MaxNameLength } || fields.Brand is { Length: > MaxBrandLength } || fields.Size is { Length: > MaxSizeLength })
            errors.Add(ErrorCodes.ValidationFailed);

        return errors;
    }
}

/// <summary>
/// A draft becomes an Item only on the user's confirmation, with the user's final values — the server never copies
/// AI fields on its own. A draft flagged for review can only be confirmed with reviewed = true ("select all" skips it).
/// A Failed draft may be confirmed by filling the fields by hand. The outfit source photo itself is never an item.
/// </summary>
public static class ItemDraftRules
{
    public const int MaxBulk = 30;

    /// <summary>
    /// The user's own values for a detected piece (edited before selecting it) replace the suggestion. Only valid values are
    /// taken — an invalid one leaves the suggestion as it was; the confirm form validates everything again. Edited = reviewed.
    /// </summary>
    public static void ApplyEdit(Entity.ItemDraftEntity draft, DetectedPieceEdit edit)
    {
        if (edit.Name?.Trim() is { Length: > 0 and <= ItemRules.MaxNameLength } name)
            draft.Name = name;
        if (edit.Category is { } category && System.Enum.IsDefined(category))
            draft.Category = category;
        var subcategory = edit.Subcategory?.Trim();
        if (string.IsNullOrEmpty(subcategory))
            draft.Subcategory = null;
        else if (ItemRules.IsValidSubcategory(subcategory))
            draft.Subcategory = subcategory;
        if (edit.ColorIds is { Count: > 0 and <= ItemRules.MaxColors } colors && colors.All(ColorCatalog.IsKnown) && colors.Distinct().Count() == colors.Count)
            draft.ColorIds = colors.ToList();
        if (edit.Fabric is null || FabricCatalog.IsKnown(edit.Fabric))
            draft.Fabric = edit.Fabric;
        if (edit.Seasons is { Count: > 0 } seasons && seasons.All(s => System.Enum.IsDefined(s)))
            draft.Seasons = seasons.Distinct().ToList();
        draft.FlaggedFields = [];
        draft.NeedsReview = false;
    }

    public static string? CheckConfirm(ItemDraftStatus status, ItemDraftKind kind, bool needsReview, bool reviewed)
    {
        if (kind == ItemDraftKind.Outfit)
            return ErrorCodes.DraftIsOutfitSource;
        // A detected piece is confirmed only after the user selected it and its background removal finished (or failed).
        if (status is ItemDraftStatus.Uploaded or ItemDraftStatus.Processing or ItemDraftStatus.Detected)
            return ErrorCodes.DraftNotReady;
        if (needsReview && !reviewed)
            return ErrorCodes.DraftReviewRequired;
        return null;
    }
}
