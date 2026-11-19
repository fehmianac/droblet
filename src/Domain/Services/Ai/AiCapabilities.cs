using System.Text.Json.Serialization;
using Domain.Enum;

namespace Domain.Services.Ai;

/// <summary>
/// One provider behind per-task capability interfaces (BACKEND_ENGINEER.md). Owner decision 2026-11-18:
/// OpenAI — text model and image model ids live in SSM (Ai:TextModel, Ai:ImageModel), never in code.
/// </summary>
public interface IAiProvider
{
    string Name { get; }
    bool IsConfigured { get; }
}

public sealed class AiProviderException(string message, Exception? inner = null) : Exception(message, inner);

public sealed record ImageInput(byte[] Data, string ContentType);

/// <summary>Text-to-image request for operator tooling (library images, synthetic fixtures). Size e.g. "1024x1024"; format png | jpeg | webp.</summary>
public sealed record ImageGenerationRequest(string Prompt, string Size = "1024x1024", string OutputFormat = "webp", int? OutputCompression = null, string? Quality = null);

public sealed record GarmentSuggestion(ItemCategoryHint? Category, IReadOnlyList<string> ColorIds, string? Fabric, IReadOnlyList<Season> Seasons, IReadOnlyDictionary<string, double> Confidence, string? Name = null, bool IsGarment = true, int GarmentCount = 1);

public enum ItemCategoryHint { Top, Bottom, Dress, Outerwear, Shoes, Bag, Accessory, Beachwear, Skiwear }

public enum Season { Spring, Summer, Autumn, Winter }

public interface IImageCleanup
{
    Task<ImageInput> CleanupAsync(ImageInput garmentPhoto, CancellationToken ct);
}

public interface IGarmentVision
{
    Task<GarmentSuggestion> DescribeAsync(ImageInput garmentImage, string language, CancellationToken ct);
}

public interface ITryOnRenderer
{
    /// <param name="quality">Image quality for this render (the try-on preview); null = the configured try-on quality.</param>
    Task<ImageInput> RenderAsync(ImageInput bodyPhoto, IReadOnlyList<ImageInput> garments, CancellationToken ct, string? quality = null);

    /// <summary>
    /// Face path (no body photo): the same adult person, identity unchanged, as a full-body figure of the given body type,
    /// height and size, fully clothed in the garments.
    /// </summary>
    Task<ImageInput> RenderFromFaceAsync(ImageInput facePhoto, IReadOnlyList<ImageInput> garments, TryOnFigure figure, CancellationToken ct, string? quality = null);
}

/// <summary>Server-side check of a body / face photo before its first try-on (people, framing, light, sharpness). No identification.</summary>
public interface IPhotoInspector
{
    /// <summary>False when the provider is off or incomplete: the check is skipped (rendering then fails the same way).</summary>
    bool IsConfigured { get; }

    Task<PhotoInspection> InspectAsync(ImageInput photo, PhotoKind kind, CancellationToken ct);
}

/// <param name="Language">Language of every generated text (tr | en …) — always passed explicitly, never guessed by the model.</param>
/// <param name="CompactCandidates">The candidates are descriptor strings with short aliases (CandidateAliases, Ai:CompactStylistPrompt).</param>
public sealed record StylistPrompt(JobKind Kind, string InputJson, string Language = "tr", bool CompactCandidates = false);

public interface IStylistModel
{
    /// <summary>Returns schema-conforming JSON; the caller always runs it through the matching guard.</summary>
    Task<string> GenerateAsync(StylistPrompt prompt, CancellationToken ct);
}

public sealed record PaletteAnalysis(string SeasonTypeId, IReadOnlyList<string> FlatteringColorIds, IReadOnlyList<string> AvoidColorIds, int FacesDetected, double Confidence = 1, string? Refusal = null);

public interface IPaletteAnalyzer
{
    Task<PaletteAnalysis> AnalyzeAsync(ImageInput facePhoto, CancellationToken ct);
}

/// <summary>Normalised (0..1) box of one piece in a photo: X / Y = top-left corner, Width / Height = size.</summary>
public sealed record BoundingBox(
    [property: JsonPropertyName("x")] double X,
    [property: JsonPropertyName("y")] double Y,
    [property: JsonPropertyName("width")] double Width,
    [property: JsonPropertyName("height")] double Height)
{
    [JsonIgnore] public double Area => Width * Height;
    [JsonIgnore] public double Right => X + Width;
    [JsonIgnore] public double Bottom => Y + Height;
}

/// <summary>
/// One wearable piece the vision model found in a photo. Subcategory = a SubcategoryCatalog id (null = none fits);
/// Confidence = the model's overall certainty that this box is one real, separate piece; IsWearable = false for anything that is
/// not clothing, shoes, a bag, an accessory or jewellery (a person, a body part, furniture …) — the guard drops those.
/// </summary>
public sealed record DetectedItem(GarmentSuggestion Garment, BoundingBox Box, string? Subcategory, double Confidence, bool IsWearable = true);

/// <summary>Multi-item detection: ALL distinct wearable pieces in one photo, each with its box (one vision call per photo).</summary>
public interface IItemDetector
{
    Task<IReadOnlyList<DetectedItem>> DetectItemsAsync(ImageInput photo, string language, CancellationToken ct);
}

/// <param name="Index">0-based index of the candidate that is the very same physical piece; null = none of them.</param>
public sealed record ItemMatchResult(int? Index, double Confidence);

/// <summary>
/// Outfit import (stage B / C): one vision call that compares a piece cropped from an outfit photo with up to K candidate
/// pieces (wardrobe thumbnails, new pieces found earlier in the session) and says which one — if any — is the same piece.
/// </summary>
public interface IItemMatcher
{
    /// <param name="fast">Use Ai:FastTextModel when it is configured.</param>
    Task<ItemMatchResult> MatchAsync(ImageInput crop, IReadOnlyList<ImageInput> candidates, string? pieceHint, bool fast, CancellationToken ct);
}

/// <summary>Multi-item detection with an explicit model choice (outfit import uses the fast text model when configured).</summary>
public interface IFastItemDetector
{
    Task<IReadOnlyList<DetectedItem>> DetectItemsAsync(ImageInput photo, string language, bool fast, CancellationToken ct);
}

/// <summary>Background removal of one piece (already cropped to its box), as a product photo on the house background.</summary>
public interface IItemImageCleanup
{
    Task<ImageInput> CleanupItemAsync(ImageInput crop, ItemCategoryHint? category, string? subcategory, CancellationToken ct);
}

public readonly record struct PixelSize(int Width, int Height);

/// <summary>Decoding / cropping of an (EXIF-stripped) photo. Pure pixel work, no AI. Null = the bytes are not a decodable image.</summary>
public interface IImageCropper
{
    PixelSize? Measure(ImageInput photo);
    ImageInput? Crop(ImageInput photo, CropPlan plan);
}

/// <summary>Pixel rectangle to cut out of the photo, then scaled so the result is OutputWidth × OutputHeight.</summary>
public readonly record struct CropPlan(int X, int Y, int Width, int Height, int OutputWidth, int OutputHeight);
