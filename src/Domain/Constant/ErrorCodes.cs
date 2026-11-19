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
    /// <summary>403: the account was suspended by an admin (sign-in, refresh, social sign-in).</summary>
    public const string AccountSuspended = "account_suspended";

    // Admin panel (docs/api/admin.md)
    public const string InvalidCode = "invalid_code";
    public const string ChallengeExpired = "challenge_expired";
    public const string InvalidToken = "invalid_token";
    public const string Forbidden = "forbidden";
    public const string CannotChangeSelf = "cannot_change_self";
    public const string LastSuperAdmin = "last_super_admin";
    public const string SettingsUnavailable = "settings_unavailable";
    public const string ImageStorageNotConfigured = "image_storage_not_configured";
    public const string TooManyRequests = "too_many_requests";
    /// <summary>503: the sign-in code e-mail could not be sent (SendGrid not configured or down).</summary>
    public const string EmailUnavailable = "email_unavailable";

    // Profile
    public const string HandleTaken = "handle_taken";
    public const string HandleReserved = "handle_reserved";
    public const string SegmentNotAvailable = "segment_not_available";

    /// <summary>400 (register): the "I am 18 or older" box was not ticked.</summary>
    public const string AgeConfirmationRequired = "age_confirmation_required";

    // Consents (docs/legal consents 1–6)
    /// <summary>403 with `missing` (camelCase consent types): the feature needs an explicit consent on the current text version.</summary>
    public const string ConsentRequired = "consent_required";
    /// <summary>409: a consent was given on a text version that is no longer current (outdated app).</summary>
    public const string ConsentVersionOutdated = "consent_version_outdated";

    // Avatar
    /// <summary>422: the avatar's longest side is above Avatar:MaxDimension (the app resizes before upload).</summary>
    public const string AvatarTooLarge = "avatar_too_large";

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
    /// <summary>403: self-serve premium is switched off (Entitlements:SelfServePremium:Enabled = false).</summary>
    public const string SelfPremiumDisabled = "self_premium_disabled";
    /// <summary>409: the account already has premium from a store subscription; self-serve premium is not needed and never replaces it.</summary>
    public const string StoreSubscriptionActive = "store_subscription_active";
}
