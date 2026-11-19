using Domain.Options;

namespace Domain.Services;

/// <summary>Token usage of one provider call as the API reports it (all nullable: an error or an old log line has none).</summary>
/// <param name="Input">All input tokens (chat: prompt_tokens incl. image tokens; images: input_tokens = text + image).</param>
/// <param name="Cached">Cached input tokens (part of <paramref name="Input"/>).</param>
/// <param name="Output">Output tokens (chat: incl. reasoning; images: the generated image).</param>
/// <param name="InputImage">Image models only: the image part of <paramref name="Input"/> (input_tokens_details.image_tokens).</param>
public readonly record struct AiUsage(long? Input, long? Cached, long? Output, long? InputImage = null);

/// <summary>
/// Estimated cost of one provider call from Ai:Pricing (pure). Text: uncached input × Input + cached × CachedInput +
/// output × Output. Image models: text input × Input + image input × ImageInput + output × ImageOutput (OpenAI bills
/// the image tokens of an edit separately). Times the service tier's multiplier (flex / batch 0.5). null = no price.
/// </summary>
public static class AiCost
{
    public const decimal PerMillion = 1_000_000m;

    public static bool IsImageOperation(string operation) => operation.StartsWith("image_", StringComparison.Ordinal);

    public static decimal? Estimate(AiPricingOptions pricing, string operation, string? model, string? tier, AiUsage usage,
        string? imageSize = null, string? imageQuality = null)
    {
        var price = pricing.For(model);
        var multiplier = pricing.MultiplierFor(tier);
        if (IsImageOperation(operation))
        {
            if (price is not null && usage.Output is { } imageOut)
            {
                var imageIn = Math.Max(0, usage.InputImage ?? 0);
                var textIn = Math.Max(0, (usage.Input ?? 0) - imageIn);
                var imageInputRate = price.ImageInput > 0 ? price.ImageInput : price.Input;
                var imageOutputRate = price.ImageOutput > 0 ? price.ImageOutput : price.Output;
                return (textIn * price.Input + imageIn * imageInputRate + imageOut * imageOutputRate) / PerMillion * multiplier;
            }
            // No usage in the response: the per-image fallback, if the price list has one for this quality and size.
            var key = $"{(string.IsNullOrWhiteSpace(imageQuality) ? "default" : imageQuality)}/{imageSize}";
            return pricing.ImageFallback.TryGetValue(key, out var perImage) ? perImage * multiplier : null;
        }

        if (price is null || usage.Input is null && usage.Output is null)
            return null;
        var cached = Math.Clamp(usage.Cached ?? 0, 0, usage.Input ?? 0);
        var uncached = Math.Max(0, (usage.Input ?? 0) - cached);
        var cachedRate = price.CachedInput > 0 ? price.CachedInput : price.Input;
        return (uncached * price.Input + cached * cachedRate + (usage.Output ?? 0) * price.Output) / PerMillion * multiplier;
    }

    /// <summary>USD → micro-USD, the integer unit of job aiCost and the EMF metric.</summary>
    public static long Micro(decimal usd) => (long)Math.Round(usd * PerMillion, MidpointRounding.AwayFromZero);
}
