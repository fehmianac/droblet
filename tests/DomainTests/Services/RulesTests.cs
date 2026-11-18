using Domain.Entity;
using Domain.Enum;
using Domain.Extensions;
using Domain.Options;
using Domain.Services;
using Tests.Shared;

namespace DomainTests.Services;

public class HandleRulesTests
{
    [Theory]
    [InlineData("@Ayse.Style", "ayse.style")]
    [InlineData("  zeynep_01 ", "zeynep_01")]
    public void Normalize_StripsAtTrimsLowercases(string input, string expected) =>
        Assert.Equal(expected, HandleRules.Normalize(input));

    [Theory]
    [InlineData("ayse", true)]
    [InlineData("a.b_c9", true)]
    [InlineData("ab", false)]
    [InlineData(".ayse", false)]
    [InlineData("ayse.", false)]
    [InlineData("ay..se", false)]
    [InlineData("ayşe", false)]
    [InlineData("ay se", false)]
    [InlineData("abcdefghijabcdefghijabcdefghij1", false)]
    public void IsValidFormat(string handle, bool expected) => Assert.Equal(expected, HandleRules.IsValidFormat(handle));

    [Fact]
    public void IsReserved_BlocksBrandAndStaffNames()
    {
        Assert.True(HandleRules.IsReserved("droblet"));
        Assert.True(HandleRules.IsReserved("admin"));
        Assert.False(HandleRules.IsReserved("ayse"));
    }
}

public class SegmentPolicyTests
{
    [Theory]
    [InlineData(Segment.Women, true)]
    [InlineData(Segment.Men, false)]
    [InlineData(Segment.Teen, false)]
    public void Phase1_WomenOnly(Segment segment, bool expected) => Assert.Equal(expected, SegmentPolicy.IsAvailable(segment));
}

public class StorageKeysTests
{
    [Fact]
    public void Keys_AreTenantPrefixed()
    {
        Assert.Equal("uploads/tmp/t1/u1", StorageKeys.Upload("t1", "u1"));
        Assert.Equal("tenant/t1/body/p1.jpg", StorageKeys.Photo("t1", PhotoKind.Body, "p1", "jpg"));
        Assert.Equal("tenant/t1/face/p1.png", StorageKeys.Photo("t1", PhotoKind.Face, "p1", "png"));
        Assert.Equal("tenant/t1/tryon/", StorageKeys.TryOnPrefix("t1"));
    }

    [Theory]
    [InlineData("../t2")]
    [InlineData("t1/../t2")]
    [InlineData("")]
    public void Keys_RejectPathTraversal(string segment) =>
        Assert.Throws<ArgumentException>(() => StorageKeys.Upload("t1", segment));

    [Fact]
    public void BelongsToTenant_RejectsOtherTenantsAndPrefixLookalikes()
    {
        Assert.True(StorageKeys.BelongsToTenant("tenant/t1/body/x.jpg", "t1"));
        Assert.False(StorageKeys.BelongsToTenant("tenant/t2/body/x.jpg", "t1"));
        Assert.False(StorageKeys.BelongsToTenant("tenant/t10/body/x.jpg", "t1"));
    }
}

public class DeletionPlanTests
{
    [Fact]
    public void DeletionPlan_CoversEveryTenantScopedEntity()
    {
        var tenantScoped = typeof(TenantEntity).Assembly.GetTypes()
            .Where(t => t is { IsClass: true, Namespace: "Domain.Entity" } && DeletionPlan.IsTenantScoped(t))
            .ToList();

        var missing = tenantScoped.Except(DeletionPlan.TenantScopedEntityTypes).Select(t => t.Name).ToList();

        Assert.NotEmpty(tenantScoped);
        Assert.True(missing.Count == 0, $"Add to DeletionPlan.TenantScopedEntityTypes: {string.Join(", ", missing)}");
    }

    [Fact]
    public void TenantPartitionKeys_AllContainTheTenant()
    {
        var keys = DeletionPlan.TenantPartitionKeys("T123");

        Assert.Equal(DeletionPlan.TenantScopedEntityTypes.Count, keys.Count);
        Assert.All(keys, k => Assert.StartsWith("tenant#T123#", k));
    }

