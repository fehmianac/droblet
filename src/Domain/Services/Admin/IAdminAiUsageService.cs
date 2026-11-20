using Domain.Entity;
using Domain.Enum;
using Domain.Options;

namespace Domain.Services.Admin;

// ── AI usage and cost (admin "AI › Maliyet", user detail "AI kullanımı"; permission ai.usage.view; docs/api/admin.md §5c) ──
// All money is estimated micro-USD from Ai:Pricing (the provider's own invoice is the truth). Numbers only.

public sealed record AiUsageTotalsDto(
    long Jobs, long Completed, long Failed, long Refunded, long Calls, long CallErrors,
    long InputTokens, long OutputTokens, long CachedTokens, long Images, long CostMicroUsd);

public sealed record AiUsageOperationDto(
    string Operation, long Jobs, long Failed, long Calls, long InputTokens, long OutputTokens, long CachedTokens, long Images, long CostMicroUsd);

public sealed record AiUsageModelDto(string Model, long Calls, long InputTokens, long OutputTokens, long CachedTokens, long Images, long CostMicroUsd);

/// <param name="Period">yyyy-MM-dd (day) or yyyy-MM (month).</param>
public sealed record AiUsagePeriodDto(string Period, AiUsageTotalsDto Totals, IReadOnlyList<AiUsageOperationDto> Operations);

/// <param name="Outcome">completed | failed | refunded | running.</param>
/// <param name="CreditsCharged">Credits reserved for the job (allowance + pack); 0 for AI without credits.</param>
public sealed record AiUsageJobDto(
    string Id, JobKind Kind, string Outcome, JobFailure? Failure, IReadOnlyList<string> Models, long? DurationMs, long? CostMicroUsd,
    int CreditsCharged, int CreditsRefunded, DateTime CreatedAt, DateTime UpdatedAt);

public sealed record AiUsageRatesDto(decimal UsdTry, decimal NetMonthlyPlanTry, decimal NetYearlyPlanPerMonthTry);

public sealed record AdminUserAiUsageDto(
    string UserId, string TenantId, string From, string To, string Plan, AdminAppUserCredits Credits,
    AiUsageTotalsDto Totals, IReadOnlyList<AiUsageOperationDto> Operations, IReadOnlyList<AiUsageModelDto> Models,
    IReadOnlyList<AiUsagePeriodDto> Days, IReadOnlyList<AiUsagePeriodDto> Months, IReadOnlyList<AiUsageJobDto> RecentJobs, AiUsageRatesDto Rates);

public sealed record AiUsageDayDto(string Day, long CostMicroUsd, long Calls, long Jobs, long Failed);

/// <param name="CostPerActiveUserPer30DaysMicroUsd">Cost per active user scaled to 30 days (range length).</param>
/// <param name="ShareOfMonthlyNet">That 30-day cost in ₺ / the monthly plan's net ₺ (premium only; 0.63 = 63%).</param>
public sealed record AiUsagePlanDto(
    string Plan, int ActiveUsers, AiUsageTotalsDto Totals, long CostPerActiveUserMicroUsd, long CostPerActiveUserPer30DaysMicroUsd,
    decimal? ShareOfMonthlyNet, decimal? ShareOfYearlyNet);

/// <param name="Email">Masked (a***@g***.com); the full identity is on the user detail (users.read).</param>
public sealed record AiUsageTopUserDto(
    string TenantId, string? UserId, string? Email, string? Handle, string Plan, long CostMicroUsd, long Calls, int ActiveDays);

/// <param name="Reasons">median (above X× the user's 30-day median) and / or absolute (above the daily threshold).</param>
public sealed record AiUsageAnomalyDto(
    string Day, string TenantId, string? UserId, string? Email, string? Handle, string Plan, long CostMicroUsd, long? MedianMicroUsd,
    decimal? Multiple, IReadOnlyList<string> Reasons);

public sealed record AiUsageThresholdsDto(decimal MedianMultiplier, int MinHistoryDays, decimal MinDayUsd, decimal AbsoluteDayUsd);

public sealed record AdminAiUsageSummaryDto(
    string From, string To, AiUsageTotalsDto Totals, AiUsageTotalsDto Admin, IReadOnlyList<AiUsageDayDto> Days,
    IReadOnlyList<AiUsageOperationDto> Operations, IReadOnlyList<AiUsageModelDto> Models, IReadOnlyList<AiUsagePlanDto> Plans,
    IReadOnlyList<AiUsageTopUserDto> TopUsers, IReadOnlyList<AiUsageAnomalyDto> Anomalies, AiUsageRatesDto Rates, AiUsageThresholdsDto Thresholds);

