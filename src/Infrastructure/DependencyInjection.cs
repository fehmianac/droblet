using Amazon.DynamoDBv2;
using Amazon.S3;
using Amazon.SQS;
using Domain.Context;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Domain.Services.Ai;
using Infrastructure.Ai;
using Infrastructure.Context;
using Infrastructure.Manager;
using Infrastructure.Services;
using Infrastructure.Services.Providers;
using Infrastructure.Services.Purchases;
using Infrastructure.Storage;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace Infrastructure;

public static class DependencyInjection
{
    /// <summary>Shared by Api, workers and Notifier. AWS clients are created lazily (tests replace the abstractions).</summary>
    public static IServiceCollection AddDrobletCore(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<EntitlementOptions>(configuration.GetSection(EntitlementOptions.Section));
        services.Configure<PhotoOptions>(configuration.GetSection(PhotoOptions.Section));
        services.Configure<QueueOptions>(configuration.GetSection(QueueOptions.Section));
        services.Configure<StoreOptions>(configuration.GetSection(StoreOptions.Section));
        services.Configure<AiOptions>(configuration.GetSection(AiOptions.Section));
        services.Configure<AffiliateOptions>(configuration.GetSection(AffiliateOptions.Section));
        services.Configure<CatalogImageOptions>(configuration.GetSection(CatalogImageOptions.Section));
        services.Configure<ConsentOptions>(configuration.GetSection(ConsentOptions.Section));
        // Secrets created by deploy-infra hold the literal CHANGE_ME until the owner fills them in: bind that as "not set".
        services.PostConfigure<AiOptions>(o => o.ApiKey = ConfigSecret.OrNull(o.ApiKey));
        services.PostConfigure<StoreOptions>(o =>
        {
            o.NotificationKey = ConfigSecret.OrNull(o.NotificationKey);
            o.IapKeyId = ConfigSecret.OrNull(o.IapKeyId);
            o.IssuerId = ConfigSecret.OrNull(o.IssuerId);
            o.IapPrivateKey = ConfigSecret.OrNull(o.IapPrivateKey);
            o.GooglePubSubAudience = ConfigSecret.OrNull(o.GooglePubSubAudience);
            o.GooglePubSubServiceAccount = ConfigSecret.OrNull(o.GooglePubSubServiceAccount);
            o.XcodeTestRootCertificate = ConfigSecret.OrNull(o.XcodeTestRootCertificate);
            Infrastructure.Services.Purchases.GoogleServiceAccountBinder.Bind(configuration, o.GooglePlay);
        });

        services.AddSingleton(TimeProvider.System);

        services.AddSingleton<IAmazonDynamoDB>(_ => new AmazonDynamoDBClient());
        services.AddSingleton<IAmazonS3>(_ => new AmazonS3Client());
        services.AddSingleton<IAmazonSQS>(_ => new AmazonSQSClient());

        services.AddSingleton<IRepository, Repository>();
        services.AddSingleton<IObjectStorage, S3ObjectStorage>();
        services.AddSingleton<IEventManager, EventManager>();
        services.AddSingleton<IEntitlementService, EntitlementService>();
        services.AddSingleton<ICreditService, CreditService>();
        services.AddSingleton<IItemRecognitionQuotaService, ItemRecognitionQuotaService>();
        services.AddSingleton<IJobLifecycle, JobLifecycle>();
        services.AddSingleton<IJobEtaProvider, JobEtaProvider>();
        services.AddSingleton<IConsentService, ConsentService>();
        services.AddSingleton<IAvatarService, AvatarService>();
        services.AddDrobletWardrobe(configuration);
        services.AddDrobletStoreSocialCore(configuration);
        // Catalog:ImageHosts restricts where product images may be downloaded from; images uploaded through the admin
        // panel live on the catalog image bucket, so its host is always allowed (an empty list already allows any host).
        services.AddOptions<CatalogOptions>().PostConfigure<IOptionsMonitor<CatalogImageOptions>>((catalog, images) =>
        {
            if (catalog.ImageHosts.Count > 0 && images.CurrentValue.PublicHost is { } host
                && !catalog.ImageHosts.Contains(host, StringComparer.OrdinalIgnoreCase))
                catalog.ImageHosts.Add(host);
        });
        return services;
    }

    public static IServiceCollection AddDrobletAi(this IServiceCollection services)
    {
        // OpenAI over plain HTTP. With Ai:Enabled = false (default) or a missing key / model id every call throws
        // AiProviderException, so jobs fail with ProviderError and credits are refunded — same as before.
        services.AddSingleton(sp => new OpenAiProvider(
            new HttpClient(OpenAiProvider.CreateHandler()) { Timeout = Timeout.InfiniteTimeSpan },
            sp.GetRequiredService<IOptionsMonitor<AiOptions>>(),
            sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<OpenAiProvider>>()));
        services.AddSingleton<IAiProvider>(sp => sp.GetRequiredService<OpenAiProvider>());
        services.AddSingleton<IImageCleanup>(sp => sp.GetRequiredService<OpenAiProvider>());
        services.AddSingleton<IGarmentVision>(sp => sp.GetRequiredService<OpenAiProvider>());
        services.AddSingleton<ITryOnRenderer>(sp => sp.GetRequiredService<OpenAiProvider>());
        services.AddSingleton<IStylistModel>(sp => sp.GetRequiredService<OpenAiProvider>());
        services.AddSingleton<IPaletteAnalyzer>(sp => sp.GetRequiredService<OpenAiProvider>());
        services.AddSingleton<IPhotoInspector>(sp => sp.GetRequiredService<OpenAiProvider>());
        services.AddSingleton<IItemDetector>(sp => sp.GetRequiredService<OpenAiProvider>());
        services.AddSingleton<IItemImageCleanup>(sp => sp.GetRequiredService<OpenAiProvider>());
        return services;
    }

