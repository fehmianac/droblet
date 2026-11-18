using Domain.Entity;
using Domain.Enum;
using Domain.Options;
using Domain.Services;

namespace DomainTests.Services;

public class ConsentRulesTests
{
    [Fact]
    public void Valid_OnlyWhenGranted_OnTheCurrentVersion()
    {
        var granted = new ConsentEntity { Type = ConsentType.Weight, Granted = true, Version = "2026-11-19" };

        Assert.True(ConsentRules.IsValid(granted, "2026-11-19"));
        Assert.False(ConsentRules.IsValid(granted, "2027-01-01"));                       // a new text re-prompts
        Assert.False(ConsentRules.IsValid(new ConsentEntity { Granted = false, Version = "2026-11-19" }, "2026-11-19"));
        Assert.False(ConsentRules.IsValid(null, "2026-11-19"));
    }

    [Fact]
    public void Photos_NeedTheirOwnConsent_PlusTheTransferAbroad()
    {
        Assert.Equal([ConsentType.BodyPhotoAi, ConsentType.CrossBorderTransfer], ConsentRules.ForPhoto(PhotoKind.Body));
        Assert.Equal([ConsentType.FacePhotoPalette, ConsentType.CrossBorderTransfer], ConsentRules.ForPhoto(PhotoKind.Face));
        Assert.Equal([ConsentType.MarketingNotifications], ConsentRules.Marketing);
    }

    [Fact]
    public void Versions_ComeFromConfig_ByCamelCaseName_WithADefault()
    {
        var options = new ConsentOptions { Versions = new(StringComparer.OrdinalIgnoreCase) { ["bodyPhotoAi"] = "2027-02-01", ["weight"] = " " } };

        Assert.Equal("2027-02-01", options.CurrentVersion(ConsentType.BodyPhotoAi));
        Assert.Equal(ConsentOptions.DefaultVersion, options.CurrentVersion(ConsentType.Weight));
        Assert.Equal(ConsentOptions.DefaultVersion, options.CurrentVersion(ConsentType.Contacts));
        Assert.Equal("marketingNotifications", ConsentOptions.Name(ConsentType.MarketingNotifications));
    }
}

public class ImageDimensionsTests
{
    private static byte[] Jpeg(int width, int height, bool withApp1 = true)
    {
        var bytes = new List<byte> { 0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x04, 0x4A, 0x46 };
        if (withApp1)
            bytes.AddRange([0xFF, 0xE1, 0x00, 0x06, 0x45, 0x78, 0x69, 0x66]);
        bytes.AddRange([0xFF, 0xC2, 0x00, 0x0B, 0x08, (byte)(height >> 8), (byte)height, (byte)(width >> 8), (byte)width, 0x01, 0x01, 0x11, 0x00]);
        bytes.AddRange([0xFF, 0xD9]);
        return bytes.ToArray();
    }

    [Fact]
    public void Jpeg_ReadsTheFrameHeader_AlsoProgressive_AfterOtherSegments()
    {
        Assert.True(ImageDimensions.TryRead(Jpeg(512, 384), out var w, out var h));
        Assert.Equal((512, 384), (w, h));
        Assert.True(ImageDimensions.TryRead(Jpeg(4032, 3024, withApp1: false), out w, out h));
        Assert.Equal((4032, 3024), (w, h));
    }

    [Fact]
    public void Png_ReadsIhdr()
    {
        var png = new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, (byte)'I', (byte)'H', (byte)'D', (byte)'R', 0, 0, 2, 0, 0, 0, 1, 0x90, 8, 6, 0, 0, 0 };

        Assert.True(ImageDimensions.TryRead(png, out var w, out var h));
        Assert.Equal((512, 400), (w, h));
    }

    [Fact]
    public void Garbage_Truncated_OrNoFrame_IsRejected()
    {
        Assert.False(ImageDimensions.TryRead("hello world"u8, out _, out _));
        Assert.False(ImageDimensions.TryRead(Jpeg(512, 512)[..12], out _, out _));
        Assert.False(ImageDimensions.TryRead(new byte[] { 0xFF, 0xD8, 0xFF, 0xDA, 0x00, 0x02, 0xFF, 0xD9 }, out _, out _));
    }
}
