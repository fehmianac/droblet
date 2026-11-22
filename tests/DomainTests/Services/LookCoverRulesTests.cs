using Domain.Entity;
using Domain.Enum;
using Domain.Options;
using Domain.Services;

namespace DomainTests.Services;

/// <summary>AI flat-lay look cover (canvas 21c, owner decision 2026-11-22): when a cover is requested, shown or pending.</summary>
public class LookCoverRulesTests
{
    private static readonly DateTime Now = new(2026, 11, 22, 10, 0, 0, DateTimeKind.Utc);

    private static LookSlotValue Item(OutfitSlot slot, string id) => new() { Slot = slot, ItemId = id };

    private static LookEntity Look(params LookSlotValue[] slots) => new() { Id = "l1", TenantId = "t1", Slots = [.. slots], Source = LookSource.User };

    [Fact]
    public void SlotsHash_IgnoresOrder_ChangesWithAnyPiece()
    {
        var a = LookCoverRules.SlotsHash([Item(OutfitSlot.Top, "i1"), Item(OutfitSlot.Bottom, "i2")]);

        Assert.Equal(a, LookCoverRules.SlotsHash([Item(OutfitSlot.Bottom, "i2"), Item(OutfitSlot.Top, "i1")]));
        Assert.Matches("^[0-9a-f]{16}$", a);
        Assert.NotEqual(a, LookCoverRules.SlotsHash([Item(OutfitSlot.Top, "i1"), Item(OutfitSlot.Bottom, "i3")]));
        Assert.NotEqual(a, LookCoverRules.SlotsHash([Item(OutfitSlot.Top, "i1"), Item(OutfitSlot.Shoes, "i2")]));
        Assert.NotEqual(a, LookCoverRules.SlotsHash([Item(OutfitSlot.Top, "i1"), new LookSlotValue { Slot = OutfitSlot.Bottom, ProductId = "i2" }]));
        Assert.NotEqual(a, LookCoverRules.SlotsHash([Item(OutfitSlot.Top, "i1"), Item(OutfitSlot.Bottom, "i2"), Item(OutfitSlot.Shoes, "i4")]));
    }

    [Fact]
    public void SlotsHash_IgnoresNameOccasionAndFavourite()
    {
        var look = Look(Item(OutfitSlot.Top, "i1"), Item(OutfitSlot.Bottom, "i2"));
        var before = LookCoverRules.SlotsHash(look.Slots);
        look.Name = "Yeni";
        look.Occasion = Occasion.Dinner;
        look.Favorite = true;
        Assert.Equal(before, LookCoverRules.SlotsHash(look.Slots));
    }

    [Fact]
    public void ImportedLooks_AreNeverEligible()
    {
        Assert.True(LookCoverRules.IsEligible(Look(Item(OutfitSlot.Top, "i1"))));
        var imported = Look(Item(OutfitSlot.Top, "i1"));
        imported.Source = LookSource.Import;
        Assert.False(LookCoverRules.IsEligible(imported));
        var withPhoto = Look(Item(OutfitSlot.Top, "i1"));
        withPhoto.CoverImageKey = "tenant/t1/import/s/0.jpg";
        Assert.False(LookCoverRules.IsEligible(withPhoto));
    }

    [Theory]
    [InlineData(LookCoverStatus.Pending)]
    [InlineData(LookCoverStatus.Ready)]
    public void NeedsRequest_NeverAgainForPendingOrReadyPieces(LookCoverStatus status)
    {
        var cover = new LookCoverEntity { SlotsHash = "aaaa", Status = status, Attempts = 1 };
        Assert.True(LookCoverRules.NeedsRequest(null, "aaaa"));
        Assert.False(LookCoverRules.NeedsRequest(cover, "aaaa"));
        Assert.True(LookCoverRules.NeedsRequest(cover, "bbbb"));
    }

    [Theory]
    [InlineData(0, true)]    // a row written before attempts were counted = its first request
    [InlineData(1, true)]    // the first request failed: one more
    [InlineData(2, false)]   // the retry failed too: not again for these pieces
    public void NeedsRequest_AFailedCoverIsTriedOnceMore(int attempts, bool expected)
    {
        var cover = new LookCoverEntity { SlotsHash = "aaaa", Status = LookCoverStatus.Failed, Attempts = attempts };
        Assert.Equal(expected, LookCoverRules.NeedsRequest(cover, "aaaa"));
        Assert.True(LookCoverRules.NeedsRequest(cover, "bbbb"));
    }

    [Fact]
    public void ReadyImage_OnlyForTheSamePieces_PendingTimesOut()
    {
        var cover = new LookCoverEntity { SlotsHash = "bbbb", Status = LookCoverStatus.Pending, RequestedAt = Now, ImageKey = "tenant/t1/look-cover/l1-aaaa.webp", ImageHash = "aaaa" };

        Assert.Null(LookCoverRules.ReadyImageKey(cover, "bbbb"));   // the old pieces' image is never shown for new pieces
        Assert.Equal(cover.ImageKey, LookCoverRules.ReadyImageKey(cover, "aaaa"));
        Assert.True(LookCoverRules.IsPending(cover, "bbbb", Now.AddMinutes(1)));
        Assert.False(LookCoverRules.IsPending(cover, "cccc", Now.AddMinutes(1)));
        Assert.False(LookCoverRules.IsPending(cover, "bbbb", Now + LookCoverRules.PendingTimeout));
        cover.Status = LookCoverStatus.Failed;
        Assert.False(LookCoverRules.IsPending(cover, "bbbb", Now));
    }

    [Fact]
    public void StorageKey_QueueAndImageSettings()
    {
        Assert.Equal("tenant/t1/look-cover/l1-0123456789abcdef.webp", StorageKeys.LookCover("t1", "l1", "0123456789abcdef"));
        Assert.True(StorageKeys.BelongsToTenant(StorageKeys.LookCover("t1", "l1", "h"), "t1"));
        Assert.Throws<ArgumentException>(() => StorageKeys.LookCover("t1", "../x", "h"));
        Assert.Equal("tryon", new QueueOptions { TryOnRequest = "tryon", StylistRequest = "stylist" }.UrlFor(JobKind.LookCover));

        var options = new AiOptions();
        Assert.True(options.LookCover.Enabled);
        Assert.Equal(("1024x1536", "low"), options.ImageFor(ImageUse.LookCover));
        options.Image.LookCoverQuality = null;
        options.Image.Quality = "medium";
        Assert.Equal(("1024x1536", "medium"), options.ImageFor(ImageUse.LookCover));
    }
}
