namespace Domain.Constant;

/// <summary>Error codes of E8 (store), E9 (social), E11 (settings), analytics and weather. Same rules as <see cref="ErrorCodes"/>.</summary>
public static class StoreSocialErrorCodes
{
    // Admin
    public const string BrandNotFound = "brand_not_found";
    public const string ProductNotFound = "product_not_found";

    // Store
    public const string ProductRetired = "product_retired";
    public const string SizeNotAvailable = "size_not_available";
    public const string CartEmpty = "cart_empty";
    public const string CartFull = "cart_full";
    public const string AffiliateLinkMissing = "affiliate_link_missing";
    public const string WatchListFull = "watch_list_full";
    public const string FavoriteListFull = "favorite_list_full";

    // Affiliate postback
    public const string InvalidSignature = "invalid_signature";
    public const string ClickNotFound = "click_not_found";

    // Social
    public const string CannotTargetSelf = "cannot_target_self";
    public const string FollowLimitReached = "follow_limit_reached";

    // Akış F2: sharing a look to the feed
    public const string EmailNotVerified = "email_not_verified";
    public const string HandleRequired = "handle_required";
    public const string LookNotShareable = "look_not_shareable";
    /// <summary>"Looklarıma ekle": the Akış post has no pieces (or no photograph / fewer than two pieces that make a look).</summary>
    public const string LookNotSavable = "look_not_savable";
    /// <summary>Admin: the shared look has no open report to remove it by.</summary>
    public const string FeedPostNotReported = "feed_post_not_reported";

    // Moderation (admin)
    public const string ReportNotResolved = "report_not_resolved";
    public const string ReportNotContentRemoved = "report_not_content_removed";

    // Contact matching (decision 13)
    public const string ContactSaltNotFound = "contact_salt_not_found";
    public const string HashesOutOfRange = "hashes_out_of_range";
    public const string HashInvalid = "hash_invalid";
    public const string InviteCodeNotFound = "invite_code_not_found";
    public const string InviteAlreadyAttributed = "invite_already_attributed";
    public const string InviteWindowClosed = "invite_window_closed";

    // Settings
    public const string DeviceLimitReached = "device_limit_reached";

    // Weather
    public const string CityNotFound = "city_not_found";
    public const string WeatherUnavailable = "weather_unavailable";
}
