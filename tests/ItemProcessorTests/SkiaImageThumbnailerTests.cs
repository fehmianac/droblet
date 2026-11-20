using ItemProcessor.Services;
using SkiaSharp;

namespace ItemProcessorTests;

/// <summary>The real thumbnail resample (SkiaSharp native code) on a real WebP with transparency: what the worker and Ops run.</summary>
public class SkiaImageThumbnailerTests
{
    /// <summary>1200 × 600 transparent image with an opaque red rectangle in the middle (a cleaned piece).</summary>
    private static byte[] Cleaned(int width = 1200, int height = 600)
    {
        using var bitmap = new SKBitmap(new SKImageInfo(width, height, SKColorType.Rgba8888, SKAlphaType.Premul));
        using (var canvas = new SKCanvas(bitmap))
        {
            canvas.Clear(SKColors.Transparent);
            using var paint = new SKPaint { Color = SKColors.Red };
            canvas.DrawRect(SKRect.Create(width / 4f, height / 4f, width / 2f, height / 2f), paint);
        }
        using var image = SKImage.FromBitmap(bitmap);
        using var data = image.Encode(SKEncodedImageFormat.Webp, 90);
        return data.ToArray();
    }

    private static SKBitmap Decode(byte[] webp, out SKEncodedImageFormat format)
    {
        using var codec = SKCodec.Create(SKData.CreateCopy(webp));
        format = codec.EncodedFormat;
        return SKBitmap.Decode(webp);
    }

    [Theory]
    [InlineData(256, 256, 128)]
    [InlineData(768, 768, 384)]
    public void ToWebp_ScalesTheLongestSide_KeepsAspectAndTransparency(int maxSide, int width, int height)
    {
        var thumb = new SkiaImageThumbnailer().ToWebp(Cleaned(), maxSide)!;

        using var bitmap = Decode(thumb, out var format);
        Assert.Equal(SKEncodedImageFormat.Webp, format);
        Assert.Equal((width, height), (bitmap.Width, bitmap.Height));
        Assert.Equal(0, bitmap.GetPixel(2, 2).Alpha);                    // background stays transparent
        Assert.True(bitmap.GetPixel(width / 2, height / 2).Red > 200);   // the piece survives
    }

    [Fact]
    public void ToWebp_NeverUpscales_AndRejectsNonImages()
    {
        var thumbnailer = new SkiaImageThumbnailer();
        var small = thumbnailer.ToWebp(Cleaned(200, 100), 768)!;

        using var bitmap = Decode(small, out _);
        Assert.Equal((200, 100), (bitmap.Width, bitmap.Height));
        Assert.Null(thumbnailer.ToWebp([1, 2, 3, 4], 256));
        Assert.Null(thumbnailer.ToWebp([], 256));
    }
}
