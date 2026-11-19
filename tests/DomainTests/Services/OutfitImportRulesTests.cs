using Domain.Entity;
using Domain.Enum;
using Domain.Options;
using Domain.Services;

namespace DomainTests.Services;

public class OutfitImportRulesTests
{
    private static readonly DateTime T0 = new(2026, 11, 19, 9, 0, 0, DateTimeKind.Utc);

    private static MatchCandidate Item(string id, ItemCategory category, string? subcategory, params string[] colors) =>
        new(id, false, category, subcategory, colors, $"tenant/t/items/{id}.webp", T0);

    [Fact]
    public void Shortlist_SameCategory_CompatibleSubType_SharedColour_BestFirst_CappedAtK()
    {
        MatchCandidate[] wardrobe =
        [
            Item("white-shirt", ItemCategory.Top, "shirt", "white"),
            Item("blue-white-shirt", ItemCategory.Top, "shirt", "blue", "white"),
            Item("black-shirt", ItemCategory.Top, "shirt", "black"),          // no colour in common
            Item("white-tee", ItemCategory.Top, "t-shirt", "white"),          // another sub-type
            Item("white-top", ItemCategory.Top, null, "white"),               // unknown sub-type: still a candidate
            Item("white-skirt", ItemCategory.Bottom, "skirt", "white"),       // another category
            Item("no-colour-shirt", ItemCategory.Top, "shirt"),               // unknown colour: a weak candidate
        ];

        var list = OutfitImportRules.Shortlist(ItemCategory.Top, "shirt", ["white"], wardrobe, 6);

        Assert.Equal(["white-shirt", "white-top", "blue-white-shirt", "no-colour-shirt"], list.Select(c => c.Id));
        Assert.Equal(["white-shirt", "white-top"], OutfitImportRules.Shortlist(ItemCategory.Top, "shirt", ["white"], wardrobe, 2).Select(c => c.Id));
        Assert.Empty(OutfitImportRules.Shortlist(ItemCategory.Shoes, null, ["white"], wardrobe, 6));   // nothing similar: no model call
    }

    [Fact]
    public void Shortlist_PrefersTheSessionsOwnNewPieces_OnATie()
    {
        var session = new MatchCandidate("p1", true, ItemCategory.Top, "shirt", ["white"], "tenant/t/import/s/1-1.jpg", T0.AddDays(-1));
        var list = OutfitImportRules.Shortlist(ItemCategory.Top, "shirt", ["white"], [Item("i1", ItemCategory.Top, "shirt", "white"), session], 6);
        Assert.Equal(["p1", "i1"], list.Select(c => c.Id));
    }

    private static OutfitImportOccurrence Occ(string reference, ItemCategory category, double confidence = 0.9) =>
        new() { Ref = reference, Category = category, Confidence = confidence };

    [Fact]
    public void AssignSlots_OnePiecePerSlot_TheMostConfidentWins()
    {
        OutfitImportOccurrence[] pieces =
        [
            Occ("1-1", ItemCategory.Top), Occ("1-2", ItemCategory.Bottom), Occ("1-3", ItemCategory.Shoes),
            Occ("1-4", ItemCategory.Bag, 0.6), Occ("1-5", ItemCategory.Accessory, 0.8), Occ("1-6", ItemCategory.Outerwear),
        ];

        OutfitImportRules.AssignSlots(pieces, p => p.Category);

        Assert.Equal([OutfitSlot.Top, OutfitSlot.Bottom, OutfitSlot.Shoes, null, OutfitSlot.BagAccessory, OutfitSlot.Outerwear], pieces.Select(p => p.Slot));
    }

    [Fact]
    public void AssignSlots_ADressClosesTheBottom_EvenWhenLessConfident()
    {
        OutfitImportOccurrence[] pieces = [Occ("1-1", ItemCategory.Bottom, 0.95), Occ("1-2", ItemCategory.Dress, 0.7), Occ("1-3", ItemCategory.Top, 0.9)];

        OutfitImportRules.AssignSlots(pieces, p => p.Category);

        Assert.Equal([null, OutfitSlot.Top, null], pieces.Select(p => p.Slot));
    }

