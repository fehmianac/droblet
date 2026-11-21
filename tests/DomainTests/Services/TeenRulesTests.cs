using Domain.Entity;
using Domain.Enum;
using Domain.Services;
using Domain.Services.Styling;

namespace DomainTests.Services;

public class TeenRulesTests
{
    private static readonly DateOnly Today = new(2026, 11, 21);

    [Theory]
    [InlineData(1990, null, AgeOutcome.Adult)]
    [InlineData(2007, null, AgeOutcome.Adult)]          // 18 or 19
    [InlineData(2009, null, AgeOutcome.Teen)]           // 16 or 17
    [InlineData(2008, null, AgeOutcome.NeedsMonth)]     // 17 or 18
    [InlineData(2010, null, AgeOutcome.NeedsMonth)]     // 15 or 16
    [InlineData(2011, null, AgeOutcome.UnderMinimum)]
    [InlineData(2008, 10, AgeOutcome.Adult)]            // birthday month passed
    [InlineData(2008, 11, AgeOutcome.Teen)]             // birthday month counts from the next month (conservative)
    [InlineData(2010, 10, AgeOutcome.Teen)]
    [InlineData(2010, 11, AgeOutcome.UnderMinimum)]
    [InlineData(2027, null, AgeOutcome.InvalidYear)]
    [InlineData(1900, null, AgeOutcome.InvalidYear)]
    [InlineData(1990, 0, AgeOutcome.InvalidMonth)]
    public void AgeBands_FromTheBirthYear_AndTheMonthOnlyWhenAmbiguous(int year, int? month, AgeOutcome expected) =>
        Assert.Equal(expected, AgeRules.Evaluate(year, month, Today).Outcome);

    [Fact]
    public void AdultFrom_IsTheFirstSureDay()
    {
        Assert.Equal(new DateOnly(2027, 1, 1), AgeRules.AdultFrom(2008, 12));
        Assert.Equal(new DateOnly(2028, 1, 1), AgeRules.AdultFrom(2009, null));
        Assert.Equal(new DateOnly(2027, 1, 1), AgeRules.Evaluate(2009, null, Today).AdultFrom!.Value.AddYears(-1));
        Assert.False(AgeRules.IsAdultOn(2008, 12, new DateOnly(2026, 12, 31)));
        Assert.True(AgeRules.IsAdultOn(2008, 12, new DateOnly(2027, 1, 1)));
    }

    [Theory]
    [InlineData("POST", "v1/tenant/follow/{handle}", TeenFeature.Social)]
    [InlineData("GET", "v1/tenant/follower", TeenFeature.Social)]
    [InlineData("POST", "v1/tenant/follow-request/{handle}/approve", TeenFeature.Social)]
    [InlineData("PUT", "v1/tenant/people/{handle}/look/{lookId}/rating", TeenFeature.Social)]
    [InlineData("GET", "v1/tenant/feed", TeenFeature.Social)]
    [InlineData("POST", "v1/tenant/invite/attribution", TeenFeature.Social)]
    [InlineData("POST", "v1/tenant/contacts/match", TeenFeature.Social)]
    [InlineData("PUT", "v1/tenant/profile/handle", TeenFeature.Social)]
    [InlineData("POST", "v1/tenant/cart/checkout/{brandId}", TeenFeature.Commerce)]
    [InlineData("POST", "v1/tenant/catalog/product/{id}/checkout", TeenFeature.Commerce)]
    [InlineData("POST", "v1/tenant/entitlement/purchase", TeenFeature.Commerce)]
    [InlineData("GET", "v1/tenant/palette/products", TeenFeature.Commerce)]
    public void Routes_ClosedToTeens(string method, string pattern, TeenFeature feature) =>
        Assert.Equal(feature, TeenRouteRules.Classify(method, pattern)?.Feature);

    [Theory]
    [InlineData("POST", "v1/tenant/photo/upload-url")]
    [InlineData("PUT", "v1/tenant/photo/{kind}")]
    [InlineData("POST", "v1/tenant/tryon")]
    [InlineData("POST", "v1/tenant/stylist/week")]
    [InlineData("POST", "v1/tenant/trip/{id}/pack")]
    [InlineData("POST", "v1/tenant/outfit-import/{id}/photos/{index:int}/uploaded")]
    public void Routes_InLimitedMode(string method, string pattern) =>
        Assert.True(TeenRouteRules.Classify(method, pattern)?.LimitedMode);

