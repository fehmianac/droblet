namespace Domain.Constant;

/// <summary>Stable snake_case error codes. The client owns the TR/EN sentences.</summary>
public static partial class ErrorCodes
{
    public const string ValidationFailed = "validation_failed";
    public const string NotFound = "not_found";
    public const string VersionConflict = "version_conflict";

    // Auth
    public const string EmailTaken = "email_taken";
    public const string InvalidCredentials = "invalid_credentials";
    public const string TooManyAttempts = "too_many_attempts";
    public const string InvalidOrExpiredToken = "invalid_or_expired_token";
    public const string InvalidRefreshToken = "invalid_refresh_token";
    public const string InvalidIdentityToken = "invalid_identity_token";
    public const string ProviderNotConfigured = "provider_not_configured";
    public const string SmsUnavailable = "sms_unavailable";

    // Profile
    public const string HandleTaken = "handle_taken";
    public const string HandleReserved = "handle_reserved";
    public const string SegmentNotAvailable = "segment_not_available";

    // Photo
    public const string UploadNotFound = "upload_not_found";
    public const string UploadKindMismatch = "upload_kind_mismatch";
    public const string UploadMissing = "upload_missing";
    public const string UnsupportedImage = "unsupported_image";
    public const string PhotoTooLarge = "photo_too_large";

    // Entitlement / credits
    public const string PremiumRequired = "premium_required";
    public const string CreditsExhausted = "credits_exhausted";
    /// <summary>402: a non-member used every free AI garment recognition. The client shows the paywall; manual entry stays possible.</summary>
    public const string ItemRecognitionLimitReached = "item_recognition_limit_reached";
    public const string PurchaseVerificationUnavailable = "purchase_verification_unavailable";
    /// <summary>422: the store did not confirm the purchase (signature, bundle, product or environment).</summary>
    public const string PurchaseInvalid = "purchase_invalid";
    public const string ProductUnknown = "product_unknown";
    /// <summary>409: this store purchase is already linked to another Droblet account (same Apple ID / Google account).</summary>
    public const string PurchaseOwnedByAnotherAccount = "purchase_owned_by_another_account";
    /// <summary>202: Android pending purchase / Ask to Buy — granted when the store completes it (notification).</summary>
    public const string PurchasePending = "purchase_pending";
}