    public static IServiceCollection AddDrobletApiServices(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<JwtOptions>(configuration.GetSection(JwtOptions.Section));
        services.Configure<AppleAuthOptions>(configuration.GetSection(AppleAuthOptions.Section));
        services.Configure<GoogleAuthOptions>(configuration.GetSection(GoogleAuthOptions.Section));
        services.Configure<EmailOptions>(configuration.GetSection(EmailOptions.Section));
        services.Configure<AppLinksOptions>(configuration.GetSection(AppLinksOptions.Section));
        services.Configure<AuthRateLimitOptions>(configuration.GetSection(AuthRateLimitOptions.Section));
        services.PostConfigure<AppleAuthOptions>(o =>
        {
            o.PrivateKey = ConfigSecret.OrNull(o.PrivateKey);
            o.KeyId = ConfigSecret.OrNull(o.KeyId);
            o.TeamId = ConfigSecret.OrNull(o.TeamId);
            o.TokenEncryptionKey = ConfigSecret.OrNull(o.TokenEncryptionKey);
        });
        services.PostConfigure<EmailOptions>(o => o.SendGrid.ApiKey = ConfigSecret.OrNull(o.SendGrid.ApiKey));

        services.AddHttpContextAccessor();
        services.AddScoped<IApiContext, ApiContext>();

        services.AddSingleton<IPasswordHasher>(_ => new PasswordHasher());
        services.AddSingleton<ITokenService, TokenService>();
        services.AddSingleton<IRateLimiter, RateLimiter>();
        services.AddSingleton<IContactDirectory, Infrastructure.Services.Social.ContactDirectory>();
        services.AddSingleton<IAuthService, AuthService>();
        services.AddSingleton<IAccountDeletionService, AccountDeletionService>();
        services.AddSingleton<IPhotoService, PhotoService>();
        // E10 in-app purchases: StoreKit 2 / Play Billing verified on the server, no third-party service.
        services.AddSingleton<IAppleRootCertificates, AppleRootCertificates>();
        services.AddSingleton<AppleJwsVerifier>();
        services.AddSingleton<IAppStoreServerApi>(sp => new AppStoreServerApi(
            new HttpClient { Timeout = TimeSpan.FromSeconds(10) },
            sp.GetRequiredService<IOptionsMonitor<StoreOptions>>(), sp.GetRequiredService<TimeProvider>(),
            sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<AppStoreServerApi>>()));
        services.AddSingleton<IGooglePlayDeveloperApi>(sp => new GooglePlayDeveloperApi(
            new HttpClient { Timeout = TimeSpan.FromSeconds(10) },
            sp.GetRequiredService<IOptionsMonitor<StoreOptions>>(), sp.GetRequiredService<TimeProvider>(),
            sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<GooglePlayDeveloperApi>>()));
        services.AddSingleton<StorePurchaseVerifier>();
        services.AddSingleton<IPurchaseVerifier>(sp => sp.GetRequiredService<StorePurchaseVerifier>());
        services.AddSingleton<IPurchaseService, PurchaseService>();
        services.AddSingleton<IStoreSyncService, StoreSyncService>();
        services.AddSingleton<IPubSubPushVerifier>(sp => new PubSubPushVerifier(
            new OidcTokenValidator(OidcTokenValidator.ForMetadata("https://accounts.google.com/.well-known/openid-configuration"), sp.GetRequiredService<TimeProvider>()),
            sp.GetRequiredService<IOptionsMonitor<StoreOptions>>()));
        services.AddSingleton<IAppleSignInTokenService>(sp => new AppleSignInTokenService(
            new HttpClient { Timeout = TimeSpan.FromSeconds(10) },
            sp.GetRequiredService<Domain.Manager.IRepository>(),
            sp.GetRequiredService<IOptionsMonitor<AppleAuthOptions>>(),
            sp.GetRequiredService<IOptionsMonitor<JwtOptions>>(),
            sp.GetRequiredService<TimeProvider>(),
            sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<AppleSignInTokenService>>()));

        services.AddSingleton(sp => new SendGridEmailService(
            new HttpClient { Timeout = TimeSpan.FromSeconds(10) },
            sp.GetRequiredService<IOptionsMonitor<EmailOptions>>()));
        services.AddSingleton<SmtpEmailService>();
        services.AddSingleton<IEmailService>(sp =>
            string.Equals(sp.GetRequiredService<IOptions<EmailOptions>>().Value.Provider, "Smtp", StringComparison.OrdinalIgnoreCase)
                ? sp.GetRequiredService<SmtpEmailService>()
                : sp.GetRequiredService<SendGridEmailService>());

        services.AddSingleton<IAppleIdentityVerifier>(sp => new AppleIdentityVerifier(
            new OidcTokenValidator(OidcTokenValidator.ForMetadata(sp.GetRequiredService<IOptions<AppleAuthOptions>>().Value.MetadataAddress), sp.GetRequiredService<TimeProvider>()),
            sp.GetRequiredService<IOptionsMonitor<AppleAuthOptions>>(),
            sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<AppleIdentityVerifier>>()));
        services.AddSingleton<IGoogleIdentityVerifier>(sp => new GoogleIdentityVerifier(
            new OidcTokenValidator(OidcTokenValidator.ForMetadata(sp.GetRequiredService<IOptions<GoogleAuthOptions>>().Value.MetadataAddress), sp.GetRequiredService<TimeProvider>()),
            sp.GetRequiredService<IOptionsMonitor<GoogleAuthOptions>>(),
            sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<GoogleIdentityVerifier>>()));

        services.AddDrobletStoreSocialApi();
        return services;
    }
}
