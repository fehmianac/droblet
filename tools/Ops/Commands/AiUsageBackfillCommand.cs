using Domain.Services;
using Infrastructure.Services;
using Microsoft.Extensions.DependencyInjection;

namespace Ops.Commands;

/// <summary>
/// ai-usage-backfill: replays the last N days (≤ 7, the job table's retention) of finished jobs and outfit import photos
/// into the AI usage counters (admin AI › Maliyet) from their stored aiCost. No AI call; idempotent (the live
/// once-per-job markers), so it is safe on any stage and safe to repeat. --dry-run only counts.
/// </summary>
internal static class AiUsageBackfillCommand
{
    public static async Task<int> RunAsync(IServiceProvider services, OpsArguments args, OpsOutput output, CancellationToken ct)
    {
        var backfill = new AiUsageBackfill(
            services.GetRequiredService<Domain.Manager.IRepository>(), services.GetRequiredService<IAiUsageRecorder>(), services.GetRequiredService<TimeProvider>());
        var result = await backfill.RunAsync(args.IntOption("days", 7), args.DryRun, ct);
        output.Table(["tenants", "jobs", "outfit import photos", "written", "already counted", "dry run"],
        [[
            result.Tenants.ToString(System.Globalization.CultureInfo.InvariantCulture), result.Jobs.ToString(System.Globalization.CultureInfo.InvariantCulture),
            result.Photos.ToString(System.Globalization.CultureInfo.InvariantCulture), result.Written.ToString(System.Globalization.CultureInfo.InvariantCulture),
            result.AlreadyCounted.ToString(System.Globalization.CultureInfo.InvariantCulture), args.DryRun ? "yes" : "no",
        ]]);
        return 0;
    }
}
