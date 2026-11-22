using Domain.Enum;
using Domain.Services;

namespace DomainTests.Services;

public class VisibilityPolicyTests
{
    private const string Owner = "owner";
    private const string Viewer = "viewer";

    private static bool Can(ClosetVisibility visibility, bool follows, VisibleResource resource, string viewer = Viewer, Segment? segment = Segment.Women, bool blocked = false, bool deleted = false) =>
        VisibilityPolicy.CanView(new VisibilityRequest(viewer, Owner, visibility, follows, resource, segment, blocked, deleted));

    // 3 settings × (owner, follower, non-follower) for closet content (TEAM_LEAD.md review checklist).
    public static TheoryData<ClosetVisibility, ViewerRelation, bool> ClosetMatrix => new()
    {
        { ClosetVisibility.Public, ViewerRelation.Self, true },
        { ClosetVisibility.Public, ViewerRelation.Follower, true },
        { ClosetVisibility.Public, ViewerRelation.None, true },
        { ClosetVisibility.FollowersOnly, ViewerRelation.Self, true },
        { ClosetVisibility.FollowersOnly, ViewerRelation.Follower, true },
        { ClosetVisibility.FollowersOnly, ViewerRelation.None, false },
        { ClosetVisibility.Private, ViewerRelation.Self, true },
        { ClosetVisibility.Private, ViewerRelation.Follower, false },
        { ClosetVisibility.Private, ViewerRelation.None, false },
    };

    [Theory]
    [MemberData(nameof(ClosetMatrix))]
    public void VisibilityPolicy_ItemsAndLooks_FollowSettingAndRelation(ClosetVisibility visibility, ViewerRelation relation, bool expected)
    {
        var viewer = relation == ViewerRelation.Self ? Owner : Viewer;
        var follows = relation == ViewerRelation.Follower;

        foreach (var resource in new[] { VisibleResource.Item, VisibleResource.Look, VisibleResource.LookRating })
            Assert.Equal(expected, Can(visibility, follows, resource, viewer));
    }

    public static TheoryData<VisibleResource> NeverShared => new()
    {
        VisibleResource.BodyPhoto, VisibleResource.FacePhoto, VisibleResource.TryOnImage, VisibleResource.PaletteResult,
        VisibleResource.BodyProfile, VisibleResource.CartLine, VisibleResource.PlanDay, VisibleResource.WearLog,
        VisibleResource.NotificationPrefs, VisibleResource.Email, VisibleResource.FutureTrip, VisibleResource.PastTrip,
    };

    [Theory]
    [MemberData(nameof(NeverShared))]
    public void VisibilityPolicy_PrivateData_NeverVisibleToOthers_EvenPublicAndFollowing(VisibleResource resource)
    {
        foreach (var visibility in System.Enum.GetValues<ClosetVisibility>())
        foreach (var follows in new[] { true, false })
            Assert.False(Can(visibility, follows, resource));

        Assert.True(VisibilityPolicy.IsNeverShared(resource));
    }

    [Theory]
    [MemberData(nameof(NeverShared))]
    public void VisibilityPolicy_PrivateData_VisibleToOwner(VisibleResource resource)
    {
        Assert.True(Can(ClosetVisibility.Private, false, resource, viewer: Owner));
    }

    [Theory]
    [InlineData(ClosetVisibility.Public, true)]
    [InlineData(ClosetVisibility.FollowersOnly, true)]
    [InlineData(ClosetVisibility.Private, false)]
    public void VisibilityPolicy_ProfileCard_HiddenOnlyWhenPrivate(ClosetVisibility visibility, bool expected)
    {
        Assert.Equal(expected, Can(visibility, false, VisibleResource.ProfileCard));
    }

    [Theory]
    [InlineData(true, false, false, true)]    // the private owner follows the viewer
    [InlineData(false, true, false, true)]    // the viewer follows the private owner (approved)
    [InlineData(false, false, true, true)]    // the private owner asked to follow the viewer
    [InlineData(false, false, false, false)]  // stranger
    public void VisibilityPolicy_PrivateCard_OnlyInsideARelationship_ClosetStaysClosed(bool ownerFollowsViewer, bool viewerFollowsOwner, bool ownerRequested, bool card)
    {
        bool CanSee(VisibleResource resource) => VisibilityPolicy.CanView(new VisibilityRequest(Viewer, Owner, ClosetVisibility.Private, viewerFollowsOwner, resource,
            Segment.Women, OwnerFollowsViewer: ownerFollowsViewer, OwnerRequestedViewer: ownerRequested));

        Assert.Equal(card, CanSee(VisibleResource.ProfileCard));
        Assert.False(CanSee(VisibleResource.Look));
        Assert.False(CanSee(VisibleResource.Item));
    }

    [Fact]
    public void VisibilityPolicy_PendingFollowRequest_IsNotFollowing()
    {
        // Callers pass only accepted edges: a pending request reaches the policy as "not following".
        var context = new PersonContext(Viewer, new Domain.Entity.TenantEntity { Id = Owner, ClosetVisibility = ClosetVisibility.FollowersOnly, Segment = Segment.Women },
            ViewerFollowsOwner: false, OwnerFollowsViewer: false, Blocked: false, ViewerRequested: true);

        Assert.Equal(FollowState.Requested, context.FollowState);
        Assert.True(context.CanView(VisibleResource.ProfileCard));
        Assert.False(context.CanView(VisibleResource.Look));
        Assert.False(context.CanView(VisibleResource.LookRating));
    }

    [Fact]
    public void VisibilityPolicy_WhenUnfollowed_AccessClosesImmediately()
    {
        Assert.True(Can(ClosetVisibility.FollowersOnly, true, VisibleResource.Look));
        Assert.False(Can(ClosetVisibility.FollowersOnly, false, VisibleResource.Look));
    }

    [Fact]
    public void VisibilityPolicy_WhenBlockedOrDeleted_NothingVisible()
    {
        Assert.False(Can(ClosetVisibility.Public, true, VisibleResource.Look, blocked: true));
        Assert.False(Can(ClosetVisibility.Public, true, VisibleResource.ProfileCard, deleted: true));
    }

    [Fact]
    public void VisibilityPolicy_WhenOwnerIsTeen_NothingVisible_UntilA5()
    {
        Assert.False(Can(ClosetVisibility.Public, true, VisibleResource.Look, segment: Segment.Teen));
        Assert.False(Can(ClosetVisibility.Public, true, VisibleResource.ProfileCard, segment: Segment.Teen));
    }

    [Fact]
    public void VisibilityPolicy_EveryResourceKindIsClassified()
    {
        var shared = new[] { VisibleResource.ProfileCard, VisibleResource.Item, VisibleResource.Look, VisibleResource.LookRating, VisibleResource.FeedSharedLook };
        foreach (var resource in System.Enum.GetValues<VisibleResource>())
            Assert.True(shared.Contains(resource) ^ VisibilityPolicy.IsNeverShared(resource), $"{resource} unclassified");
    }

    [Fact]
    public void RelationOf_ReturnsSelfFollowerNone()
    {
        Assert.Equal(ViewerRelation.Self, VisibilityPolicy.RelationOf("a", "a", false));
        Assert.Equal(ViewerRelation.Follower, VisibilityPolicy.RelationOf("a", "b", true));
        Assert.Equal(ViewerRelation.None, VisibilityPolicy.RelationOf("a", "b", false));
    }
}
