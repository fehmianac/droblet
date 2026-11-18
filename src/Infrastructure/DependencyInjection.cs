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

        services.AddSingleton(TimeProvider.System);

        services.AddSingleton<IAmazonDynamoDB>(_ => new AmazonDynamoDBClient());
        services.AddSingleton<IAmazonS3>(_ => new AmazonS3Client());
        services.AddSingleton<IAmazonSQS>(_ => new AmazonSQSClient());

        services.AddSingleton<IRepository, Repository>();
        services.AddSingleton<IObjectStorage, S3ObjectStorage>();
        services.AddSingleton<IEventManager, EventManager>();
        services.AddSingleton<IEntitlementService, EntitlementService>();
        services.AddSingleton<ICreditService, CreditService>();
        services.AddSingleton<IJobLifecycle, JobLifecycle>();
        services.AddDrobletStoreSocialCore(configuration);
        return services;
    }

    public static IServiceCollection AddDrobletAi(this IServiceCollection services)
    {
        services.AddSingleton<NotConfiguredAiProvider>();
        services.AddSingleton<IAiProvider>(sp => sp.GetRequiredService<NotConfiguredAiProvider>());
        services.AddSingleton<IImageCleanup>(sp => sp.GetRequiredService<NotConfiguredAiProvider>());
        services.AddSingleton<IGarmentVision>(sp => sp.GetRequiredService<NotConfiguredAiProvider>());
        services.AddSingleton<ITryOnRenderer>(sp => sp.GetRequiredService<NotConfiguredAiProvider>());
        services.AddSingleton<IStylistModel>(sp => sp.GetRequiredService<NotConfiguredAiProvider>());
        services.AddSingleton<IPaletteAnalyzer>(sp => sp.GetRequiredService<NotConfiguredAiProvider>());
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

        services.AddHttpContextAccessor();
        services.AddScoped<IApiContext, ApiContext>();

        services.AddSingleton<IPasswordHasher>(_ => new PasswordHasher());
        services.AddSingleton<ITokenService, TokenService>();
        services.AddSingleton<IRateLimiter, RateLimiter>();
        services.AddSingleton<IAuthService, AuthService>();
        services.AddSingleton<IAccountDeletionService, AccountDeletionService>();
        services.AddSingleton<IPhotoService, PhotoService>();
        services.AddSingleton<IPurchaseVerifier, NotConfiguredPurchaseVerifier>();
        services.AddSingleton<IPurchaseService, PurchaseService>();

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
