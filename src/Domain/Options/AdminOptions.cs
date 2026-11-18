namespace Domain.Options;

/// <summary>
/// Admin panel tokens (SSM SecureString /droblet/{stage}/api/AdminJwt, created by deploy-infra). A separate key,
/// issuer and audience from the app tokens (Jwt): an app token never validates on an admin route and vice versa.
/// </summary>
public sealed class AdminJwtOptions
{
    public const string Section = "AdminJwt";
    public string SecretKey { get; set; } = "";
    public string Issuer { get; set; } = "droblet-admin";
    public string Audience { get; set; } = "droblet-admin-panel";
    public int AccessTokenMinutes { get; set; } = 15;
    public int RefreshTokenHours { get; set; } = 12;
}

/// <summary>Admin sign-in and panel settings (SSM String /droblet/{stage}/api/AdminAuth).</summary>
public sealed class AdminAuthOptions
{
    public const string Section = "AdminAuth";
    /// <summary>Base of the set / reset password link ({PanelUrl}/reset-password?token=…).</summary>
    public string PanelUrl { get; set; } = "https://droblet-admin.alatech.co";
    /// <summary>Origins that get CORS headers on v1/admin/* (nothing else does). Empty = the origin of PanelUrl.</summary>
    public List<string> AllowedOrigins { get; set; } = [];
    /// <summary>Created once as a super admin without a password (set through the forgot-password e-mail). Empty = no bootstrap.</summary>
    public string BootstrapSuperAdminEmail { get; set; } = "";
    public int CodeTtlMinutes { get; set; } = 10;
    public int CodeMaxAttempts { get; set; } = 5;
    public int LoginPerEmailPer15Minutes { get; set; } = 10;
    public int LoginPerIpPer15Minutes { get; set; } = 50;
    public int VerifyPerIpPer15Minutes { get; set; } = 50;
    public int ForgotPerEmailPerHour { get; set; } = 3;
    /// <summary>Every admin route, per admin (or per IP before sign-in).</summary>
    public int RequestsPerMinute { get; set; } = 600;
    public int ResetLinkMinutes { get; set; } = 30;
    public int InviteLinkHours { get; set; } = 72;
}

/// <summary>
/// Public catalog image bucket (product, brand, edit, collection and library images uploaded from the panel).
/// Env CATALOG_IMAGE_BUCKET / CATALOG_IMAGE_BASE_URL. Not user data: objects are publicly readable over https so the
/// app and the try-on worker can fetch them.
/// </summary>
public sealed class CatalogImageOptions
{
    public const string Section = "CatalogImages";
    public string Bucket { get; set; } = "";
    /// <summary>https base URL of the objects (e.g. https://droblet-dev-catalog-images.s3.eu-central-1.amazonaws.com).</summary>
    public string PublicBaseUrl { get; set; } = "";
    public long MaxUploadBytes { get; set; } = 5 * 1024 * 1024;
    public int UploadUrlTtlSeconds { get; set; } = 300;
    public List<string> AllowedContentTypes { get; set; } = ["image/jpeg", "image/png", "image/webp"];

    /// <summary>Host of <see cref="PublicBaseUrl"/>, or null when not configured.</summary>
    public string? PublicHost =>
        Uri.TryCreate(PublicBaseUrl, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps ? uri.Host : null;
}
