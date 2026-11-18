using Domain.Enum;

namespace Domain.Options;

public sealed class JwtOptions
{
    public const string Section = "Jwt";
    public string SecretKey { get; set; } = "";
    public string Issuer { get; set; } = "droblet";
    public string Audience { get; set; } = "droblet-app";
    public int ExpirationMinutes { get; set; } = 60;
    public int RefreshTokenExpirationDays { get; set; } = 60;
}

public sealed class AppleAuthOptions
{
    public const string Section = "AppleAuth";
    public const string Issuer = "https://appleid.apple.com";
    public string MetadataAddress { get; set; } = "https://appleid.apple.com/.well-known/openid-configuration";
    /// <summary>iOS bundle id (A-10: com.alatech.droplet) — the identityToken "aud".</summary>
    public string BundleId { get; set; } = "";
    /// <summary>Extra accepted audiences (e.g. a Services ID for web sign-in).</summary>
    public List<string> AdditionalAudiences { get; set; } = [];
    public string? TeamId { get; set; }
    public string? KeyId { get; set; }
    public string? PrivateKey { get; set; }

    /// <summary>False while the SSM parameter still holds the CHANGE_ME placeholder (ConfigSecret).</summary>
    public bool HasPrivateKey => ConfigSecret.IsSet(PrivateKey);

    public IReadOnlyList<string> Audiences() =>
        new[] { BundleId }.Concat(AdditionalAudiences).Where(a => !string.IsNullOrWhiteSpace(a)).Distinct().ToList();
}

public sealed class GoogleAuthOptions
{
    public const string Section = "GoogleAuth";
    public static readonly string[] Issuers = ["https://accounts.google.com", "accounts.google.com"];
    public string MetadataAddress { get; set; } = "https://accounts.google.com/.well-known/openid-configuration";
    /// <summary>OAuth client ids (iOS, Android, web) that may appear as the idToken "aud".</summary>
    public List<string> ClientIds { get; set; } = [];
    public string? ClientId { get; set; }
    public string? ClientSecret { get; set; }
    public string? RedirectUri { get; set; }
    /// <summary>Android package (A-10: com.alatech.droplet) — informational; Google signs aud with the client id.</summary>
    public string? AndroidPackage { get; set; }

    public IReadOnlyList<string> Audiences() =>
        ClientIds.Append(ClientId ?? "").Where(a => !string.IsNullOrWhiteSpace(a)).Distinct().ToList();
}

public sealed class EmailOptions
{
    public const string Section = "Email";
    /// <summary>SendGrid (default) or Smtp.</summary>
    public string Provider { get; set; } = "SendGrid";
    public string From { get; set; } = "";
    public SendGridOptions SendGrid { get; set; } = new();
    public SmtpOptions Smtp { get; set; } = new();

    public sealed class SendGridOptions
    {
        public string? ApiKey { get; set; }
        /// <summary>https://api.eu.sendgrid.com for an EU-pinned subuser.</summary>
        public string BaseUrl { get; set; } = "https://api.sendgrid.com";
    }

    public sealed class SmtpOptions
    {
        public string? Host { get; set; }
        public int Port { get; set; } = 587;
        public string? Username { get; set; }
        public string? Password { get; set; }
    }
}

/// <summary>App identifiers and deep links (A-10 closed 2026-11-18). Values live in config/SSM.</summary>
public sealed class AppLinksOptions
{
    public const string Section = "App";
    public string PasswordResetUrl { get; set; } = "";
    public string Scheme { get; set; } = "";
    public string BundleId { get; set; } = "";
}

public sealed class EntitlementOptions
{
    public const string Section = "Entitlements";
    public PremiumLimits Premium { get; set; } = new();

    public sealed class PremiumLimits
    {
        /// <summary>Brief §5.2: 30 AI images per subscription month. Config so it can change without a deploy.</summary>
        public int TryOnCreditsPerMonth { get; set; }
    }
}

public sealed class StoreOptions
{
    public const string Section = "Store";
    public StoreProductIds ProductIds { get; set; } = new();
    /// <summary>Consumable product id -> number of try-on credits it adds.</summary>
    public Dictionary<string, int> CreditPacks { get; set; } = [];
    public string? NotificationKey { get; set; }

    /// <summary>False while the SSM parameter still holds the CHANGE_ME placeholder (ConfigSecret).</summary>
    public bool HasNotificationKey => ConfigSecret.IsSet(NotificationKey);

    public sealed class StoreProductIds
    {
        public List<string> Premium { get; set; } = [];
    }
}

public sealed class PhotoOptions
{
    public const string Section = "Photos";
    public string Bucket { get; set; } = "";
    public int UploadUrlTtlSeconds { get; set; } = 300;
    public int ReadUrlTtlSeconds { get; set; } = 300;
    public long MaxUploadBytes { get; set; } = 10 * 1024 * 1024;
    public List<string> AllowedContentTypes { get; set; } = ["image/jpeg", "image/png"];
}

public sealed class QueueOptions
{
    public const string Section = "Queues";
    public string? ItemProcessRequest { get; set; }
    public string? StylistRequest { get; set; }
    public string? TryOnRequest { get; set; }
    public string? PaletteRequest { get; set; }

    public string? UrlFor(JobKind kind) => kind switch
    {
        JobKind.ItemProcess or JobKind.ItemSplit => ItemProcessRequest,
        JobKind.TryOn => TryOnRequest,
        JobKind.Palette => PaletteRequest,
        _ => StylistRequest,
    };
}

/// <summary>Worker AI config (/droblet/{stage}/worker/Ai). Provider + model ids are owner decisions, never hard-coded.</summary>
public sealed class AiOptions
{
    public const string Section = "Ai";
    public bool Enabled { get; set; }
    public string? Provider { get; set; }
    public string? TextModel { get; set; }
    public string? ImageModel { get; set; }
    /// <summary>
    /// SSM SecureString /droblet/{stage}/worker/Ai/ApiKey — a plain string parameter nested under the worker/Ai JSON
    /// (Enabled, Provider, TextModel, ImageModel), so both bind to this section. Never logged. Workers only: the Api
    /// Lambda reads /droblet/{stage}/api and never sees it.
    /// </summary>
    public string? ApiKey { get; set; }

    /// <summary>False while the key is empty or still the CHANGE_ME placeholder (ConfigSecret).</summary>
    public bool HasApiKey => ConfigSecret.IsSet(ApiKey);
    public string BaseUrl { get; set; } = "https://api.openai.com";
    public string ImageSize { get; set; } = "1024x1536";
    public int TimeoutSeconds { get; set; } = 100;
    /// <summary>Below this per-field confidence a draft field is flagged ("Kategoriyi kontrol et").</summary>
    public double VisionConfidenceThreshold { get; set; } = 0.7;
    public double PaletteConfidenceThreshold { get; set; } = 0.6;
}

public sealed class AuthRateLimitOptions
{
    public const string Section = "AuthRateLimits";
    public int LoginPerEmailPer15Minutes { get; set; } = 10;
    public int LoginPerIpPer15Minutes { get; set; } = 50;
    public int RegisterPerIpPerHour { get; set; } = 20;
    public int ForgotPerEmailPerHour { get; set; } = 3;
}

public sealed class AffiliateOptions
{
    public const string Section = "Affiliate";
    public int DefaultCommissionRateBps { get; set; }
    public Dictionary<string, BrandAffiliateOptions> Brands { get; set; } = [];

    public sealed class BrandAffiliateOptions
    {
        public AffiliateSource Source { get; set; }
        public string? Network { get; set; }
        public int CommissionRateBps { get; set; }
    }
}