    [Fact]
    public void PhotoDeletion_CoversBodyFaceTryOnAndPalette_NotItems()
    {
        var prefixes = DeletionPlan.PhotoS3Prefixes("t1");
        Assert.Contains("tenant/t1/body/", prefixes);
        Assert.Contains("tenant/t1/face/", prefixes);
        Assert.Contains("tenant/t1/tryon/", prefixes);
        Assert.DoesNotContain(StorageKeys.ItemsPrefix("t1"), prefixes);

        var pks = DeletionPlan.PhotoPartitionKeys("t1");
        Assert.Contains(TryOnImageEntity.GetPk("t1"), pks);
        Assert.Contains(PaletteResultEntity.GetPk("t1"), pks);
        Assert.Contains(PhotoEntity.GetPk("t1"), pks);
    }

    [Fact]
    public void AccountDeletion_CoversWholeTenantPrefixAndUploads()
    {
        Assert.Equal(["tenant/t1/", "uploads/tmp/t1/"], DeletionPlan.AccountS3Prefixes("t1"));
    }
}

public class ImageMetadataStripperTests
{
    [Fact]
    public void Strip_Jpeg_RemovesExifAndComment_KeepsImageData()
    {
        var original = TestImages.JpegWithExif();

        var result = ImageMetadataStripper.Strip(original);

        Assert.NotNull(result);
        Assert.Equal(ImageFormat.Jpeg, result.Format);
        Assert.Equal("image/jpeg", result.ContentType);
        Assert.False(TestImages.Contains(result.Data, TestImages.ExifGps));
        Assert.False(TestImages.Contains(result.Data, "secret comment"u8.ToArray()));
        Assert.True(TestImages.Contains(result.Data, "JFIF"u8.ToArray()));
        Assert.True(TestImages.Contains(result.Data, [0x12, 0x34, 0x56, 0x78, 0xFF, 0xD9]));
        Assert.True(result.Data.Length < original.Length);
    }

    [Fact]
    public void Strip_Png_RemovesTextAndExifChunks()
    {
        var result = ImageMetadataStripper.Strip(TestImages.Png(withText: true));

        Assert.NotNull(result);
        Assert.Equal(TestImages.Png(withText: false), result.Data);
    }

    [Theory]
    [InlineData(new byte[] { 0x47, 0x49, 0x46, 0x38, 0x39, 0x61 })] // GIF
    [InlineData(new byte[] { 0x25, 0x50, 0x44, 0x46 })]             // PDF
    [InlineData(new byte[] { 0xFF, 0xD8, 0xFF })]                   // truncated JPEG
    public void Strip_WhenNotSupportedOrBroken_ReturnsNull(byte[] data) => Assert.Null(ImageMetadataStripper.Strip(data));

    [Fact]
    public void Detect_RecognisesHeic_ButStripRejectsIt()
    {
        var heic = new byte[] { 0, 0, 0, 24, (byte)'f', (byte)'t', (byte)'y', (byte)'p', (byte)'h', (byte)'e', (byte)'i', (byte)'c' };

        Assert.Equal(ImageFormat.Heic, ImageMetadataStripper.Detect(heic));
        Assert.Null(ImageMetadataStripper.Strip(heic));
    }
}

public class AffiliateCommissionTests
{
    [Fact]
    public void Terms_UseBrandDealOrNetworkDefault()
    {
        var options = new AffiliateOptions
        {
            DefaultCommissionRateBps = 700,
            Brands = { ["brandA"] = new AffiliateOptions.BrandAffiliateOptions { Source = AffiliateSource.Direct, CommissionRateBps = 1200 } },
        };

        Assert.Equal((AffiliateSource.Direct, 1200), AffiliateCommission.TermsFor(options, "brandA"));
        Assert.Equal((AffiliateSource.Network, 700), AffiliateCommission.TermsFor(options, "other"));
    }

    [Theory]
    [InlineData(100_000, 700, 7_000)]
    [InlineData(99_999, 1200, 11_999)]
    [InlineData(0, 700, 0)]
    [InlineData(-5, 700, 0)]
    public void Calculate_IsFlooredMinorUnits(long amount, int bps, long expected) =>
        Assert.Equal(expected, AffiliateCommission.Calculate(amount, bps));
}

public class UlidTests
{
    [Fact]
    public void New_Is26CharsValidAndTimeSortable()
    {
        var earlier = Ulid.New(new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc));
        var later = Ulid.New(new DateTime(2026, 1, 1, 0, 0, 1, DateTimeKind.Utc));

        Assert.Equal(26, earlier.Length);
        Assert.True(Ulid.IsValid(earlier));
        Assert.True(string.CompareOrdinal(earlier, later) < 0);
        Assert.False(Ulid.IsValid("not-a-ulid"));
    }
}
