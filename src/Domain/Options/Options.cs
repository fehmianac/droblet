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
    /// <summary>Apple developer team (4LB4RD97A9): "iss" of the client secret used for token exchange / revocation.</summary>
    public string? TeamId { get; set; }
    /// <summary>Key id of the Sign in with Apple .p8 key (SSM api/AppleAuth/KeyId).</summary>
    public string? KeyId { get; set; }
    /// <summary>The .p8 key itself (SSM SecureString api/AppleAuth/PrivateKey).</summary>
    public string? PrivateKey { get; set; }
    /// <summary>"client_id" of the token / revoke calls; the bundle id for native sign-in.</summary>
    public string? ClientId { get; set; }
    /// <summary>AES-256 key (base64, SSM SecureString api/AppleAuth/TokenEncryptionKey) for the stored Apple refresh token.
    /// Unset → a key derived from Jwt:SecretKey is used.</summary>
    public string? TokenEncryptionKey { get; set; }
    public string TokenUrl { get; set; } = "https://appleid.apple.com/auth/token";
    public string RevokeUrl { get; set; } = "https://appleid.apple.com/auth/revoke";

    /// <summary>False while the SSM parameter still holds the CHANGE_ME placeholder (ConfigSecret).</summary>
    public bool HasPrivateKey => ConfigSecret.IsSet(PrivateKey);

    /// <summary>Token exchange / revocation need the team id, key id and .p8 key (App Store requirement on account deletion).</summary>
    public bool CanRevokeTokens => HasPrivateKey && ConfigSecret.IsSet(KeyId) && ConfigSecret.IsSet(TeamId) && !string.IsNullOrWhiteSpace(EffectiveClientId);

    public string EffectiveClientId => string.IsNullOrWhiteSpace(ClientId) ? BundleId : ClientId;

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
    /// <summary>Verification e-mail link (web fallback page that opens the app). Default: the site's /verify-email.</summary>
    public string EmailVerificationUrl { get; set; } = "https://droblet.alatech.co/verify-email/";
    public string Scheme { get; set; } = "";
    public string BundleId { get; set; } = "";
}

public sealed class EntitlementOptions
{
    public const string Section = "Entitlements";
    public PremiumLimits Premium { get; set; } = new();
    public FreeLimits Free { get; set; } = new();
    public SelfServePremiumOptions SelfServePremium { get; set; } = new();

    /// <summary>
    /// Owner decision 2026-11-19: until store purchases are live, a user may make their own account premium from Ayarlar
    /// (POST / DELETE v1/tenant/entitlement/self-premium). Central off switch: template true on dev, false on prod; the
    /// super admin can flip it in the panel (Settings → Üyelik sınırları). Off = 403 self_premium_disabled.
    /// </summary>
    public sealed class SelfServePremiumOptions
    {
        public bool Enabled { get; set; }
    }

    public sealed class FreeLimits
    {
        /// <summary>
        /// Owner decision 2026-11-18: AI garment recognitions a non-member gets, once, for the lifetime of the account
        /// (each photo of a single / bulk / split request = 1). 0 = the feature is members-only (straight to the paywall).
        /// Members are unlimited. Representative default; lives in SSM api/Entitlements and worker/Entitlements.
        /// </summary>
        public int ItemRecognitionLimit { get; set; } = 10;

        /// <summary>Owner decision 2026-11-19: photos per "Kombinlerini içe aktar" session for a non-member (default 30).</summary>
        public int OutfitImportMaxPhotos { get; set; } = DefaultOutfitImportMaxPhotos;
    }

    public sealed class PremiumLimits
    {
        /// <summary>Brief §5.2: 30 AI images per subscription month. Config so it can change without a deploy.</summary>
        public int TryOnCreditsPerMonth { get; set; }

        /// <summary>Owner decision 2026-11-19: photos per "Kombinlerini içe aktar" session for a member (default 30).</summary>
        public int OutfitImportMaxPhotos { get; set; } = DefaultOutfitImportMaxPhotos;
    }

    /// <summary>Default photos per outfit import session (both plans) when the parameter does not set it.</summary>
    public const int DefaultOutfitImportMaxPhotos = 30;
}

