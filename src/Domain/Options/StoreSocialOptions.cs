namespace Domain.Options;

/// <summary>Admins of v1/admin/* (README §9.2). Listed in config/SSM (/droblet/{stage}/api/Admin); never in code.</summary>
public sealed class AdminOptions
{
    public const string Section = "Admin";
    public const string Policy = "AdminJwt";
    public List<string> UserIds { get; set; } = [];
    /// <summary>E-mails (case-insensitive); compared with the user's stored e-mail.</summary>
    public List<string> Emails { get; set; } = [];
}

public sealed class CatalogOptions
{
    public const string Section = "Catalog";
    public int PageSize { get; set; } = 24;
    public int MaxPageSize { get; set; } = 60;
    /// <summary>The whole (small, admin-managed) catalog is cached in the Lambda for this long.</summary>
    public int CacheSeconds { get; set; } = 60;
    public int MaxCartLines { get; set; } = 100;
    public int MaxWatchItems { get; set; } = 200;
    public int MaxFavoriteProducts { get; set; } = 500;
    public int BulkUpsertMax { get; set; } = 200;
    /// <summary>
    /// Hosts a product image may be downloaded from for try-on (worker side). Empty = any https host.
    /// A sub-domain of a listed host is accepted ("cdn.example.com" matches "example.com").
    /// </summary>
    public List<string> ImageHosts { get; set; } = [];
    /// <summary>Largest product image the try-on worker downloads.</summary>
    public long MaxImageBytes { get; set; } = 10 * 1024 * 1024;
}

public sealed class SocialOptions
{
    public const string Section = "Social";
    public int MaxFollowing { get; set; } = 500;
    public int FeedPageSize { get; set; } = 20;
    public int SuggestedPageSize { get; set; } = 20;
    /// <summary>How many public profiles are scored for "closets like yours" per request.</summary>
    public int SuggestedCandidateLimit { get; set; } = 200;
    public int SearchPageSize { get; set; } = 20;
    /// <summary>Invite links: {InviteUrl}/{code} (README §9.4 domain decision).</summary>
    public string InviteUrl { get; set; } = "https://droblet.alatech.co/i";
    /// <summary>An invite can only be attributed to an account created within this many days.</summary>
    public int InviteAttributionWindowDays { get; set; } = 30;
    public int ReportsPerDay { get; set; } = 20;
    public int InviteResolvePerIpPerHour { get; set; } = 60;
}

/// <summary>Proposal (A-4 open): Open-Meteo, keyless. Owner confirms the provider and its licence terms.</summary>
public sealed class WeatherOptions
{
    public const string Section = "Weather";
    public string Provider { get; set; } = "OpenMeteo";
    public int CacheMinutes { get; set; } = 60;
    public string ForecastBaseUrl { get; set; } = "https://api.open-meteo.com";
    public string GeocodingBaseUrl { get; set; } = "https://geocoding-api.open-meteo.com";
    public int TimeoutSeconds { get; set; } = 5;
}

public sealed class NotificationOptions
{
    public const string Section = "Notifications";
    /// <summary>Proposal (A-13): 07:30 local.</summary>
    public string DefaultMorningLocal { get; set; } = "07:30";
    public string DefaultTimeZone { get; set; } = "Europe/Istanbul";
    public int MaxDevicesPerTenant { get; set; } = 10;
}

/// <summary>Shared secrets of the conversion postback endpoints (SSM SecureString /droblet/{stage}/api/AffiliatePostback).</summary>
public sealed class AffiliatePostbackOptions
{
    public const string Section = "AffiliatePostback";
    public string? NetworkSecret { get; set; }
    public string? DirectSecret { get; set; }
    /// <summary>Per-brand secret for direct deals; falls back to DirectSecret.</summary>
    public Dictionary<string, string> DirectBrandSecrets { get; set; } = [];
    public string DefaultClickIdParameter { get; set; } = "click_id";
}

/// <summary>
/// Notifier only: SSM SecureString /droblet/{stage}/notifier/Push/ServiceAccountJson = the Firebase service-account
/// JSON file as downloaded from Google (config key Push:ServiceAccountJson). Empty or the CHANGE_ME placeholder =
/// push disabled (PushResult.NotConfigured). The older section name FirebaseServiceAccount is still read.
/// </summary>
public sealed class FirebaseServiceAccountOptions
{
    public const string Section = "FirebaseServiceAccount";
    public const string JsonKey = "Push:ServiceAccountJson";
    public string? ProjectId { get; set; }
    public string? ClientEmail { get; set; }
    public string? PrivateKey { get; set; }
    public string TokenUri { get; set; } = "https://oauth2.googleapis.com/token";
    public string MessagingBaseUrl { get; set; } = "https://fcm.googleapis.com";

    public bool IsConfigured => ConfigSecret.IsSet(ProjectId) && ConfigSecret.IsSet(ClientEmail) && ConfigSecret.IsSet(PrivateKey);
}
