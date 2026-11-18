using Domain.Options;
using Domain.Services;
using Infrastructure.Services;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Infrastructure;

public static class WardrobeDependencyInjection
{
    /// <summary>
    /// E2–E7 services (wardrobe, looks, plan, stylist, trips, try-on, palette). Shared by the Api and the workers.
    /// The seams to the store / content modules (catalog product lookup, editorial looks) are implemented in
    /// Infrastructure.Services.Integration; weather comes from the Open-Meteo backed IWeatherService (store/social core).
    /// </summary>
    public static IServiceCollection AddDrobletWardrobe(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<WardrobeOptions>(configuration.GetSection(WardrobeOptions.Section));
        services.Configure<StylistOptions>(configuration.GetSection(StylistOptions.Section));
        services.Configure<PackingOptions>(configuration.GetSection(PackingOptions.Section));
        services.Configure<PaletteOptions>(configuration.GetSection(PaletteOptions.Section));

        // Static rule sets read their config once here and again whenever the configuration reloads (SSM: every 60 s).
        void ApplyRuleConfig() => OutfitSlotRules.Configure(
            (configuration.GetSection(WardrobeOptions.Section).Get<WardrobeOptions>() ?? new WardrobeOptions()).SlotMapping);
        ApplyRuleConfig();
        Microsoft.Extensions.Primitives.ChangeToken.OnChange(configuration.GetReloadToken, ApplyRuleConfig);

        services.TryAddSingleton<ICatalogProductLookup>(sp => new Services.Integration.CatalogProductLookup(
            sp.GetRequiredService<ICatalogService>(),
            sp.GetRequiredService<IRequestLanguage>(),
            new HttpClient { Timeout = TimeSpan.FromSeconds(15) },
            sp.GetRequiredService<Microsoft.Extensions.Options.IOptionsMonitor<CatalogOptions>>(),
            sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<Services.Integration.CatalogProductLookup>>()));
        services.TryAddSingleton<IEditLookLookup, Services.Integration.EditLookLookup>();

        services.AddSingleton<Services.Integration.IProfileStatsService, Services.Integration.ProfileStatsService>();
        services.AddSingleton<ILibraryCatalog, LibraryCatalog>();
        services.AddSingleton<IWardrobeService, WardrobeService>();
        services.AddSingleton<ILookService, LookService>();
        services.AddSingleton<IPlanService, PlanService>();
        services.AddSingleton<IStylistService, StylistService>();
        services.AddSingleton<ITripService, TripService>();
        services.AddSingleton<ITryOnService, TryOnService>();
        services.AddSingleton<IPaletteService, PaletteService>();
        return services;
    }
}