public sealed class StoreOptions
{
    public const string Section = "Store";
    public StoreProductIds ProductIds { get; set; } = new();
    /// <summary>Consumable product id -> number of try-on credits it adds.</summary>
    public Dictionary<string, int> CreditPacks { get; set; } = [];
    public string? NotificationKey { get; set; }

    /// <summary>iOS bundle id every StoreKit 2 transaction / notification must carry.</summary>
    public string BundleId { get; set; } = "com.alatech.droplet";
    /// <summary>Android package of every Play purchase / RTDN.</summary>
    public string AndroidPackage { get; set; } = "com.alatech.droplet";
    /// <summary>App Store app id (appAppleId); when set, production notifications must carry it.</summary>
    public long? AppAppleId { get; set; }
    /// <summary>Sandbox transactions (TestFlight, App Review, sandbox testers) are accepted — Apple's review uses them on production.</summary>
    public bool AcceptSandbox { get; set; } = true;
    /// <summary>
    /// Optional: base64 DER of the "StoreKit Testing in Xcode" root (Xcode → Editor → Save Public Certificate). Only a
    /// transaction whose environment is "Xcode" may chain to it; leave empty on prod.
    /// </summary>
    public string? XcodeTestRootCertificate { get; set; }

    /// <summary>App Store Server API key id (SSM api/Store/IapKeyId).</summary>
    public string? IapKeyId { get; set; }
    /// <summary>App Store Connect issuer id (SSM api/Store/IssuerId).</summary>
    public string? IssuerId { get; set; }
    /// <summary>In-App Purchase .p8 key (SSM SecureString api/Store/IapPrivateKey).</summary>
    public string? IapPrivateKey { get; set; }
    public string AppStoreServerApiUrl { get; set; } = "https://api.storekit.itunes.apple.com";
    public string AppStoreServerApiSandboxUrl { get; set; } = "https://api.storekit-sandbox.itunes.apple.com";

    /// <summary>Bound from SSM SecureString api/Store/GooglePlayServiceAccountJson (Google's key file) by GoogleServiceAccountBinder.</summary>
    public GoogleServiceAccount GooglePlay { get; set; } = new();
    public string GooglePlayApiUrl { get; set; } = "https://androidpublisher.googleapis.com";
    /// <summary>Audience the Pub/Sub push subscription puts into its OIDC token (SSM api/Store/GooglePubSubAudience).</summary>
    public string? GooglePubSubAudience { get; set; }
    /// <summary>Service account the push subscription authenticates as (SSM api/Store/GooglePubSubServiceAccount).</summary>
    public string? GooglePubSubServiceAccount { get; set; }

    /// <summary>False while the SSM parameter still holds the CHANGE_ME placeholder (ConfigSecret).</summary>
    public bool HasNotificationKey => ConfigSecret.IsSet(NotificationKey);
    public bool HasAppStoreServerApi => ConfigSecret.IsSet(IapKeyId) && ConfigSecret.IsSet(IssuerId) && ConfigSecret.IsSet(IapPrivateKey);
    public bool HasGooglePlayApi => GooglePlay.IsConfigured;
    public bool HasGooglePubSubVerification => ConfigSecret.IsSet(GooglePubSubAudience) && ConfigSecret.IsSet(GooglePubSubServiceAccount);

    public sealed class StoreProductIds
    {
        public List<string> Premium { get; set; } = [];
    }
}

/// <summary>A Google service-account key file (snake_case in the JSON). Empty / CHANGE_ME = not configured.</summary>
public sealed class GoogleServiceAccount
{
    public string? ClientEmail { get; set; }
    public string? PrivateKey { get; set; }
    public string TokenUri { get; set; } = "https://oauth2.googleapis.com/token";

    public bool IsConfigured => ConfigSecret.IsSet(ClientEmail) && ConfigSecret.IsSet(PrivateKey);
}

