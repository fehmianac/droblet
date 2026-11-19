using Domain.Services.Ai;
using SkiaSharp;

namespace ItemProcessor.Services;

/// <summary>
/// IImageCropper over SkiaSharp (MIT; native Linux arm64/x64 assets without system dependencies, so it runs on the Lambda
/// runtime as is). Works on the EXIF-stripped original only; the result is a JPEG (the image model takes it as input, and the
/// selection list shows it as the plain crop). The crop math lives in CropMath (Domain) and is unit-tested there.
/// </summary>
public sealed class SkiaImageCropper : IImageCropper
{
    private const int JpegQuality = 92;

    public PixelSize? Measure(ImageInput photo)
    {
        using var data = SKData.CreateCopy(photo.Data);
        using var codec = SKCodec.Create(data);
        return codec is null || codec.Info.Width <= 0 || codec.Info.Height <= 0 ? null : new PixelSize(codec.Info.Width, codec.Info.Height);
    }

    public ImageInput? Crop(ImageInput photo, CropPlan plan)
    {
        using var data = SKData.CreateCopy(photo.Data);
        using var codec = SKCodec.Create(data);
        if (codec is null)
            return null;
        using var source = SKBitmap.Decode(codec);
        if (source is null || plan.Width <= 0 || plan.Height <= 0 || plan.OutputWidth <= 0 || plan.OutputHeight <= 0)
            return null;

        var sourceRect = SKRect.Create(plan.X, plan.Y, Math.Min(plan.Width, source.Width - plan.X), Math.Min(plan.Height, source.Height - plan.Y));
        if (sourceRect.Width <= 0 || sourceRect.Height <= 0)
            return null;

        using var target = new SKBitmap(new SKImageInfo(plan.OutputWidth, plan.OutputHeight, SKColorType.Rgba8888, SKAlphaType.Premul));
        using (var canvas = new SKCanvas(target))
        {
            canvas.Clear(SKColors.White);
            using var image = SKImage.FromBitmap(source);
            canvas.DrawImage(image, sourceRect, SKRect.Create(plan.OutputWidth, plan.OutputHeight), new SKSamplingOptions(SKCubicResampler.Mitchell));
        }

        using var snapshot = SKImage.FromBitmap(target);
        using var encoded = snapshot.Encode(SKEncodedImageFormat.Jpeg, JpegQuality);
        return encoded is null ? null : new ImageInput(encoded.ToArray(), "image/jpeg");
    }
}
