using Domain.Entity;
using Domain.Manager;
using Domain.Services;
using Microsoft.Extensions.Logging;

namespace Infrastructure.Services;

/// <summary>
/// Writes one finished job's AI usage into the durable counters, in one DynamoDB transaction with a once-per-job marker:
/// the tenant's day and month rows, the global (ai#usage#all) and per-plan (free / premium) day and month rows, and the
/// day index of users with usage. Admin trials go to the "admin" tenant rows and the global rows only (never a user,
/// a plan or the day index). Numbers only — no prompt, answer or image ever reaches these rows.
/// Best effort: a failed write is logged and never fails the job (the EMF metric and the job's aiCost still carry it).
/// </summary>
public sealed class AiUsageRecorder(IRepository repository, ILogger<AiUsageRecorder> logger) : IAiUsageRecorder
{
    public async Task<bool> RecordAsync(AiUsageRecord record, CancellationToken ct)
    {
        try
        {
            var increments = AiUsageCounters.Increments(record);
            if (increments.Count == 0)
                return false;

            var admin = record.TenantId == AiUsageEntity.AdminTenant;
            var day = DateOnly.FromDateTime(record.At);
            var dayTtl = AiUsageEntity.DayTtl(day);
            var monthTtl = AiUsageEntity.MonthTtl(day);
            var dayPeriod = new Dictionary<string, string> { ["period"] = AiUsageEntity.DayPeriod(day) };
            var monthPeriod = new Dictionary<string, string> { ["period"] = AiUsageEntity.MonthPeriod(day) };
            var updates = new List<CounterUpdate>
            {
                new(AiUsageEntity.GetPk(record.TenantId), AiUsageEntity.DaySk(day), increments, dayTtl, dayPeriod),
                new(AiUsageEntity.GetPk(record.TenantId), AiUsageEntity.MonthSk(day), increments, monthTtl, monthPeriod),
                new(AiUsageEntity.AllPk, AiUsageEntity.DaySk(day), increments, dayTtl, dayPeriod),
                new(AiUsageEntity.AllPk, AiUsageEntity.MonthSk(day), increments, monthTtl, monthPeriod),
            };
            if (!admin)
            {
                var plan = await PlanAsync(record.TenantId, record.At, ct);
                updates.Add(new(AiUsageEntity.PlanPk(plan), AiUsageEntity.DaySk(day), increments, dayTtl, dayPeriod));
                updates.Add(new(AiUsageEntity.PlanPk(plan), AiUsageEntity.MonthSk(day), increments, monthTtl, monthPeriod));
                var calls = increments.GetValueOrDefault(AiUsageCounters.Calls);
                if (calls > 0)
                {
                    var index = new AiUsageDayIndexEntity { Day = day, TenantId = record.TenantId };
                    updates.Add(new(index.Pk, index.Sk,
                        new Dictionary<string, long> { ["cost"] = increments.GetValueOrDefault(AiUsageCounters.Cost), ["calls"] = calls },
                        dayTtl,
                        new Dictionary<string, string>
                        {
                            ["plan"] = plan,
                            ["tenantId"] = record.TenantId,
                            ["day"] = AiUsageEntity.DayPeriod(day),
                        }));
                }
            }

            var marker = new AiUsageMarkerEntity { TenantId = record.TenantId, MarkerId = record.MarkerId, CreatedAt = record.At };
            var written = await repository.AddCountersOnceAsync(marker, updates, ct);
            if (!written)
                logger.LogInformation("AI usage of {Marker} for tenant {TenantId} already counted", record.MarkerId, record.TenantId);
            return written;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "AI usage of {Marker} for tenant {TenantId} not counted", record.MarkerId, record.TenantId);
            return false;
        }
    }

    /// <summary>The tenant's tier when the job finished (the same resolution as the entitlement checks).</summary>
    private async Task<string> PlanAsync(string tenantId, DateTime at, CancellationToken ct)
    {
        var entitlements = await repository.GetAllAsync<EntitlementEntity>(EntitlementEntity.GetPk(tenantId), ct);
        return AiUsagePlans.Of(EntitlementResolver.Resolve(entitlements, at).Tier);
    }
}
