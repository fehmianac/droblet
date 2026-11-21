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
    /// <summary>400 (e-mail verification): wrong or old code / link.</summary>
    public const string InvalidVerificationCode = "invalid_verification_code";
    /// <summary>400 (e-mail verification): the code or link is past its 24 hours — ask for a new one.</summary>
    public const string VerificationExpired = "verification_expired";
    /// <summary>409 (e-mail verification): the address is already verified.</summary>
    public const string EmailAlreadyVerified = "email_already_verified";

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
    /// <summary>AI prompts (admin): publish without a saved draft / the text is already live / unknown history entry.</summary>
    public const string NoDraft = "no_draft";
    public const string AlreadyLive = "already_live";
    public const string VersionNotFound = "version_not_found";
    /// <summary>Admin maintenance: a run of the job is already queued / running / cancelling; the run is finished; no failed pieces.</summary>
    public const string MaintenanceRunActive = "maintenance_run_active";
    public const string MaintenanceRunFinished = "maintenance_run_finished";
    public const string NothingToRetry = "nothing_to_retry";
    /// <summary>429: a daily / per-minute cap of AI work without credits (AiLimits) is reached.</summary>
    public const string AiLimitReached = "ai_limit_reached";
    /// <summary>503: the sign-in code e-mail could not be sent (SendGrid not configured or down).</summary>
    public const string EmailUnavailable = "email_unavailable";

    // Profile
    public const string HandleTaken = "handle_taken";
    public const string HandleReserved = "handle_reserved";
    public const string SegmentNotAvailable = "segment_not_available";

    /// <summary>400 (register): the "I am 18 or older" box was not ticked.</summary>
    public const string AgeConfirmationRequired = "age_confirmation_required";

    // Teen mode (docs/api/teen.md §11)
    public const string BirthYearInvalid = "birth_year_invalid";
    public const string BirthMonthInvalid = "birth_month_invalid";
    /// <summary>422: the birth year alone cannot tell the age band (could be 15/16 or 17/18): send birthMonth too.</summary>
    public const string BirthMonthRequired = "birth_month_required";
    /// <summary>422: under 16 — nothing stored (or, after an Apple / Google sign-in, the new account deleted).</summary>
    public const string AgeUnderMinimum = "age_under_minimum";
    /// <summary>422: 16–17 while Teen:Enabled is off.</summary>
    public const string TeenNotAvailable = "teen_not_available";
    /// <summary>403 with `feature`: something a teen account may never do.</summary>
    public const string TeenRestricted = "teen_restricted";
    /// <summary>403 with `status`: the feature waits for the parent's approval (limited mode).</summary>
    public const string ParentalConsentRequired = "parental_consent_required";
    /// <summary>403 with `reason`: teen try-on is not available (flag, parent's box, own consent).</summary>
    public const string TeenTryOnNotAvailable = "teen_try_on_not_available";
    // Teen:Stylist (docs/api/teen.md §4.2): the free-tier teen stylist allowance; 429 with resetsAt, 403 when off.
    public const string TeenStylistDailyLimit = "teen_stylist_daily_limit";
    public const string TeenStylistWeeklyLimit = "teen_stylist_weekly_limit";
    public const string TeenStylistUnavailable = "teen_stylist_unavailable";
    public const string NotATeenAccount = "not_a_teen_account";
    public const string ParentEmailInvalid = "parent_email_invalid";
    public const string ParentEmailSameAsTeen = "parent_email_same_as_teen";
    public const string ParentalConsentAlreadyGiven = "parental_consent_already_given";
    public const string ParentalConsentNotRequested = "parental_consent_not_requested";
    public const string ParentalConsentLinkInvalid = "parental_consent_link_invalid";
    public const string ParentalConsentLinkExpired = "parental_consent_link_expired";
    public const string ParentalConsentAlreadyDecided = "parental_consent_already_decided";
    public const string ParentalConsentConfirmationsRequired = "parental_consent_confirmations_required";

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

    // Outfit import ("Kombinlerini içe aktar")
    public const string OutfitImportNotFound = "outfit_import_not_found";
    public const string OutfitImportTooManyPhotos = "outfit_import_too_many_photos";
    public const string OutfitImportPhotoNotFound = "outfit_import_photo_not_found";
    public const string OutfitImportNotReady = "outfit_import_not_ready";
    public const string OutfitImportCommitted = "outfit_import_committed";
    public const string OutfitImportUnknownRef = "outfit_import_unknown_ref";
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
