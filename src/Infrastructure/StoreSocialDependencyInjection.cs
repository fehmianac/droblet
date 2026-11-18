using Domain.Options;
using Domain.Services;
using Domain.Validation;
using FluentValidation;
using Infrastructure.Services;
using Infrastructure.Services.Providers;
using Infrastructure.Services.Social;
using Infrastructure.Services.Store;
using Infrastructure.Services.Weather;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Infrastructure;

/// <summary>Registrations of E8 (store), E9 (social), E11 (settings), analytics, weather and push.</summary>
public static class StoreSocialDependencyInjection
{
    /// <summary>
    /// Shared by Api, workers and Notifier (called from AddDrobletCore): catalog, analytics, weather, push and the
    /// seams to the wardrobe / plan slices. TryAdd, so the slice that owns the real implementation wins regardless of order.
    /// </summary>
    public static IServiceCollection AddDrobletStoreSocialCore(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<CatalogOptions>(configuration.GetSection(CatalogOptions.Section));
        services.Configure<SocialOptions>(configuration.GetSection(SocialOptions.Section));
        services.Configure<WeatherOptions>(configuration.GetSection(WeatherOptions.Section));
        services.Configure<NotificationOptions>(configuration.GetSection(NotificationOptions.Section));
        services.Configure<AffiliatePostbackOptions>(configuration.GetSection(AffiliatePostbackOptions.Section));
        services.Configure<AdminOptions>(configuration.GetSection(AdminOptions.Section));
        services.Configure<LocalizationOptions>(configuration.GetSection(LocalizationOptions.Section));
        services.TryAddSingleton<IRequestLanguage, Infrastructure.Context.RequestLanguage>();
        services.Configure<FirebaseServiceAccountOptions>(o =>
        {
            // Google's service-account JSON uses snake_case names.
            var section = configuration.GetSection(FirebaseServiceAccountOptions.Section);
            o.ProjectId = section["project_id"] ?? section["ProjectId"];
            o.ClientEmail = section["client_email"] ?? section["ClientEmail"];
            o.PrivateKey = section["private_key"] ?? section["PrivateKey"];
            o.TokenUri = section["token_uri"] ?? section["TokenUri"] ?? o.TokenUri;
        });

        // Shared by the admin API and the seed tool.
        services.TryAddSingleton<IValidator<BrandInput>, BrandInputValidator>();
        services.TryAddSingleton<IValidator<ProductInput>, ProductInputValidator>();
        services.TryAddSingleton<IValidator<WeeklyEditInput>, WeeklyEditInputValidator>();
        services.TryAddSingleton<IValidator<ContentCollectionInput>, ContentCollectionInputValidator>();
        services.TryAddSingleton<IValidator<ContentLookInput>, ContentLookInputValidator>();

        // Seams to the wardrobe / plan slices (real implementations: Infrastructure.Services.Integration).
        services.TryAddSingleton<IClosetReader, Infrastructure.Services.Integration.WardrobeClosetReader>();
        services.TryAddSingleton<IWardrobeMatcher, RuleBasedWardrobeMatcher>();
        services.TryAddSingleton<IMorningOutfitCheck, Infrastructure.Services.Integration.PlanMorningOutfitCheck>();

        services.TryAddSingleton<IAnalyticsService, AnalyticsService>();
        services.TryAddSingleton<ICatalogService, CatalogService>();
        services.TryAddSingleton<IContentService, ContentService>();

        services.TryAddSingleton<IWeatherProvider>(sp => new OpenMeteoWeatherProvider(
            new HttpClient { Timeout = TimeSpan.FromSeconds(10) }, sp.GetRequiredService<IOptionsMonitor<WeatherOptions>>()));
        services.TryAddSingleton<IWeatherService, WeatherService>();

        services.TryAddSingleton<IPushProvider>(sp => new FcmPushProvider(
            new HttpClient { Timeout = TimeSpan.FromSeconds(10) },
            sp.GetRequiredService<IOptionsMonitor<FirebaseServiceAccountOptions>>(),
            sp.GetRequiredService<TimeProvider>(),
            sp.GetRequiredService<ILogger<FcmPushProvider>>()));
        return services;
    }

    /// <summary>Api only (called from AddDrobletApiServices): services that need the rate limiter or serve tenant endpoints.</summary>
    public static IServiceCollection AddDrobletStoreSocialApi(this IServiceCollection services)
    {
        services.TryAddSingleton<ICartService, CartService>();
        services.TryAddSingleton<IAffiliateService, AffiliateService>();
        services.TryAddSingleton<ISocialService, SocialService>();
        services.TryAddSingleton<IInviteService, InviteService>();
        services.TryAddSingleton<ISettingsService, SettingsService>();
        services.TryAddSingleton<ICrossTenantCleanup, CrossTenantCleanup>();
        return services;
    }
}
