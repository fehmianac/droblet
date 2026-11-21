using Domain.Enum;

namespace Domain.Services;

public sealed record VisibilityRequest(
    string ViewerTenantId,
    string OwnerTenantId,
    ClosetVisibility OwnerVisibility,
    bool ViewerFollowsOwner,
    VisibleResource Resource,
    Segment? OwnerSegment = null,
    bool OwnerBlockedViewer = false,
    bool OwnerDeleted = false,
    // Accepted follow edges only — a pending follow request is NOT following (decision 8).
    bool OwnerFollowsViewer = false,
    // The owner has a pending request to follow the viewer: the viewer may see who is asking (profile card only).
    bool OwnerRequestedViewer = false);

/// <summary>
/// The only gate for reading another tenant's data (E9). Called on every request with the current
/// visibility + follow record — decisions are never cached. Denied reads surface as 404.
/// Body/face photos, try-on images, palette result, body profile, cart, plan, wear log, notification prefs
/// and e-mail are never visible to anyone else, whatever the closet setting.
/// </summary>
public static class VisibilityPolicy
{
    private static readonly HashSet<VisibleResource> NeverShared =
    [
        VisibleResource.BodyPhoto,
        VisibleResource.FacePhoto,
        VisibleResource.TryOnImage,
        VisibleResource.PaletteResult,
        VisibleResource.BodyProfile,
        VisibleResource.CartLine,
        VisibleResource.PlanDay,
        VisibleResource.WearLog,
        VisibleResource.NotificationPrefs,
        VisibleResource.Email,
        VisibleResource.FutureTrip,
        // SECURITY_ENGINEER.md: trips stay closed until the owner decides (A-6).
        VisibleResource.PastTrip,
    ];

    public static bool IsNeverShared(VisibleResource resource) => NeverShared.Contains(resource);

    public static bool CanView(VisibilityRequest request)
    {
        if (request.ViewerTenantId == request.OwnerTenantId)
            return true;

        if (request.OwnerDeleted || request.OwnerBlockedViewer)
            return false;

        if (NeverShared.Contains(request.Resource))
            return false;

        // Teen accounts (age band teen — passed as OwnerSegment Teen — docs/api/teen.md §4) stay out of every social read.
        if (request.OwnerSegment == Segment.Teen)
            return false;

        // Decision 7: public and followers-only cards are searchable. A private card is visible only inside an existing
        // relationship (either side follows the other), so a private owner's followers can find her and she can be asked.
        if (request.Resource == VisibleResource.ProfileCard)
            return request.OwnerVisibility != ClosetVisibility.Private
                   || request.ViewerFollowsOwner || request.OwnerFollowsViewer || request.OwnerRequestedViewer;

        return request.OwnerVisibility switch
        {
            ClosetVisibility.Public => true,
            ClosetVisibility.FollowersOnly => request.ViewerFollowsOwner,
            _ => false,
        };
    }

    public static ViewerRelation RelationOf(string viewerTenantId, string ownerTenantId, bool viewerFollowsOwner) =>
        viewerTenantId == ownerTenantId ? ViewerRelation.Self
        : viewerFollowsOwner ? ViewerRelation.Follower
        : ViewerRelation.None;
}
