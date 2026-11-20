using Domain.Services;
using SkiaSharp;

namespace ItemProcessor.Services;

/// <summary>
/// <see cref="IImageThumbnailer"/> over SkiaSharp (same native assets as <see cref="SkiaImageCropper"/>): the cleaned piece
/// image (transparent or white background) is resampled to a WebP whose longest side is at most the given size. No AI.
/// </summary>
public sealed class SkiaImageThumbnailer : IImageThumbnailer
{
    private const int WebpQuality = 82;

    public byte[]? ToWebp(byte[] image, int maxSide)
    {
        if (maxSide <= 0 || image.Length == 0)
            return null;
        using var data = SKData.CreateCopy(image);
        using var codec = SKCodec.Create(data);
        if (codec is null)
            return null;
        using var source = SKBitmap.Decode(codec);
        if (source is null || source.Width <= 0 || source.Height <= 0)
            return null;

        var scale = Math.Min(1d, (double)maxSide / Math.Max(source.Width, source.Height));
        var width = Math.Max(1, (int)Math.Round(source.Width * scale));
        var height = Math.Max(1, (int)Math.Round(source.Height * scale));

        using var target = new SKBitmap(new SKImageInfo(width, height, SKColorType.Rgba8888, SKAlphaType.Premul));
        using (var canvas = new SKCanvas(target))
        {
            canvas.Clear(SKColors.Transparent);
            using var sourceImage = SKImage.FromBitmap(source);
            canvas.DrawImage(sourceImage, SKRect.Create(source.Width, source.Height), SKRect.Create(width, height), new SKSamplingOptions(SKCubicResampler.Mitchell));
        }

        using var snapshot = SKImage.FromBitmap(target);
        using var encoded = snapshot.Encode(SKEncodedImageFormat.Webp, WebpQuality);
        return encoded?.ToArray();
    }
}
