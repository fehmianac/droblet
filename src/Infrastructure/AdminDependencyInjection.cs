using Amazon.SimpleSystemsManagement;
using Domain.Options;
using Domain.Services.Admin;
using Infrastructure.Services.Admin;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Infrastructure;

public static class AdminDependencyInjection
{
    /// <summary>Admin panel services (Api only). Tests replace ISettingsStore with an in-memory store.</summary>
    public static IServiceCollection AddDrobletAdmin(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<AdminJwtOptions>(configuration.GetSection(AdminJwtOptions.Section));
        services.Configure<AdminAuthOptions>(configuration.GetSection(AdminAuthOptions.Section));
        // No configured origin = the panel's own origin.
        services.PostConfigure<AdminAuthOptions>(o =>
            o.AllowedOrigins = o.AllowedOrigins.Count > 0
                ? o.AllowedOrigins.Select(a => a.TrimEnd('/')).Distinct(StringComparer.OrdinalIgnoreCase).ToList()
                : [o.PanelUrl.TrimEnd('/')]);

        services.AddSingleton<IAdminTokenService, AdminTokenService>();
        services.AddSingleton<IAuditLog, AuditLog>();
        services.AddSingleton<AdminAuthService>();
        services.AddSingleton<IAdminAuthService>(sp => sp.GetRequiredService<AdminAuthService>());
        services.AddSingleton<IAdminUserService, AdminUserService>();
        services.AddSingleton<IAdminAppUserService, AdminAppUserService>();
        services.AddSingleton<IAdminLibraryService, AdminLibraryService>();
        services.AddSingleton<IAdminDashboardService, AdminDashboardService>();
        // Tenant-facing, but audited like an admin grant, so it lives with the audit log (Api only).
        services.AddSingleton<Services.SelfServePremiumService>();
        services.AddSingleton<ICatalogImageStorage, S3CatalogImageStorage>();

        services.AddSingleton(_ => new Lazy<IAmazonSimpleSystemsManagement>(() => new AmazonSimpleSystemsManagementClient()));
        services.AddSingleton<ISettingsStore, SsmSettingsStore>();
        var stage = configuration["STAGE"] is { Length: > 0 } s ? s : "dev";
        services.AddSingleton<IAdminSettingsService>(sp => new AdminSettingsService(sp.GetRequiredService<ISettingsStore>(), sp.GetRequiredService<IAuditLog>(), stage));
        services.AddSingleton<IAdminAiService>(sp => new AdminAiService(
            sp.GetRequiredService<Domain.Manager.IRepository>(), sp.GetRequiredService<Domain.Manager.IEventManager>(), sp.GetRequiredService<ISettingsStore>(),
            sp.GetRequiredService<IAuditLog>(), sp.GetRequiredService<Microsoft.Extensions.Options.IOptionsMonitor<CatalogImageOptions>>(),
            sp.GetRequiredService<TimeProvider>(), stage));
        return services;
    }
}
