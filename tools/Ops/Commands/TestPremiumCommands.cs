using Domain.Entity;
using Domain.Manager;
using Domain.Services.Admin;
using Microsoft.Extensions.DependencyInjection;

namespace Ops.Commands;

/// <summary>
/// grant-test-premium / revoke-test-premium: the admin panel's "Grant TEST premium" / "Add TEST credits" /
/// "Revoke TEST premium" (IAdminAppUserService — same code, same audit entries), with actor ops:github-actions.
/// Dev only (OpsArguments.DevOnly).
/// </summary>
internal static class TestPremiumCommands
{
    public const int DefaultDays = 7;

    public static async Task<int> GrantAsync(IServiceProvider services, OpsArguments args, OpsOutput output, CancellationToken ct)
    {
        var users = services.GetRequiredService<IAdminAppUserService>();
        var user = await FindAsync(users, args.Option("email")!, output, ct);
        if (user is null)
            return 1;

        var days = args.IntOption("days", DefaultDays);
        var detail = await users.GrantTestPremiumAsync(OpsHost.Actor, user.Id, days, "ops-dev workflow", null, ct);
        if (args.Option("credits") is not null)
            detail = await users.AddCreditsAsync(OpsHost.Actor, user.Id, args.IntOption("credits", 0), "ops-dev workflow", null, ct);

        output.Table(["user", "tier", "test premium until", "allowance", "pack credits"],
        [[
            user.Id, detail?.Entitlement.Tier.ToString() ?? "?", detail?.Entitlement.TestPremiumExpiresAt?.ToString("u") ?? "-",
            $"{detail?.Credits.AllowanceRemaining}/{detail?.Credits.AllowanceTotal}", detail?.Credits.PackBalance.ToString() ?? "-",
        ]]);
        return detail is null ? 1 : 0;
    }

    public static async Task<int> RevokeAsync(IServiceProvider services, OpsArguments args, OpsOutput output, CancellationToken ct)
    {
        var users = services.GetRequiredService<IAdminAppUserService>();
        var user = await FindAsync(users, args.Option("email")!, output, ct);
        if (user is null)
            return 1;
        var detail = await users.RevokeTestPremiumAsync(OpsHost.Actor, user.Id, null, ct);
        output.Table(["user", "tier", "test premium until"], [[user.Id, detail?.Entitlement.Tier.ToString() ?? "?", detail?.Entitlement.TestPremiumExpiresAt?.ToString("u") ?? "-"]]);
        return detail is null ? 1 : 0;
    }

    /// <summary>
    /// set-recognition-used: writes the free AI-recognition counter of a dev test account (no AI call), so the
    /// "allowance used up → paywall → member" flow can be tested without spending recognitions.
    /// </summary>
    public static async Task<int> SetRecognitionUsedAsync(IServiceProvider services, OpsArguments args, OpsOutput output, CancellationToken ct)
    {
        var users = services.GetRequiredService<IAdminAppUserService>();
        var repository = services.GetRequiredService<IRepository>();
        var user = await FindAsync(users, args.Option("email")!, output, ct);
        if (user is null)
            return 1;

        var used = args.IntOption("used", 0);
        var usage = await repository.GetAsync<ItemRecognitionUsageEntity>(ItemRecognitionUsageEntity.GetPk(user.TenantId), ItemRecognitionUsageEntity.GetSk(), ct)
                    ?? new ItemRecognitionUsageEntity { TenantId = user.TenantId };
        var before = usage.Used;
        usage.Used = used;
        usage.Pending.Clear();
        usage.UpdatedAt = DateTime.UtcNow;
        usage.Version += 1;
        await repository.SaveAsync(usage, ct);
        output.Table(["user", "tenant", "used before", "used now"], [[user.Id, user.TenantId, $"{before}", $"{used}"]]);
        return 0;
    }

    private static async Task<AdminAppUserSummaryDto?> FindAsync(IAdminAppUserService users, string email, OpsOutput output, CancellationToken ct)
    {
        var page = await users.SearchAsync(email.Trim(), null, 1, ct);
        var user = page.Items.FirstOrDefault(u => string.Equals(u.Email, email.Trim(), StringComparison.OrdinalIgnoreCase));
        if (user is null)
            output.Error($"No app user with e-mail {email}.");
        return user;
    }
}