public sealed class PhotoOptions
{
    public const string Section = "Photos";
    public string Bucket { get; set; } = "";
    public int UploadUrlTtlSeconds { get; set; } = 300;
    public int ReadUrlTtlSeconds { get; set; } = 300;
    public long MaxUploadBytes { get; set; } = 10 * 1024 * 1024;
    public List<string> AllowedContentTypes { get; set; } = ["image/jpeg", "image/png"];
    /// <summary>Profile picture: the app resizes to 512 px before upload; the server enforces size and dimensions (no resampling).</summary>
    public long AvatarMaxUploadBytes { get; set; } = 1024 * 1024;
    public int AvatarMaxDimension { get; set; } = 1024;
    /// <summary>Lifetime of the presigned avatar GET returned with a profile.</summary>
    public int AvatarReadUrlTtlSeconds { get; set; } = 3600;
}

public sealed class QueueOptions
{
    public const string Section = "Queues";
    public string? ItemProcessRequest { get; set; }
    public string? StylistRequest { get; set; }
    public string? TryOnRequest { get; set; }
    public string? PaletteRequest { get; set; }
    public string? DataExportRequest { get; set; }
    public string? OutfitImportRequest { get; set; }

    public string? UrlFor(JobKind kind) => kind switch
    {
        JobKind.ItemProcess or JobKind.ItemSplit or JobKind.ItemClean => ItemProcessRequest,
        JobKind.OutfitImport => OutfitImportRequest,
        JobKind.TryOn => TryOnRequest,
        JobKind.Palette => PaletteRequest,
        JobKind.DataExport => DataExportRequest,
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

    // ── Latency tuning (all optional; unset = the request is sent exactly as before) ─────────────────────────────

    /// <summary>
    /// Optional faster text model (Ai:FastTextModel) for the light operations named in <see cref="FastTextOperations"/>.
    /// Unset = every call uses <see cref="TextModel"/>.
    /// </summary>
    public string? FastTextModel { get; set; }

    /// <summary>Comma-separated operations (schema names, see AiSchemas) that use <see cref="FastTextModel"/> when it is set.</summary>
    public string FastTextOperations { get; set; } = "photo_check";

    /// <summary>
    /// reasoning_effort per operation (Ai:ReasoningEffort:{operation}, e.g. outfit, week_plan, packing, item_detection,
    /// garment_draft, palette_season, photo_check) with Ai:ReasoningEffort:Default as the fallback. Not sent when unset.
    /// </summary>
    public Dictionary<string, string> ReasoningEffort { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>OpenAI service_tier (e.g. "priority" for faster, more expensive processing). Not sent when unset.</summary>
    public string? ServiceTier { get; set; }

    /// <summary>Send prompt_cache_key = the operation, so requests sharing the static prefix land on the same cache.</summary>
    public bool PromptCacheKey { get; set; }

    /// <summary>Prompt overrides from the admin panel (Ai:Prompts:*): cache and runtime safety.</summary>
    public AiPromptOptions Prompts { get; set; } = new();

    /// <summary>
    /// Item photo: start the background removal of the whole photo together with the vision call; used when the photo
    /// holds one piece that is not small, cancelled otherwise (one wasted image call on multi-piece photos).
    /// </summary>
    public bool SpeculativeItemCleanup { get; set; }

    /// <summary>Image output per use (Ai:Image:*).</summary>
    public AiImageOptions Image { get; set; } = new();

    /// <summary>
    /// Compact stylist prompt (CandidateAliases): short candidate aliases and one descriptor string per piece, null fields
    /// left out — fewer input and output tokens for the same decision (outfit, week plan, suitcase). Off = the original prompt.
    /// </summary>
    public bool CompactStylistPrompt { get; set; }

    /// <summary>
    /// Price list for cost accounting (Ai:Pricing:*, SSM worker/Ai/Pricing). Never changes a request: it only turns the
    /// usage the API reports into an estimated cost per call (job aiCost, log line, EMF CostMicroUsd). Empty = no estimate.
    /// </summary>
    public AiPricingOptions Pricing { get; set; } = new();

    // ── Cost tuning (all optional; unset = the request is sent exactly as before) ────────────────────────────────

    /// <summary>
    /// Vision detail per operation (Ai:VisionDetail:{operation} = low | high | auto), e.g. photo_check = low. Unset = the
    /// code's own choice (item_detection high, the rest the API default).
    /// </summary>
    public Dictionary<string, string> VisionDetail { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// max_completion_tokens per operation (Ai:MaxOutputTokens:{operation}, Default as the fallback): a ceiling against
    /// runaway answers. Reasoning tokens count against it, so it must stay well above a normal answer. Unset = not sent.
    /// </summary>
    public Dictionary<string, int> MaxOutputTokens { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// service_tier per operation or per background flow (Ai:ServiceTiers:{operation | flow}, e.g. outfit_import = flex: every
    /// text call of an outfit import photo), overriding <see cref="ServiceTier"/>. Flex is half price but slower and may
    /// answer 429 (resource unavailable) — the import's rate-limit back-off retries it.
    /// </summary>
    public Dictionary<string, string> ServiceTiers { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    /// <param name="context">The flow the call runs in (AiCallContext, e.g. "outfit_import"): its entry wins over the operation's.</param>
    public string? TierFor(string operation, string? context = null) =>
        context is not null && ServiceTiers.TryGetValue(context, out var flowTier) && !string.IsNullOrWhiteSpace(flowTier) ? flowTier.Trim()
        : ServiceTiers.TryGetValue(operation, out var tier) && !string.IsNullOrWhiteSpace(tier) ? tier.Trim()
        : string.IsNullOrWhiteSpace(ServiceTier) ? null : ServiceTier.Trim();

    public string? DetailFor(string operation, string? codeDefault) =>
        VisionDetail.TryGetValue(operation, out var detail) && detail is "low" or "high" or "auto" ? detail : codeDefault;

    public int? MaxOutputTokensFor(string operation) =>
        MaxOutputTokens.TryGetValue(operation, out var max) && max > 0 ? max
        : MaxOutputTokens.TryGetValue("Default", out var fallback) && fallback > 0 ? fallback
        : null;

    public string ModelFor(string operation) =>
        !string.IsNullOrWhiteSpace(FastTextModel)
        && FastTextOperations.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Contains(operation, StringComparer.OrdinalIgnoreCase)
            ? FastTextModel!
            : TextModel ?? "";

    public string? EffortFor(string operation) =>
        ReasoningEffort.TryGetValue(operation, out var effort) && !string.IsNullOrWhiteSpace(effort) ? effort
        : ReasoningEffort.TryGetValue("Default", out var fallback) && !string.IsNullOrWhiteSpace(fallback) ? fallback
        : null;

    /// <summary>Size and quality of one image edit. Quality null = not sent (the provider's default, "auto").</summary>
    public (string Size, string? Quality) ImageFor(ImageUse use, string? qualityOverride = null)
    {
        var (size, quality) = use switch
        {
            ImageUse.TryOn => (Image.TryOnSize, Image.TryOnQuality),
            ImageUse.Cleanup => (Image.CleanupSize, Image.CleanupQuality),
            _ => (null, null),
        };
        return (Blank(size) ?? Blank(Image.Size) ?? ImageSize, Blank(qualityOverride) ?? Blank(quality) ?? Blank(Image.Quality));
    }

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}

public enum ImageUse { TryOn, Cleanup }

/// <summary>
/// Ai:Pricing — USD per 1M tokens per model id (OpenAI's published standard rates), a multiplier per service tier, and
/// a fallback per image when an image response carries no usage. A model id matches its own entry or the longest
/// entry it starts with (dated snapshots: gpt-6-astra-2026-09-08 → gpt-6-astra).
/// </summary>
public sealed class AiPricingOptions
{
    public Dictionary<string, AiModelPrice> Models { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Price multiplier per service_tier (flex 0.5, batch 0.5, priority/fast 2). Missing tier = 1.</summary>
    public Dictionary<string, decimal> TierMultipliers { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>USD per image by "{quality}/{size}" (e.g. "low/1024x1024"), used only when the response has no usage.</summary>
    public Dictionary<string, decimal> ImageFallback { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Exchange rate for reports only (₺ per $).</summary>
    public decimal UsdTry { get; set; }

    public AiModelPrice? For(string? model)
    {
        if (string.IsNullOrWhiteSpace(model))
            return null;
        if (Models.TryGetValue(model, out var exact))
            return exact;
        return Models.Where(kv => model.StartsWith(kv.Key + "-", StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(kv => kv.Key.Length).Select(kv => kv.Value).FirstOrDefault();
    }

    public decimal MultiplierFor(string? tier) =>
        tier is { Length: > 0 } && TierMultipliers.TryGetValue(tier, out var m) && m > 0 ? m : 1m;
}

/// <summary>USD per 1M tokens. Text models: Input / CachedInput / Output. Image models also bill image tokens separately.</summary>
public sealed class AiModelPrice
{
    public decimal Input { get; set; }
    public decimal CachedInput { get; set; }
    public decimal Output { get; set; }
    /// <summary>Image models: image input tokens (the photos sent to an edit).</summary>
    public decimal ImageInput { get; set; }
    public decimal ImageCachedInput { get; set; }
    /// <summary>Image models: image output tokens (the generated image).</summary>
    public decimal ImageOutput { get; set; }
    /// <summary>Where the price comes from, or "assumption: …" when it could not be confirmed.</summary>
    public string? Source { get; set; }
}

public sealed class AiImageOptions
{
    /// <summary>Default quality of every image edit (low | medium | high | auto). Unset = not sent.</summary>
    public string? Quality { get; set; }
    /// <summary>Default size of every image edit. Unset = Ai:ImageSize.</summary>
    public string? Size { get; set; }
    public string? TryOnQuality { get; set; }
    public string? TryOnSize { get; set; }
    public string? CleanupQuality { get; set; }
    public string? CleanupSize { get; set; }
    /// <summary>input_fidelity of the try-on edit (high keeps the face closer, low is faster). Unset = not sent.</summary>
    public string? TryOnInputFidelity { get; set; }
    /// <summary>
    /// Try-on preview: the job completes with a fast image at <see cref="PreviewQuality"/>, then the same worker renders
    /// the full-quality image and replaces it (one more image call per try-on). Off by default.
    /// </summary>
    public bool TryOnPreview { get; set; }
    public string PreviewQuality { get; set; } = "low";
}

/// <summary>
/// Admin prompt overrides (Ai:Prompts). A Lambda re-reads the published overrides at most every CacheSeconds, so a
/// publish applies within about a minute. A published override whose answers fail FailureThreshold times within
/// FailureWindowMinutes (invalid JSON / DTO, refusal, cut off) is switched back to the previous version automatically.
/// </summary>
public sealed class AiPromptOptions
{
    /// <summary>False = every prompt is the code default (overrides are ignored, nothing is read).</summary>
    public bool Enabled { get; set; } = true;
    public int CacheSeconds { get; set; } = 60;
    /// <summary>0 = no automatic fallback.</summary>
    public int FailureThreshold { get; set; } = 5;
    public int FailureWindowMinutes { get; set; } = 10;
}

/// <summary>
/// "Kombinlerini içe aktar" processing (/droblet/{stage}/{api|worker}/OutfitImport; every value has a code default, so the
/// parameter is optional). The photo limit per session is a plan limit and lives in Entitlements (OutfitImportMaxPhotos).
/// </summary>
public sealed class OutfitImportOptions
{
    public const string Section = "OutfitImport";

    /// <summary>Photos of one tenant processed at the same time (all sessions); the rest wait in the queue (fairness).</summary>
    public int MaxInFlightPerTenant { get; set; } = 3;
    /// <summary>A lease not released within this time (a crashed run) no longer counts.</summary>
    public int LeaseSeconds { get; set; } = 150;
    /// <summary>Delay of a photo put back on the queue because its tenant is at the cap or the session's match step is busy.</summary>
    public int BusyDelaySeconds { get; set; } = 8;
    /// <summary>OpenAI rate limit (429, not billing): first back-off delay, doubled per attempt up to MaxBackoffSeconds.</summary>
    public int BackoffBaseSeconds { get; set; } = 20;
    public int MaxBackoffSeconds { get; set; } = 600;
    /// <summary>Rate-limit back-offs of one photo before it fails (its recognition is given back).</summary>
    public int MaxBackoffs { get; set; } = 6;
    /// <summary>Wardrobe / session thumbnails one match call compares a piece with (K).</summary>
    public int MatchCandidates { get; set; } = 6;
    /// <summary>Below this the match answer is treated as "new piece".</summary>
    public double MatchConfidenceThreshold { get; set; } = 0.75;
    /// <summary>Long side of a thumbnail sent to the match call (px).</summary>
    public int ThumbnailEdge { get; set; } = 512;
    /// <summary>Lifetime of an upload slot (presigned POST). The app uploads in the background, so longer than single uploads.</summary>
    public int UploadUrlTtlSeconds { get; set; } = 900;
    /// <summary>Use Ai:FastTextModel (when set) for the detection and match calls of an import.</summary>
    public bool UseFastTextModel { get; set; } = true;
}

/// <summary>
/// Guardrails for AI work that costs no credit (SSM api/AiLimits; 0 = no cap, the default). Counted per tenant on the
/// Api when a job starts (a replay of the same requestId is not counted again); over the cap → 429 ai_limit_reached.
/// </summary>
public sealed class AiLimitsOptions
{
    public const string Section = "AiLimits";
    /// <summary>Outfit, week plan and suitcase jobs together, per UTC day.</summary>
    public int StylistJobsPerDay { get; set; }
    /// <summary>AI garment recognitions (each photo of a single / bulk / split request or an outfit import), per UTC day.</summary>
    public int ItemRecognitionsPerDay { get; set; }
    /// <summary>Palette analyses per UTC day (a face photo already analysed is answered from the cache and not counted).</summary>
    public int PaletteAnalysesPerDay { get; set; }
    /// <summary>Any AI job start per minute (scripted abuse, a stuck retry loop in a client).</summary>
    public int AiStartsPerMinute { get; set; }
}

/// <summary>
/// Admin AI cost board (SSM api/AiUsage; docs/ai-cost.md §7). Money figures are configuration, not code: the USD/TRY rate
/// for ₺ columns, the net monthly revenue per plan (incl. VAT and store fee taken off), and the anomaly thresholds.
/// </summary>
public sealed class AiUsageOptions
{
    public const string Section = "AiUsage";
    /// <summary>₺ per $ for the panel's ₺ columns (an assumption, docs/ai-cost.md).</summary>
    public decimal UsdTryRate { get; set; } = 43m;
    /// <summary>Net ₺ per month of the monthly plan (₺199.99 − 20% VAT − 15% store fee).</summary>
    public decimal NetMonthlyPlanTry { get; set; } = 141.66m;
    /// <summary>Net ₺ per month of the yearly plan (₺1,499.99 / 12, same deductions).</summary>
    public decimal NetYearlyPlanPerMonthTry { get; set; } = 88.54m;
    /// <summary>A user's day is an anomaly above this multiple of the median of their previous 30 days with usage…</summary>
    public decimal AnomalyMedianMultiplier { get; set; } = 5m;
    /// <summary>…(only with at least this many such days, and only when the day costs at least AnomalyMinDayUsd)…</summary>
    public int AnomalyMinHistoryDays { get; set; } = 3;
    public decimal AnomalyMinDayUsd { get; set; } = 0.10m;
    /// <summary>…or above this absolute daily cost in USD, whatever the history.</summary>
    public decimal AnomalyAbsoluteDayUsd { get; set; } = 2m;
    /// <summary>Rows of the top-users table.</summary>
    public int TopUsers { get; set; } = 20;
    /// <summary>Longest range one summary or user view may ask for (each day is one Query).</summary>
    public int MaxRangeDays { get; set; } = 92;
}

public sealed class AuthRateLimitOptions
{
    public const string Section = "AuthRateLimits";
    public int LoginPerEmailPer15Minutes { get; set; } = 10;
    public int LoginPerIpPer15Minutes { get; set; } = 50;
    public int RegisterPerIpPerHour { get; set; } = 20;
    public int ForgotPerEmailPerHour { get; set; } = 3;
    /// <summary>Verification e-mails a user may ask for per day (plus one per minute, the app's countdown).</summary>
    public int VerifyResendPerUserPerDay { get; set; } = 5;
    /// <summary>Code entries per user per hour, across codes (each code also allows only 5 wrong tries).</summary>
    public int VerifyCodePerUserPerHour { get; set; } = 20;
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