    [Theory]
    [InlineData("GET", "v1/tenant/block")]
    [InlineData("PUT", "v1/tenant/block/{handle}")]
    [InlineData("GET", "v1/tenant/item")]
    [InlineData("DELETE", "v1/tenant/photo")]
    [InlineData("GET", "v1/tenant/tryon")]
    [InlineData("GET", "v1/tenant/entitlement")]
    [InlineData("POST", "v1/auth/register")]
    [InlineData("GET", "v1/parent-consent")]
    public void Routes_OpenToTeens(string method, string pattern) => Assert.Null(TeenRouteRules.Classify(method, pattern));

    [Theory]
    [InlineData(false, ParentalConsentStatus.Active, true, true, "feature_off")]
    [InlineData(true, ParentalConsentStatus.PendingParentalConsent, true, true, "consent_not_active")]
    [InlineData(true, ParentalConsentStatus.Withdrawn, true, true, "consent_not_active")]
    [InlineData(true, ParentalConsentStatus.Active, false, true, "parent_not_allowed")]
    [InlineData(true, ParentalConsentStatus.Active, true, false, "own_consent_missing")]
    [InlineData(true, ParentalConsentStatus.Active, true, true, null)]
    public void TryOn_NeedsAllThreeConditions(bool flag, ParentalConsentStatus status, bool box, bool own, string? reason) =>
        Assert.Equal(reason, TeenRules.TryOnBlockReason(flag, status, box, own));

    [Fact]
    public void TeenTryOn_FlagDefaultsToFalse_AndTeenSignUpIsOffByDefault()
    {
        var options = new Domain.Options.TeenOptions();
        Assert.False(options.TryOnEnabled);
        Assert.False(options.Enabled);
        Assert.Equal(7, options.ConsentLinkDays);
        Assert.Equal(90, options.PhotoRetentionInactiveDays);
    }

    [Fact]
    public void OutfitPhotoTargets_RevealingPieces_ClosedConsents()
    {
        Assert.True(TeenRules.IsOutfitPhotoTarget(TryOnTargetKind.Photo));
        Assert.True(TeenRules.IsOutfitPhotoTarget(TryOnTargetKind.ImportPhoto));
        Assert.False(TeenRules.IsOutfitPhotoTarget(TryOnTargetKind.Look));
        Assert.True(TeenRules.IsRevealing(ItemCategory.Beachwear, null));
        Assert.True(TeenRules.IsRevealing(ItemCategory.Top, "crop-top"));
        Assert.False(TeenRules.IsRevealing(ItemCategory.Top, "t-shirt"));
        Assert.Equal(TeenFeature.Marketing, TeenRules.ConsentClosedToTeens(ConsentType.MarketingNotifications));
        Assert.Equal(TeenFeature.Contacts, TeenRules.ConsentClosedToTeens(ConsentType.Contacts));
        Assert.Null(TeenRules.ConsentClosedToTeens(ConsentType.BodyPhotoAi));
    }

    [Fact]
    public void Visibility_ATeenIsInvisibleToOthers_WhateverTheCloset()
    {
        var teen = new TenantEntity { Id = "teen", AgeBand = AgeBand.Teen, ClosetVisibility = ClosetVisibility.Public, Segment = Segment.Women };
        var context = new PersonContext("viewer", teen, ViewerFollowsOwner: true, OwnerFollowsViewer: true, Blocked: false);

        Assert.True(teen.IsTeen);
        Assert.False(context.CanView(VisibleResource.ProfileCard));
        Assert.False(context.CanView(VisibleResource.Look));
        Assert.True(new PersonContext("teen", teen, false, false, false).CanView(VisibleResource.Look));   // the teen sees her own
        Assert.True(new PersonContext("viewer", new TenantEntity { Id = "a", ClosetVisibility = ClosetVisibility.Public }, false, false, false).CanView(VisibleResource.Look));
    }

    [Fact]
    public void StylistGuard_IsStricterForTeens()
    {
        string[] suggestive = ["Bu kombin çok seksi duruyor"];
        string[] plain = ["Okul için rahat bir kombin"];
        Assert.False(StylistOutputGuard.ViolatesContentPolicy(suggestive, teen: false));
        Assert.True(StylistOutputGuard.ViolatesContentPolicy(suggestive, teen: true));
        Assert.True(StylistOutputGuard.ViolatesContentPolicy(["A sexy, revealing look"], teen: true));
        Assert.False(StylistOutputGuard.ViolatesContentPolicy(plain, teen: true));
        Assert.True(StylistOutputGuard.ViolatesContentPolicy(["Seni zayıf gösterir"], teen: true));   // body talk stays refused for everyone
    }

    [Fact]
    public void Masking_AndFirstName()
    {
        Assert.Equal("a***@g***.com", TeenRules.MaskEmail("ayse@gmail.com"));
        Assert.Equal("Elif", TeenRules.FirstName("  Elif Kaya "));
        Assert.Null(TeenRules.FirstName(" "));
    }
}
