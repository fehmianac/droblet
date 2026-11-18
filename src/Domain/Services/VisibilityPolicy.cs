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
    bool OwnerDeleted = false);

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

        // A-5: Teen accounts stay out of every social read until the decision lands.
        if (request.OwnerSegment == Segment.Teen)
            return false;

        if (request.Resource == VisibleResource.ProfileCard)
            return request.OwnerVisibility != ClosetVisibility.Private; // Private in search: A-6

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
