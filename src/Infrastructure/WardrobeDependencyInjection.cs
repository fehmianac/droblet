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
    /// The seams owned by other modules — weather provider, catalog lookup, editorial looks — are registered with
    /// TryAdd, so the real implementation wins whether it is registered before or after this call
    /// (a later AddSingleton also replaces the default on resolve).
    /// </summary>
    public static IServiceCollection AddDrobletWardrobe(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<WardrobeOptions>(configuration.GetSection(WardrobeOptions.Section));
        services.Configure<StylistOptions>(configuration.GetSection(StylistOptions.Section));
        services.Configure<PackingOptions>(configuration.GetSection(PackingOptions.Section));

        services.TryAddSingleton<ICatalogProductLookup, RepositoryCatalogProductLookup>();
        services.TryAddSingleton<IEditLookLookup, NullEditLookLookup>();

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
