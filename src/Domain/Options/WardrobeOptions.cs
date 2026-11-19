namespace Domain.Options;

// E2–E7 options. Numbers live in config/SSM so they change without a deploy; rules stay in code.

public sealed class WardrobeOptions
{
    public const string Section = "Wardrobe";
    /// <summary>Screen 13: at most 30 photos per bulk add.</summary>
    public int MaxBatchUpload { get; set; } = 30;
    /// <summary>Legacy (outfit split, replaced by the multi-item detection); kept so the existing SSM JSON still binds.</summary>
    public int MaxSplitPieces { get; set; } = 6;
    /// <summary>Multi-item detection: at most this many pieces are kept from one photo (the most confident win).</summary>
    public int MaxDetectedItems { get; set; } = 12;
    /// <summary>Public base URL of the global asset bucket/CDN (library and catalog images). Empty = imageUrl is null for those pieces.</summary>
    public string? PublicAssetBaseUrl { get; set; }
    /// <summary>
    /// Category → outfit slots it may fill (owner decision 2026-11-18: mapping approved, kept in config). Keys are
    /// ItemCategory names, values OutfitSlot names; the first slot is where a rule puts the piece. Categories that are
    /// not listed keep the built-in mapping (SlotMapping.Default), e.g. { "Beachwear": ["Top","Bottom"],
    /// "Skiwear": ["Top","Bottom","Outerwear"] }. Unknown names are ignored.
    /// </summary>
    public Dictionary<string, List<string>> SlotMapping { get; set; } = [];
}

public sealed class StylistOptions
{
    public const string Section = "Stylist";
    public int SuggestionCount { get; set; } = 3;
    public int MaxCandidates { get; set; } = 60;
    public int MaxTitleLength { get; set; } = 40;
    public int MaxExplanationLength { get; set; } = 280;
    public int FreeTextMaxLength { get; set; } = 200;
    /// <summary>Max forecast temperature from which outerwear is left out of the candidates.</summary>
    public int HotFromC { get; set; } = 26;
    /// <summary>Min forecast temperature below which an outer layer is wanted.</summary>
    public int ColdBelowC { get; set; } = 12;
    /// <summary>How many recent "Beğenmedim" combinations are sent along as "avoid".</summary>
    public int DislikeMemory { get; set; } = 10;
    /// <summary>
    /// Week plan: at most this many days per model call; the batches run in parallel with the same candidates and a
    /// rule-based consistency pass merges them (WeekPlanning). 0 = the whole week in one call.
    /// </summary>
    public int WeekBatchDays { get; set; } = 3;

    /// <summary>
    /// Compact prompt (CandidateAliases): short candidate aliases and one descriptor string per piece, null fields left
    /// out. Fewer input and output tokens for the same decision; off = the original prompt.
    /// </summary>
    public bool CompactPrompt { get; set; }
}

public sealed class PackingOptions
{
    public const string Section = "Packing";
    /// <summary>
    /// Cabin-only piece limit (owner decision 2026-11-18: enforced; 12 is a representative value, changeable in SSM
    /// api/Packing and worker/Packing without a deploy). Every packed piece counts once — shoes and bags included.
    /// 0 = not enforced.
    /// </summary>
    public int CabinMaxItems { get; set; } = 12;
    public int MaxTripDays { get; set; } = 21;
}

/// <summary>Palette compatibility rule settings (owner decision 2026-11-18). SSM api/Palette.</summary>
public sealed class PaletteOptions
{
    public const string Section = "Palette";
    /// <summary>
    /// "Gardırobunun %N'i paletinle uyumlu": true (approved) = neutral pieces count as compatible, so the percentage
    /// and the "incompatible pieces" list add up to the whole wardrobe. false = only flattering tones count.
    /// </summary>
    public bool NeutralsCountAsCompatible { get; set; } = true;
    /// <summary>
    /// Colour ids (ColorCatalog) that are neutral whatever the season — unless the season lists them as flattering or
    /// to avoid. Empty (default) = every colour outside the season's two lists is neutral. When the list is set, a
    /// colour outside all three lists is "unmatched": it counts in the total but is neither compatible nor listed
    /// as incompatible.
    /// </summary>
    public List<string> NeutralColorIds { get; set; } = [];
}