public interface IAdminAiUsageService
{
    /// <summary>One user's usage (audited as user.ai_usage_view). Null when the user does not exist.</summary>
    Task<AdminUserAiUsageDto?> GetUserUsageAsync(AdminUserEntity actor, string userId, DateOnly from, DateOnly to, string? ip, CancellationToken ct);
    Task<AdminAiUsageSummaryDto> GetSummaryAsync(DateOnly from, DateOnly to, CancellationToken ct);
}

/// <summary>Pure maths of the usage views: counter rows → totals / tables, plan margins, the anomaly rule, masking.</summary>
public static class AiUsageMath
{
    public static Dictionary<string, long> Sum(IEnumerable<IReadOnlyDictionary<string, long>> rows)
    {
        var sum = new Dictionary<string, long>(StringComparer.Ordinal);
        foreach (var row in rows)
            foreach (var (key, value) in row)
                sum[key] = sum.GetValueOrDefault(key) + value;
        return sum;
    }

    public static AiUsageTotalsDto Totals(IReadOnlyDictionary<string, long> c) => new(
        c.GetValueOrDefault(AiUsageCounters.Jobs), c.GetValueOrDefault(AiUsageCounters.Completed), c.GetValueOrDefault(AiUsageCounters.Failed),
        c.GetValueOrDefault(AiUsageCounters.Refunded), c.GetValueOrDefault(AiUsageCounters.Calls), c.GetValueOrDefault(AiUsageCounters.CallErrors),
        c.GetValueOrDefault(AiUsageCounters.Input), c.GetValueOrDefault(AiUsageCounters.Output), c.GetValueOrDefault(AiUsageCounters.Cached),
        c.GetValueOrDefault(AiUsageCounters.Images), c.GetValueOrDefault(AiUsageCounters.Cost));

    /// <summary>"op|{op}|{metric}" counters → one row per operation, most expensive first.</summary>
    public static IReadOnlyList<AiUsageOperationDto> Operations(IReadOnlyDictionary<string, long> c) =>
        Group(c, AiUsageCounters.OperationPrefix)
            .Select(g => new AiUsageOperationDto(g.Key, g.Value.GetValueOrDefault(AiUsageCounters.Jobs), g.Value.GetValueOrDefault(AiUsageCounters.Failed),
                g.Value.GetValueOrDefault(AiUsageCounters.Calls), g.Value.GetValueOrDefault(AiUsageCounters.Input), g.Value.GetValueOrDefault(AiUsageCounters.Output),
                g.Value.GetValueOrDefault(AiUsageCounters.Cached), g.Value.GetValueOrDefault(AiUsageCounters.Images), g.Value.GetValueOrDefault(AiUsageCounters.Cost)))
            .OrderByDescending(o => o.CostMicroUsd).ThenByDescending(o => o.Calls).ThenBy(o => o.Operation, StringComparer.Ordinal)
            .ToList();

    public static IReadOnlyList<AiUsageModelDto> Models(IReadOnlyDictionary<string, long> c) =>
        Group(c, AiUsageCounters.ModelPrefix)
            .Select(g => new AiUsageModelDto(g.Key, g.Value.GetValueOrDefault(AiUsageCounters.Calls), g.Value.GetValueOrDefault(AiUsageCounters.Input),
                g.Value.GetValueOrDefault(AiUsageCounters.Output), g.Value.GetValueOrDefault(AiUsageCounters.Cached), g.Value.GetValueOrDefault(AiUsageCounters.Images),
                g.Value.GetValueOrDefault(AiUsageCounters.Cost)))
            .OrderByDescending(m => m.CostMicroUsd).ThenByDescending(m => m.Calls).ThenBy(m => m.Model, StringComparer.Ordinal)
            .ToList();

    private static Dictionary<string, Dictionary<string, long>> Group(IReadOnlyDictionary<string, long> c, string prefix)
    {
        var groups = new Dictionary<string, Dictionary<string, long>>(StringComparer.Ordinal);
        foreach (var (key, value) in c)
        {
            if (!key.StartsWith(prefix, StringComparison.Ordinal))
                continue;
            var rest = key[prefix.Length..];
            var cut = rest.LastIndexOf(AiUsageCounters.Separator);
            if (cut <= 0)
                continue;
            var name = rest[..cut];
            if (!groups.TryGetValue(name, out var metrics))
                groups[name] = metrics = new Dictionary<string, long>(StringComparer.Ordinal);
            metrics[rest[(cut + 1)..]] = metrics.GetValueOrDefault(rest[(cut + 1)..]) + value;
        }
        return groups;
    }

