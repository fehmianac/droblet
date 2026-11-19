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
        services.Configure<LocalizationOptions>(configuration.GetSection(LocalizationOptions.Section));
        // The one language list: static helpers (Localized.*) used by rules, workers and prompts read the same config.
        void ApplyLanguages() =>
            Localized.Configure(configuration.GetSection(LocalizationOptions.Section).Get<LocalizationOptions>() ?? new LocalizationOptions());
        ApplyLanguages();
        Microsoft.Extensions.Primitives.ChangeToken.OnChange(configuration.GetReloadToken, ApplyLanguages);
        services.TryAddSingleton<IRequestLanguage, Infrastructure.Context.RequestLanguage>();
        services.Configure<FirebaseServiceAccountOptions>(o => FirebaseServiceAccountBinder.Bind(configuration, o));

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
        services.TryAddSingleton<IWatchListAutoAdd, WatchListAutoAdd>();
        services.TryAddSingleton<INotificationInbox, NotificationInboxService>();

        services.TryAddSingleton<IWeatherProvider>(sp => new OpenMeteoWeatherProvider(
            new HttpClient { Timeout = TimeSpan.FromSeconds(10) }, sp.GetRequiredService<IOptionsMonitor<WeatherOptions>>()));
        services.TryAddSingleton<IWeatherService, WeatherService>();

        // Android (FCM tokens) → FCM HTTP v1; iOS (raw APNs tokens from expo-notifications) → APNs HTTP/2. Each is off
        // (NotConfigured) while its SSM secret is CHANGE_ME.
        services.Configure<ApnsOptions>(configuration.GetSection(ApnsOptions.Section));
        services.TryAddSingleton(sp => new FcmPushProvider(
            new HttpClient { Timeout = TimeSpan.FromSeconds(10) },
            sp.GetRequiredService<IOptionsMonitor<FirebaseServiceAccountOptions>>(),
            sp.GetRequiredService<TimeProvider>(),
            sp.GetRequiredService<ILogger<FcmPushProvider>>()));
        services.TryAddSingleton(sp => new ApnsPushProvider(
            new HttpClient(new SocketsHttpHandler { PooledConnectionLifetime = TimeSpan.FromMinutes(30) }) { Timeout = TimeSpan.FromSeconds(10) },
            sp.GetRequiredService<IOptionsMonitor<ApnsOptions>>(),
            sp.GetRequiredService<TimeProvider>(),
            sp.GetRequiredService<ILogger<ApnsPushProvider>>()));
        services.TryAddSingleton<IPushProvider, RoutingPushProvider>();
        return services;
    }

    /// <summary>Api only (called from AddDrobletApiServices): services that need the rate limiter or serve tenant endpoints.</summary>
    public static IServiceCollection AddDrobletStoreSocialApi(this IServiceCollection services)
    {
        services.TryAddSingleton<ICartService, CartService>();
        services.TryAddSingleton<IAffiliateService, AffiliateService>();
        services.TryAddSingleton<ISocialService, SocialService>();
        services.TryAddSingleton<IContentModeration, ContentModerationService>();
        services.TryAddSingleton<IContactMatchService, ContactMatchService>();
        services.TryAddSingleton<IInviteService, InviteService>();
        services.TryAddSingleton<ISettingsService, SettingsService>();
        services.TryAddSingleton<ICrossTenantCleanup, CrossTenantCleanup>();
        return services;
    }
}

/// <summary>
/// Binds the Firebase service account from configuration. Shapes that reach us:
///   • Push:ServiceAccountJson = "CHANGE_ME" (deploy placeholder) or empty → nothing is bound (push disabled);
///   • Push:ServiceAccountJson = the JSON file as ONE string (local user-secrets / env var) → parsed here;
///   • Push:ServiceAccountJson:project_id, … — the SSM loader (JsonOrStringParameterProcessor) flattens a JSON
///     parameter value into child keys, so this is what the Notifier Lambda actually sees;
///   • FirebaseServiceAccount:* — the earlier section name, still accepted.
/// Google's file uses snake_case names.
/// </summary>
public static class FirebaseServiceAccountBinder
{
    public static void Bind(IConfiguration configuration, FirebaseServiceAccountOptions options)
    {
        var json = configuration.GetSection(FirebaseServiceAccountOptions.JsonKey);
        if (ConfigSecret.IsSet(json.Value) && TryParse(json.Value!, out var parsed))
        {
            Apply(options, key => parsed.GetValueOrDefault(key));
            return;
        }

        var section = json.GetChildren().Any() ? json : configuration.GetSection(FirebaseServiceAccountOptions.Section);
        Apply(options, key => section[key] ?? section[Pascal(key)]);
    }

    private static void Apply(FirebaseServiceAccountOptions options, Func<string, string?> read)
    {
        options.ProjectId = ConfigSecret.OrNull(read("project_id"));
        options.ClientEmail = ConfigSecret.OrNull(read("client_email"));
        options.PrivateKey = ConfigSecret.OrNull(read("private_key"));
        options.TokenUri = ConfigSecret.OrNull(read("token_uri")) ?? options.TokenUri;
    }

    private static bool TryParse(string json, out Dictionary<string, string?> values)
    {
        values = new Dictionary<string, string?>(StringComparer.Ordinal);
        try
        {
            using var document = System.Text.Json.JsonDocument.Parse(json);
            if (document.RootElement.ValueKind != System.Text.Json.JsonValueKind.Object)
                return false;
            foreach (var property in document.RootElement.EnumerateObject())
                values[property.Name] = property.Value.ValueKind == System.Text.Json.JsonValueKind.String ? property.Value.GetString() : null;
            return true;
        }
        catch (System.Text.Json.JsonException)
        {
            return false;
        }
    }

    private static string Pascal(string snake) =>
        string.Concat(snake.Split('_').Select(part => part.Length == 0 ? part : char.ToUpperInvariant(part[0]) + part[1..]));
}
