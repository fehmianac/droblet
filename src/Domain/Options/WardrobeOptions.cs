namespace Domain.Options;

// E2–E7 options. Numbers live in config/SSM so they change without a deploy; rules stay in code.

public sealed class WardrobeOptions
{
    public const string Section = "Wardrobe";
    /// <summary>Screen 13: at most 30 photos per bulk add.</summary>
    public int MaxBatchUpload { get; set; } = 30;
    /// <summary>"Kombin fotoğrafından parçaları ayır": at most this many pieces are cut out of one outfit photo.</summary>
    public int MaxSplitPieces { get; set; } = 6;
    /// <summary>Public base URL of the global asset bucket/CDN (library and catalog images). Empty = imageUrl is null for those pieces.</summary>
    public string? PublicAssetBaseUrl { get; set; }
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
}

public sealed class PackingOptions
{
    public const string Section = "Packing";
    /// <summary>Cabin-only piece limit. Owner decision — 0 means "not decided": the limit is not enforced.</summary>
    public int CabinMaxItems { get; set; }
    public int MaxTripDays { get; set; } = 21;
}
