using System.Collections.Concurrent;
using Domain.Entity;
using Domain.Enum;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Domain.Services.Admin;
using Microsoft.Extensions.Options;

namespace Infrastructure.Services.Admin;

/// <summary>
/// Admin AI usage views over the durable counters (AiUsageRecorder): one user's usage (audited) and the overall board.
/// Reads only numbers — counter rows, the day index, the user's job rows (kind, model ids, duration, cost, outcome) and
/// credit ledger amounts; never a prompt, an answer or an image. Users on the board are masked (handle / e-mail).
/// </summary>
public sealed class AdminAiUsageService(
    IRepository repository,
    IEntitlementService entitlements,
    IAuditLog audit,
    IOptionsMonitor<AiUsageOptions> options) : IAdminAiUsageService
{
    /// <summary>Recent jobs listed on the user detail (the job table keeps 7 days).</summary>
    public const int RecentJobs = 50;
    private const int HistoryDays = 30;
    private const int MaxAnomalies = 100;
    private const int Parallelism = 8;

    private AiUsageOptions Options => options.CurrentValue;

    public async Task<AdminUserAiUsageDto?> GetUserUsageAsync(AdminUserEntity actor, string userId, DateOnly from, DateOnly to, string? ip, CancellationToken ct)
    {
        var user = await repository.GetAsync<UserEntity>(UserEntity.GetPk(), UserEntity.GetSk(userId), ct);
        if (user is null)
            return null;
        var tenantId = user.TenantId;

        var rows = await RowsAsync(AiUsageEntity.GetPk(tenantId), from, to, ct);
        var days = rows.Days.Select(r => AiUsageMath.Period(r.Period ?? r.Sk[2..], r.Counters)).ToList();
        var months = rows.Months.Select(r => AiUsageMath.Period(r.Period ?? r.Sk[2..], r.Counters)).ToList();
        var sum = AiUsageMath.Sum(rows.Days.Select(r => r.Counters));
        var snapshot = await entitlements.GetAsync(tenantId, ct);

        var result = new AdminUserAiUsageDto(
            user.Id, tenantId, Day(from), Day(to), AiUsagePlans.Of(snapshot.Active.Tier),
            new AdminAppUserCredits(snapshot.Credits.MonthlyAllowance, snapshot.Credits.AllowanceRemaining, snapshot.Credits.PackRemaining),
            AiUsageMath.Totals(sum), AiUsageMath.Operations(sum), AiUsageMath.Models(sum), days, months,
            await RecentJobsAsync(tenantId, ct), Rates());

        // Looking at one person's usage is a read of personal data: audited like a write.
        await audit.WriteAsync(actor, "user.ai_usage_view", "user", user.Id, null, new { from = Day(from), to = Day(to) }, ip, ct);
        return result;
    }

    public async Task<AdminAiUsageSummaryDto> GetSummaryAsync(DateOnly from, DateOnly to, CancellationToken ct)
    {
        var o = Options;
        var all = await RowsAsync(AiUsageEntity.AllPk, from, to, ct);
        var admin = await RowsAsync(AiUsageEntity.GetPk(AiUsageEntity.AdminTenant), from, to, ct);
        var allSum = AiUsageMath.Sum(all.Days.Select(r => r.Counters));
        var byDay = all.Days.ToDictionary(r => r.Period ?? r.Sk[2..], r => r.Counters, StringComparer.Ordinal);
        var dayRows = AiUsageMath.Days(from, to).Select(d =>
        {
            var c = byDay.GetValueOrDefault(AiUsageEntity.DayPeriod(d)) ?? new Dictionary<string, long>();
            return new AiUsageDayDto(AiUsageEntity.DayPeriod(d), c.GetValueOrDefault(AiUsageCounters.Cost), c.GetValueOrDefault(AiUsageCounters.Calls),
                c.GetValueOrDefault(AiUsageCounters.Jobs), c.GetValueOrDefault(AiUsageCounters.Failed));
        }).ToList();

        // The day index of [from − 30, to]: users of the range, and the history the anomaly rule compares with.
        var index = await DayIndexAsync(from.AddDays(-HistoryDays), to, ct);
        var inRange = index.Where(r => r.Day >= from && r.Day <= to).ToList();
        var rangeDays = to.DayNumber - from.DayNumber + 1;

        var plans = new List<AiUsagePlanDto>();
        foreach (var plan in new[] { AiUsagePlans.Free, AiUsagePlans.Premium })
        {
            var planRows = await RowsAsync(AiUsageEntity.PlanPk(plan), from, to, ct);
            var active = inRange.Where(r => (r.Plan ?? AiUsagePlans.Free) == plan).Select(r => r.TenantId).Distinct(StringComparer.Ordinal).Count();
            plans.Add(AiUsageMath.Plan(plan, active, AiUsageMath.Sum(planRows.Days.Select(r => r.Counters)), rangeDays, o));
        }

        var users = inRange.GroupBy(r => r.TenantId, StringComparer.Ordinal)
            .Select(g => (TenantId: g.Key, Cost: g.Sum(r => r.Cost), Calls: g.Sum(r => r.Calls), Days: g.Count(), Plan: g.MaxBy(r => r.Day)!.Plan ?? AiUsagePlans.Free))
            .OrderByDescending(u => u.Cost).ThenByDescending(u => u.Calls).ThenBy(u => u.TenantId, StringComparer.Ordinal)
            .Take(Math.Clamp(o.TopUsers, 1, 200))
            .ToList();

        var anomalies = new List<(AiUsageDayIndexEntity Row, long? Median, decimal? Multiple, IReadOnlyList<string> Reasons)>();
        foreach (var tenant in index.GroupBy(r => r.TenantId, StringComparer.Ordinal))
        {
            var costByDay = tenant.GroupBy(r => r.Day).ToDictionary(g => g.Key, g => g.Sum(r => r.Cost));
            foreach (var row in tenant.Where(r => r.Day >= from && r.Day <= to))
            {
                var (reasons, median, multiple) = AiUsageMath.Check(row.Day, costByDay, o);
                if (reasons.Count > 0)
                    anomalies.Add((row, median, multiple, reasons));
            }
        }
        anomalies = anomalies.OrderByDescending(a => a.Row.Cost).ThenByDescending(a => a.Row.Day).Take(MaxAnomalies).ToList();

        var identities = await IdentitiesAsync(users.Select(u => u.TenantId).Concat(anomalies.Select(a => a.Row.TenantId)), ct);
        var top = users.Select(u =>
        {
            var who = identities.GetValueOrDefault(u.TenantId);
            return new AiUsageTopUserDto(u.TenantId, who.UserId, who.Email, who.Handle, u.Plan, u.Cost, u.Calls, u.Days);
        }).ToList();
        var flagged = anomalies.Select(a =>
        {
            var who = identities.GetValueOrDefault(a.Row.TenantId);
            return new AiUsageAnomalyDto(AiUsageEntity.DayPeriod(a.Row.Day), a.Row.TenantId, who.UserId, who.Email, who.Handle, a.Row.Plan ?? AiUsagePlans.Free,
                a.Row.Cost, a.Median, a.Multiple, a.Reasons);
        }).ToList();

        return new AdminAiUsageSummaryDto(
            Day(from), Day(to), AiUsageMath.Totals(allSum), AiUsageMath.Totals(AiUsageMath.Sum(admin.Days.Select(r => r.Counters))), dayRows,
            AiUsageMath.Operations(allSum), AiUsageMath.Models(allSum), plans, top, flagged, Rates(),
            new AiUsageThresholdsDto(o.AnomalyMedianMultiplier, o.AnomalyMinHistoryDays, o.AnomalyMinDayUsd, o.AnomalyAbsoluteDayUsd));
    }

    private AiUsageRatesDto Rates() => new(Options.UsdTryRate, Options.NetMonthlyPlanTry, Options.NetYearlyPlanPerMonthTry);

    private static string Day(DateOnly day) => AiUsageEntity.DayPeriod(day);

    /// <summary>The partition's day rows of [from, to] and month rows of the months they touch (one Query).</summary>
    private async Task<(List<AiUsageEntity> Days, List<AiUsageEntity> Months)> RowsAsync(string pk, DateOnly from, DateOnly to, CancellationToken ct)
    {
        var rows = await repository.GetAllAsync<AiUsageEntity>(pk, AiUsageEntity.DaySk(from), SkOperator.GreaterThanOrEqual, ct);
        var lastDay = AiUsageEntity.DaySk(to);
        var days = rows.Where(r => r.Sk.StartsWith("d#", StringComparison.Ordinal) && string.CompareOrdinal(r.Sk, lastDay) <= 0)
            .OrderBy(r => r.Sk, StringComparer.Ordinal).ToList();
        var monthRows = await repository.GetAllAsync<AiUsageEntity>(pk, AiUsageEntity.MonthSk(from), SkOperator.GreaterThanOrEqual, ct);
        var lastMonth = AiUsageEntity.MonthSk(to);
        var months = monthRows.Where(r => r.Sk.StartsWith("m#", StringComparison.Ordinal) && string.CompareOrdinal(r.Sk, lastMonth) <= 0)
            .OrderBy(r => r.Sk, StringComparer.Ordinal).ToList();
        return (days, months);
    }

    private async Task<List<AiUsageDayIndexEntity>> DayIndexAsync(DateOnly from, DateOnly to, CancellationToken ct)
    {
        var found = new ConcurrentBag<AiUsageDayIndexEntity>();
        await Parallel.ForEachAsync(AiUsageMath.Days(from, to), new ParallelOptions { MaxDegreeOfParallelism = Parallelism, CancellationToken = ct }, async (day, token) =>
        {
            foreach (var row in await repository.GetAllAsync<AiUsageDayIndexEntity>(AiUsageDayIndexEntity.GetPk(day), token))
            {
                row.Day = day;
                found.Add(row);
            }
        });
        return found.ToList();
    }

    /// <summary>Masked handle and e-mail per tenant (the owner's account), plus the user id the panel links to.</summary>
    private async Task<Dictionary<string, (string? UserId, string? Email, string? Handle)>> IdentitiesAsync(IEnumerable<string> tenantIds, CancellationToken ct)
    {
        var result = new Dictionary<string, (string?, string?, string?)>(StringComparer.Ordinal);
        foreach (var tenantId in tenantIds.Distinct(StringComparer.Ordinal))
        {
            var tenant = await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(tenantId), ct);
            var user = tenant is null ? null : await repository.GetAsync<UserEntity>(UserEntity.GetPk(), UserEntity.GetSk(tenant.OwnerUserId), ct);
            result[tenantId] = (user?.Id, AiUsageMath.MaskEmail(user?.Email), AiUsageMath.MaskHandle(tenant?.Handle));
        }
        return result;
    }

    /// <summary>The tenant's AI jobs still in the job table (7 days), newest first, with the credits they moved.</summary>
    private async Task<IReadOnlyList<AiUsageJobDto>> RecentJobsAsync(string tenantId, CancellationToken ct)
    {
        var jobs = (await repository.GetAllAsync<JobEntity>(JobEntity.GetPk(tenantId), ct))
            .Where(j => j.Kind is not (JobKind.DataExport or JobKind.AiTrial))
            .OrderByDescending(j => j.CreatedAt).Take(RecentJobs).ToList();
        if (jobs.Count == 0)
            return [];

        var since = jobs.Min(j => j.CreatedAt).AddMinutes(-5);
        var ledger = await repository.GetAllAsync<CreditLedgerEntryEntity>(CreditLedgerEntryEntity.GetPk(tenantId),
            CreditLedgerEntryEntity.GetSk(since, ""), SkOperator.GreaterThanOrEqual, ct);
        var byKey = ledger.Where(e => e.IdempotencyKey is not null).GroupBy(e => e.IdempotencyKey!, StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => (
                Charged: -g.Where(e => e.Kind is CreditLedgerEntryKind.AllowanceReserved or CreditLedgerEntryKind.PackReserved).Sum(e => e.AllowanceDelta + e.PackDelta),
                Refunded: g.Where(e => e.Kind == CreditLedgerEntryKind.Refunded).Sum(e => e.AllowanceDelta + e.PackDelta)), StringComparer.Ordinal);

        return jobs.Select(j =>
        {
            var credit = j.CreditIdempotencyKey is { } key ? byKey.GetValueOrDefault(key) : default;
            var outcome = j.Status switch
            {
                JobStatus.Completed => "completed",
                JobStatus.Failed => credit.Refunded > 0 || j.CreditIdempotencyKey is not null ? "refunded" : "failed",
                _ => "running",
            };
            long? duration = j.Status is JobStatus.Completed or JobStatus.Failed ? (long)(j.UpdatedAt - j.CreatedAt).TotalMilliseconds : null;
            return new AiUsageJobDto(j.Id, j.Kind, outcome, j.Failure, j.AiModels ?? [], duration, j.AiCost?.GetValueOrDefault("total"),
                Math.Max(0, credit.Charged), Math.Max(0, credit.Refunded), j.CreatedAt, j.UpdatedAt);
        }).ToList();
    }
}
