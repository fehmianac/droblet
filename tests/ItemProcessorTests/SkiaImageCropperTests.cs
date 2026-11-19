using Domain.Services;
using Domain.Services.Ai;
using ItemProcessor.Services;
using SkiaSharp;

namespace ItemProcessorTests;

/// <summary>The real crop (SkiaSharp native code) on a real JPEG: what the Lambda runs.</summary>
public class SkiaImageCropperTests
{
    /// <summary>800 × 600 white photo with a red square at (600, 100)–(640, 140): a "ring".</summary>
    private static ImageInput Photo()
    {
        using var bitmap = new SKBitmap(800, 600);
        using (var canvas = new SKCanvas(bitmap))
        {
            canvas.Clear(SKColors.White);
            using var paint = new SKPaint { Color = SKColors.Red };
            canvas.DrawRect(SKRect.Create(600, 100, 40, 40), paint);
        }
        using var image = SKImage.FromBitmap(bitmap);
        using var data = image.Encode(SKEncodedImageFormat.Jpeg, 95);
        return new ImageInput(data.ToArray(), "image/jpeg");
    }

    [Fact]
    public void Measure_ReadsThePixelSize_AndRejectsNonImages()
    {
        var cropper = new SkiaImageCropper();

        Assert.Equal(new PixelSize(800, 600), cropper.Measure(Photo()));
        Assert.Null(cropper.Measure(new ImageInput([1, 2, 3, 4], "image/jpeg")));
    }

    [Fact]
    public void Crop_CutsThePaddedBox_AndUpscalesASmallPiece()
    {
        var cropper = new SkiaImageCropper();
        var photo = Photo();
        var box = new BoundingBox(600 / 800.0, 100 / 600.0, 40 / 800.0, 40 / 600.0);
        var plan = CropMath.Plan(box, new PixelSize(800, 600), small: true);

        var crop = cropper.Crop(photo, plan);

        Assert.NotNull(crop);
        Assert.Equal("image/jpeg", crop.ContentType);
        using var decoded = SKBitmap.Decode(crop.Data);
        Assert.Equal((plan.OutputWidth, plan.OutputHeight), (decoded.Width, decoded.Height));
        Assert.True(decoded.Width > plan.Width);                       // upscaled
        var centre = decoded.GetPixel(decoded.Width / 2, decoded.Height / 2);
        Assert.True(centre.Red > 200 && centre.Green < 80, $"centre {centre}"); // the ring sits in the middle of its crop
        var corner = decoded.GetPixel(2, 2);
        Assert.True(corner.Green > 200, $"corner {corner}");             // with the padding around it
    }

    [Fact]
    public void Crop_OfABrokenImage_IsNull() =>
        Assert.Null(new SkiaImageCropper().Crop(new ImageInput([1, 2, 3], "image/jpeg"), new CropPlan(0, 0, 10, 10, 10, 10)));
}