    public static AiUsagePeriodDto Period(string period, IReadOnlyDictionary<string, long> c) => new(period, Totals(c), Operations(c));

    /// <summary>
    /// Margin per plan: cost per active user over the range, scaled to 30 days, and (premium only) its share of the
    /// net monthly price of the monthly and of the yearly plan (USD × the configured USD/TRY rate). Free earns nothing.
    /// </summary>
    public static AiUsagePlanDto Plan(string plan, int activeUsers, IReadOnlyDictionary<string, long> counters, int rangeDays, AiUsageOptions options)
    {
        var totals = Totals(counters);
        var perUser = activeUsers > 0 ? totals.CostMicroUsd / activeUsers : 0;
        var per30 = rangeDays > 0 ? (long)Math.Round(perUser * 30m / rangeDays, MidpointRounding.AwayFromZero) : 0;
        decimal? Share(decimal netTry) =>
            plan == AiUsagePlans.Premium && activeUsers > 0 && netTry > 0
                ? Math.Round(per30 / AiCost.PerMillion * options.UsdTryRate / netTry, 4)
                : null;
        return new AiUsagePlanDto(plan, activeUsers, totals, perUser, per30, Share(options.NetMonthlyPlanTry), Share(options.NetYearlyPlanPerMonthTry));
    }

    public static long? Median(IReadOnlyCollection<long> values)
    {
        if (values.Count == 0)
            return null;
        var sorted = values.OrderBy(v => v).ToList();
        var mid = sorted.Count / 2;
        return sorted.Count % 2 == 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }

    public const string ReasonMedian = "median";
    public const string ReasonAbsolute = "absolute";

    /// <summary>
    /// The anomaly rule for one user's day: above AnomalyMedianMultiplier × the median of the user's previous 30 days
    /// with usage (needs AnomalyMinHistoryDays such days and a day of at least AnomalyMinDayUsd), or above
    /// AnomalyAbsoluteDayUsd. <paramref name="costByDay"/> = the user's daily micro-USD (days without usage absent).
    /// </summary>
    public static (IReadOnlyList<string> Reasons, long? Median, decimal? Multiple) Check(DateOnly day, IReadOnlyDictionary<DateOnly, long> costByDay, AiUsageOptions options)
    {
        var cost = costByDay.GetValueOrDefault(day);
        var history = Enumerable.Range(1, 30).Select(i => day.AddDays(-i))
            .Select(d => costByDay.GetValueOrDefault(d)).Where(v => v > 0).ToList();
        var median = history.Count >= Math.Max(1, options.AnomalyMinHistoryDays) ? Median(history) : null;
        decimal? multiple = median is > 0 ? Math.Round((decimal)cost / median.Value, 2) : null;
        var reasons = new List<string>();
        if (multiple is { } m && m > options.AnomalyMedianMultiplier && cost >= AiCost.Micro(options.AnomalyMinDayUsd))
            reasons.Add(ReasonMedian);
        if (options.AnomalyAbsoluteDayUsd > 0 && cost > AiCost.Micro(options.AnomalyAbsoluteDayUsd))
            reasons.Add(ReasonAbsolute);
        return (reasons, median, multiple);
    }

    /// <summary>"ayse.k@gmail.com" → "a***@g***.com" (first letter, first letter of the domain, the top-level domain).</summary>
    public static string? MaskEmail(string? email)
    {
        if (string.IsNullOrWhiteSpace(email))
            return null;
        var at = email.IndexOf('@');
        if (at <= 0 || at == email.Length - 1)
            return email[..1] + "***";
        var domain = email[(at + 1)..];
        var dot = domain.LastIndexOf('.');
        var tld = dot > 0 ? domain[dot..] : "";
        return $"{email[0]}***@{domain[0]}***{tld}";
    }

    /// <summary>"aysekaya" → "ay***" (one letter for handles of up to 3 characters).</summary>
    public static string? MaskHandle(string? handle)
    {
        if (string.IsNullOrWhiteSpace(handle))
            return null;
        return (handle.Length <= 3 ? handle[..1] : handle[..2]) + "***";
    }

    /// <summary>Every day of [from, to].</summary>
    public static IEnumerable<DateOnly> Days(DateOnly from, DateOnly to)
    {
        for (var d = from; d <= to; d = d.AddDays(1))
            yield return d;
    }
}
