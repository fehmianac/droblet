using Domain.Services;
using SkiaSharp;

namespace Ops.Commands;

/// <summary>The reference colour of a clean piece picture (<see cref="DominantColor"/>), decoded with Skia. No AI call.</summary>
internal static class PieceColorReader
{
    /// <summary>The picture is read at this size: plenty for a colour vote, and a 768 px piece costs nothing.</summary>
    private const int Side = 96;

    /// <summary>Null when the bytes are not a picture.</summary>
    public static string? Read(byte[] image)
    {
        if (image.Length == 0)
            return null;
        using var data = SKData.CreateCopy(image);
        using var codec = SKCodec.Create(data);
        if (codec is null)
            return null;
        using var source = SKBitmap.Decode(codec);
        if (source is null || source.Width <= 0 || source.Height <= 0)
            return null;
        var scale = Math.Min(1d, (double)Side / Math.Max(source.Width, source.Height));
        var info = new SKImageInfo(Math.Max(1, (int)Math.Round(source.Width * scale)), Math.Max(1, (int)Math.Round(source.Height * scale)), SKColorType.Rgba8888, SKAlphaType.Unpremul);
        using var small = source.Resize(info, new SKSamplingOptions(SKFilterMode.Linear, SKMipmapMode.Linear));
        return small is null ? null : DominantColor.Of(small.GetPixelSpan(), small.Width, small.Height);
    }
}
