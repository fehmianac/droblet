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
    Task<ImageInput> RenderAsync(ImageInput bodyPhoto, IReadOnlyList<ImageInput> garments, CancellationToken ct);
}

/// <param name="Language">Language of every generated text (tr | en …) — always passed explicitly, never guessed by the model.</param>
public sealed record StylistPrompt(JobKind Kind, string InputJson, string Language = "tr");

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

/// <summary>"Kombin fotoğrafından parçaları ayır": detect the pieces worn in one outfit photo, then cut each one out.</summary>
public interface IOutfitSplitter
{
    Task<IReadOnlyList<GarmentSuggestion>> DetectPiecesAsync(ImageInput outfitPhoto, string language, CancellationToken ct);
    Task<ImageInput> ExtractPieceAsync(ImageInput outfitPhoto, GarmentSuggestion piece, CancellationToken ct);
}
