namespace Domain.Enum;

public enum Segment { Women, Men, Teen }

public enum StyleTag { Minimal, Classic, QuietLuxury, Street, Boho, Sporty, Romantic, OfficeChic, Colorful, Vintage }

public enum Budget { HighStreet, Mixed, LuxuryTouch }

public enum ClothingSize { XXS, XS, S, M, L, XL, XXL, XXXL }

public enum ClosetVisibility { Public, FollowersOnly, Private }

public enum PhotoKind { Body, Face }

public enum JobKind { ItemProcess, StylistOutfit, StylistWeek, StylistPack, StylistComplete, TryOn, Palette, ItemSplit }

public enum JobStatus { Queued, Processing, Completed, Failed }

public enum JobFailure { ProviderError, Timeout, GuardRejected, SourceDeleted, NoFaceDetected }

/// <summary>TripDay id = "{tripId}/{yyyy-MM-dd}": the look of one trip day (BavulDetay).</summary>
public enum TryOnTargetKind { Item, Look, Product, EditLook, Suggestion, TripDay }

public enum Tier { Free, Premium }

public enum Capability
{
    TryOn,
    DailyStylist,
    SmartSuitcase,
    PaletteAnalysis,
    CompleteLook,
    ItemProcessing,
    WardrobeItem,
}

// Admin = a TEST premium granted from the admin panel (audited; never sold).
public enum EntitlementSource { Store, Admin }

public enum StorePlatform { Apple, Google }

/// <summary>Store state of a subscription / purchase. Access: Active and GracePeriod only.</summary>
public enum StoreSubscriptionState { Active, GracePeriod, BillingRetry, Expired, Revoked, Pending }

public enum StoreProductKind { Subscription, Consumable }

/// <summary>What a device registered as its push token: an FCM registration token (Android) or a raw APNs token (iOS).</summary>
public enum PushTokenType { Fcm, Apns }

public enum NotificationType { MorningOutfit, WeeklyEdit, FriendRatings, PriceDrop, FollowRequest }

public enum AuthProvider { Email, Apple, Google }

public enum CreditReservationStatus { Reserved, Committed }

public enum CreditLedgerEntryKind { AllowanceReserved, PackReserved, Committed, Refunded, PackPurchased, PackRevoked }

public enum AffiliateSource { Network, Direct }

public enum AffiliateConversionStatus { Pending, Approved, Rejected }

public enum ViewerRelation { Self, Follower, None }

/// <summary>Resource kinds a viewer may ask to read from another tenant. Owner always sees everything.</summary>
public enum VisibleResource
{
    ProfileCard,
    Item,
    Look,
    LookRating,
    PastTrip,
    FutureTrip,
    BodyPhoto,
    FacePhoto,
    TryOnImage,
    PaletteResult,
    BodyProfile,
    CartLine,
    PlanDay,
    WearLog,
    NotificationPrefs,
    Email,
}

/// <summary>Admin panel roles (owner decision 2). Permissions per role: Domain.Services.Admin.AdminPermissions.</summary>
public enum AdminRole { SuperAdmin, ContentEditor, Moderator }
