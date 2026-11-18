using Domain.Options;
using Domain.Services.Ai;
using Microsoft.Extensions.Options;

namespace Infrastructure.Ai;

/// <summary>
/// Registered until the OpenAI-backed provider lands (models from SSM Ai:TextModel / Ai:ImageModel).
/// Every capability fails with AiProviderException, which workers turn into Failed(ProviderError) + credit refund.
/// </summary>
public sealed class NotConfiguredAiProvider(IOptionsMonitor<AiOptions> options)
    : IAiProvider, IImageCleanup, IGarmentVision, ITryOnRenderer, IStylistModel, IPaletteAnalyzer
{
    public string Name => options.CurrentValue.Provider ?? "none";
    public bool IsConfigured => false;

    public Task<ImageInput> CleanupAsync(ImageInput garmentPhoto, CancellationToken ct) => Fail<ImageInput>();
    public Task<GarmentSuggestion> DescribeAsync(ImageInput garmentImage, CancellationToken ct) => Fail<GarmentSuggestion>();
    public Task<ImageInput> RenderAsync(ImageInput bodyPhoto, IReadOnlyList<ImageInput> garments, CancellationToken ct) => Fail<ImageInput>();
    public Task<string> GenerateAsync(StylistPrompt prompt, CancellationToken ct) => Fail<string>();
    public Task<PaletteAnalysis> AnalyzeAsync(ImageInput facePhoto, CancellationToken ct) => Fail<PaletteAnalysis>();

    private Task<T> Fail<T>() =>
        Task.FromException<T>(new AiProviderException(
            $"AI provider '{Name}' is not configured (Ai.Enabled={options.CurrentValue.Enabled})."));
}
