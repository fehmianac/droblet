namespace Domain.Enum;

public enum Segment { Women, Men, Teen }

public enum StyleTag { Minimal, Classic, QuietLuxury, Street, Boho, Sporty, Romantic, OfficeChic, Colorful, Vintage }

public enum Budget { HighStreet, Mixed, LuxuryTouch }

public enum ClothingSize { XXS, XS, S, M, L, XL, XXL, XXXL }

public enum ClosetVisibility { Public, FollowersOnly, Private }

public enum PhotoKind { Body, Face }

/// <summary>DataExport: "Verilerimi indir" (not an AI job; only its queue routing uses the kind). OutfitImport: one photo of a
/// "Kombinlerini içe aktar" session (no JobEntity; the photo row is the state, the kind routes the queue).</summary>
/// <remarks>AiTrial: an admin prompt dry-run / model test (AiTrialEntity, not a JobEntity); only its queue routing uses the kind.</remarks>
public enum JobKind { ItemProcess, StylistOutfit, StylistWeek, StylistPack, StylistComplete, TryOn, Palette, ItemSplit, ItemClean, DataExport, OutfitImport, AiTrial }

public enum JobStatus { Queued, Processing, Completed, Failed }

public enum JobFailure { ProviderError, Timeout, GuardRejected, SourceDeleted, NoFaceDetected, PhotoUnsuitable }

/// <summary>
/// Canvas 11 vücut tipi (face try-on path): the figure the image model builds when there is no body photo.
/// Unsure = "Emin değilim" (a balanced figure from height and size).
/// </summary>
public enum BodyType { Hourglass, Pear, Apple, Rectangle, InvertedTriangle, Unsure }

/// <summary>Which photo a try-on image was created from: the body photo, or the face photo + body type (no body photo).</summary>
public enum TryOnSource { Body, Face }

/// <summary>Why the server-side photo check rejected a body / face photo (no credit is charged; the photo is removed).</summary>
public enum PhotoIssue { NotFullBody, TooDark, MultiplePeople, Blurry, NoFace }

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

/// <summary>DataExportReady: inbox only (with the e-mail), never pushed. ContentRemoved: inbox only, written when a moderator
/// removes a look / item / the profile's public fields (report resolved as contentRemoved). OutfitImportReady: inbox only,
/// written when every uploaded photo of an outfit import session was processed (ready for review).</summary>
public enum NotificationType { MorningOutfit, WeeklyEdit, FriendRatings, PriceDrop, FollowRequest, DataExportReady, ContentRemoved, OutfitImportReady }

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

/// <summary>
/// The seven separate explicit consents of docs/legal (landing `/consents`). Wire names are camelCase
/// (bodyPhotoAi, facePhotoPalette, weight, contacts, marketingNotifications, crossBorderTransfer, facePhotoTryOn).
/// FacePhotoTryOn (consent 7) = the face photo used to create try-on images when there is no body photo; appended last.
/// </summary>
public enum ConsentType { BodyPhotoAi, FacePhotoPalette, Weight, Contacts, MarketingNotifications, CrossBorderTransfer, FacePhotoTryOn }