    [Fact]
    public void AssignSlots_UsesTheMatchedItemsCategory()
    {
        var piece = Occ("1-1", ItemCategory.Top);
        OutfitImportRules.AssignSlots([piece], _ => ItemCategory.Outerwear);
        Assert.Equal(OutfitSlot.Outerwear, piece.Slot);
    }

    [Theory]
    [InlineData(new[] { OutfitImportPhotoStatus.Pending, OutfitImportPhotoStatus.Pending }, OutfitImportPhase.Uploading)]
    [InlineData(new[] { OutfitImportPhotoStatus.Uploaded, OutfitImportPhotoStatus.Ready }, OutfitImportPhase.Processing)]
    [InlineData(new[] { OutfitImportPhotoStatus.Detected, OutfitImportPhotoStatus.Pending }, OutfitImportPhase.Processing)]
    [InlineData(new[] { OutfitImportPhotoStatus.Ready, OutfitImportPhotoStatus.Failed }, OutfitImportPhase.Ready)]
    [InlineData(new[] { OutfitImportPhotoStatus.Ready, OutfitImportPhotoStatus.Pending }, OutfitImportPhase.Ready)]   // a photo never uploaded does not block the review
    [InlineData(new[] { OutfitImportPhotoStatus.Failed, OutfitImportPhotoStatus.Failed }, OutfitImportPhase.Failed)]
    public void Phase_IsDerivedFromThePhotos(OutfitImportPhotoStatus[] photos, OutfitImportPhase expected)
    {
        Assert.Equal(expected, OutfitImportRules.Phase(OutfitImportStatus.Open, photos));
        Assert.Equal(OutfitImportPhase.Committed, OutfitImportRules.Phase(OutfitImportStatus.Committed, photos));
        Assert.Equal(expected == OutfitImportPhase.Ready, OutfitImportRules.CanCommit(expected));
    }

    [Fact]
    public void Backoff_Doubles_UpToTheCap()
    {
        Assert.Equal([20, 40, 80, 160, 320, 600, 600], Enumerable.Range(0, 7).Select(n => (int)OutfitImportRules.Backoff(n, 20, 600).TotalSeconds));
    }

    [Fact]
    public void Leases_ExpiredOnesAndTheCallersOwn_DoNotCount()
    {
        OutfitImportLease[] leases = [new() { Holder = "a", Until = T0.AddSeconds(30) }, new() { Holder = "b", Until = T0.AddSeconds(-1) }, new() { Holder = "c", Until = T0.AddMinutes(1) }];
        Assert.Equal(["a"], OutfitImportRules.Live(leases, T0, except: "c").Select(l => l.Holder));
    }
}

public class OutfitImportPlanLimitTests
{
    [Fact]
    public void MaxPhotos_IsAPlanLimit_FromConfiguration_EachPlanItsOwnValue()
    {
        var options = new EntitlementOptions();
        Assert.Equal((30, 30), (EntitlementPolicy.OutfitImportMaxPhotos(Tier.Free, options), EntitlementPolicy.OutfitImportMaxPhotos(Tier.Premium, options)));

        options.Free.OutfitImportMaxPhotos = 8;
        options.Premium.OutfitImportMaxPhotos = 50;
        Assert.Equal(8, EntitlementPolicy.OutfitImportMaxPhotos(Tier.Free, options));
        Assert.Equal(50, EntitlementPolicy.OutfitImportMaxPhotos(Tier.Premium, options));

        options.Free.OutfitImportMaxPhotos = 0;   // never below one photo
        Assert.Equal(1, EntitlementPolicy.OutfitImportMaxPhotos(Tier.Free, options));
    }

    [Fact]
    public void SettingsCatalog_LetsTheOwnerEditBothPlanLimits_InBothParameters()
    {
        var group = Domain.Services.Admin.SettingsCatalog.Find("entitlements")!;
        Assert.Contains(group.Fields, f => f.Key == "Free.OutfitImportMaxPhotos" && f.Min == 1);
        Assert.Contains(group.Fields, f => f.Key == "Premium.OutfitImportMaxPhotos" && f.Min == 1);
        Assert.Equal(["api/Entitlements", "worker/Entitlements"], group.Parameters.Select(p => $"{p.Scope}/{p.Section}"));
    }
}
