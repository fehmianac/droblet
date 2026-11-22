namespace Domain.Enum;

/// <summary>
/// The clothing segment ("reyon"): which content a user sees. Teen is DEPRECATED as a reyon (docs/api/teen.md §1): age rules
/// live in <see cref="AgeBand"/>; the value stays for old clients and is never open.
/// </summary>
public enum Segment { Women, Men, Teen }

/// <summary>Age band of an account (docs/api/teen.md): Teen = 16–17 with the teen rules on top of the chosen segment.</summary>
public enum AgeBand { Adult, Teen }

/// <summary>Verified parental consent of a teen account. Only Active lifts the limited mode.</summary>
public enum ParentalConsentStatus { PendingParentalConsent, Active, Declined, Withdrawn }

/// <summary>History rows of the parental consent (admin, audit).</summary>
public enum ParentalConsentEvent { Requested, Resent, Approved, Declined, Withdrawn, Expired, Ended }

/// <summary>Request = the 7-day approval link; Manage = the withdrawal link of the confirmation e-mail (until 18).</summary>
public enum ParentalTokenKind { Request, Manage }

/// <summary>
/// Who a ready-library piece or a catalog product is for. Unisex is shown to every segment. Rows written before the men
/// launch carry no value = Women (the enum default).
/// </summary>
public enum CatalogSegment { Women, Men, Unisex }

/// <summary>Per segment list: Domain.Services.SegmentTaxonomy.StyleTags. SmartCasual and Tailored were added for men (appended; values are names on the wire).</summary>
public enum StyleTag { Minimal, Classic, QuietLuxury, Street, Boho, Sporty, Romantic, OfficeChic, Colorful, Vintage, SmartCasual, Tailored }

public enum Budget { HighStreet, Mixed, LuxuryTouch }

public enum ClothingSize { XXS, XS, S, M, L, XL, XXL, XXXL }

public enum ClosetVisibility { Public, FollowersOnly, Private }

public enum PhotoKind { Body, Face }

/// <summary>DataExport: "Verilerimi indir" (not an AI job; only its queue routing uses the kind). OutfitImport: one photo of a
/// "Kombinlerini içe aktar" session (no JobEntity; the photo row is the state, the kind routes the queue).</summary>
/// <remarks>AiTrial: an admin prompt dry-run / model test (AiTrialEntity, not a JobEntity); only its queue routing uses the kind.</remarks>
public enum JobKind { ItemProcess, StylistOutfit, StylistWeek, StylistPack, StylistComplete, TryOn, Palette, ItemSplit, ItemClean, DataExport, OutfitImport, AiTrial, LookCover }

public enum JobStatus { Queued, Processing, Completed, Failed }

public enum JobFailure { ProviderError, Timeout, GuardRejected, SourceDeleted, NoFaceDetected, PhotoUnsuitable }

/// <summary>
/// Canvas 11 vücut tipi (face try-on path): the figure the image model builds when there is no body photo.
/// Unsure = "Emin değilim" (a balanced figure from height and size).
/// Women: Hourglass, Pear, Apple, Rectangle, InvertedTriangle, Unsure. Men: Rectangle, InvertedTriangle (V shape), Triangle
/// (wider hips / waist), Oval (round midsection), Trapezoid (athletic), Unsure — Domain.Services.SegmentTaxonomy.BodyTypes.
/// The men's values are appended so stored values keep their meaning.
/// </summary>
public enum BodyType { Hourglass, Pear, Apple, Rectangle, InvertedTriangle, Unsure, Triangle, Oval, Trapezoid }

/// <summary>Which photo a try-on image was created from: the body photo, or the face photo + body type (no body photo).</summary>
public enum TryOnSource { Body, Face }

/// <summary>Why the server-side photo check rejected a body / face photo (no credit is charged; the photo is removed).</summary>
public enum PhotoIssue { NotFullBody, TooDark, MultiplePeople, Blurry, NoFace }

/// <summary>Why an outfit photo ("kombin fotoğrafı", try-on target Photo) cannot be tried on: no person, several people, no clothing visible, or someone who appears to be under 18.</summary>
public enum ReferenceIssue { NoPerson, MultiplePeople, NoClothing, Minor }

/// <summary>
/// TripDay id = "{tripId}/{yyyy-MM-dd}": the look of one trip day (BavulDetay). Photo id = an item upload / item draft id
/// (a photo of someone wearing a whole outfit, tried on without splitting it into pieces); ImportPhoto id = an outfit
/// import session id + index = the photo number. Both are stored as Photo with id = the reference image hash.
/// </summary>
public enum TryOnTargetKind { Item, Look, Product, EditLook, Suggestion, TripDay, Photo, ImportPhoto }

public enum Tier { Free, Premium }

/// <summary>What a teen stylist allowance slot is for (Teen:Stylist): outfit / day, week plan / week, trip packing / week.</summary>
public enum TeenStylistKind { Outfit, WeekPlan, TripPack }

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
/// written when every uploaded photo of an outfit import session was processed (ready for review). ParentalConsentApproved /
/// ParentalConsentWithdrawn / TeenBecameAdult: inbox only (teen mode, docs/api/teen.md).</summary>
public enum NotificationType { MorningOutfit, WeeklyEdit, FriendRatings, PriceDrop, FollowRequest, DataExportReady, ContentRemoved, OutfitImportReady,
    ParentalConsentApproved, ParentalConsentWithdrawn, TeenBecameAdult }

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
/// FacePhotoTryOn (consent 7) = the face photo used to create try-on images when there is no body photo.
/// TeenTryOn = a teen's own consent to try-on (docs/api/teen.md §6); listed for teen accounts only; appended last.
/// </summary>
public enum ConsentType { BodyPhotoAi, FacePhotoPalette, Weight, Contacts, MarketingNotifications, CrossBorderTransfer, FacePhotoTryOn, TeenTryOn }
