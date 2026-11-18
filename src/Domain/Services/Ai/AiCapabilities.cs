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

public sealed record GarmentSuggestion(ItemCategoryHint? Category, IReadOnlyList<string> ColorIds, string? Fabric, IReadOnlyList<Season> Seasons, IReadOnlyDictionary<string, double> Confidence);

public enum ItemCategoryHint { Top, Bottom, Dress, Outerwear, Shoes, Bag, Accessory }

public enum Season { Spring, Summer, Autumn, Winter }

public interface IImageCleanup
{
    Task<ImageInput> CleanupAsync(ImageInput garmentPhoto, CancellationToken ct);
}

public interface IGarmentVision
{
    Task<GarmentSuggestion> DescribeAsync(ImageInput garmentImage, CancellationToken ct);
}

public interface ITryOnRenderer
{
    Task<ImageInput> RenderAsync(ImageInput bodyPhoto, IReadOnlyList<ImageInput> garments, CancellationToken ct);
}

public sealed record StylistPrompt(JobKind Kind, string InputJson);

public interface IStylistModel
{
    /// <summary>Returns schema-conforming JSON; the caller always runs it through the matching guard.</summary>
    Task<string> GenerateAsync(StylistPrompt prompt, CancellationToken ct);
}

public sealed record PaletteAnalysis(string SeasonTypeId, IReadOnlyList<string> FlatteringColorIds, IReadOnlyList<string> AvoidColorIds, int FacesDetected);

public interface IPaletteAnalyzer
{
    Task<PaletteAnalysis> AnalyzeAsync(ImageInput facePhoto, CancellationToken ct);
}
