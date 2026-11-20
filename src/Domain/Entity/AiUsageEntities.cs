using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using Domain.Entity.Base;
using Domain.Extensions;

namespace Domain.Entity;

// Durable AI usage counters (admin "AI › Maliyet", user detail "AI kullanımı"). Numbers only: calls, tokens, images,
// estimated micro-USD, outcomes — never a prompt, an answer or an image. Every row is written only by atomic ADDs
// (IRepository.AddCountersOnceAsync) together with a once-per-job marker, so an SQS redelivery never counts twice.

/// <summary>
/// One counter row: a tenant's day (<c>d#yyyy-MM-dd</c>, 400 days) or month (<c>m#yyyy-MM</c>, 3 years), and the same
/// shape for the global (<see cref="AllPk"/>) and per-plan (<see cref="PlanPk"/>) aggregates. Counter attribute names:
/// see <see cref="Services.AiUsageCounters"/> (<c>cost</c>, <c>calls</c>, <c>op|{operation}|{metric}</c>,
/// <c>model|{model}|{metric}</c>, …), read back through <see cref="Counters"/>.
/// </summary>
public class AiUsageEntity : IEntity
{
    public const int DailyRetentionDays = 400;
    public const int MonthlyRetentionDays = 3 * 366;
    /// <summary>The "tenant" of admin AI trials: counted on its own, never per user.</summary>
    public const string AdminTenant = "admin";
    public const string AllPk = "ai#usage#all";

    [JsonPropertyName("pk")] public string Pk { get; set; } = null!;
    [JsonPropertyName("sk")] public string Sk { get; set; } = null!;
    [JsonPropertyName("ttl")] public long Ttl { get; set; }
    /// <summary>Every numeric counter of the row (attribute name → value).</summary>
    [JsonExtensionData] public Dictionary<string, JsonElement>? Extra { get; set; }

    [JsonIgnore]
    public IReadOnlyDictionary<string, long> Counters =>
        Extra?.Where(kv => kv.Value.ValueKind == JsonValueKind.Number)
            .ToDictionary(kv => kv.Key, kv => kv.Value.TryGetInt64(out var v) ? v : (long)kv.Value.GetDouble(), StringComparer.Ordinal)
        ?? new Dictionary<string, long>(StringComparer.Ordinal);

    /// <summary>A tenant's counter rows (tenant partition, deleted with the account); the admin trials have their own.</summary>
    public static string GetPk(string tenantId) => tenantId == AdminTenant ? "ai#usage#admin" : $"tenant#{tenantId}#aiusage";
    public static string PlanPk(string plan) => $"ai#usage#plan#{plan}";
    public static string DaySk(DateOnly day) => "d#" + DayPeriod(day);
    public static string MonthSk(DateOnly day) => "m#" + MonthPeriod(day);

    public static long DayTtl(DateOnly day) => day.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc).AddDays(DailyRetentionDays).ToUnixTimeSeconds();
    public static long MonthTtl(DateOnly day) => new DateOnly(day.Year, day.Month, 1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc).AddDays(MonthlyRetentionDays).ToUnixTimeSeconds();

    /// <summary>"2026-11-20" (day row) or "2026-11" (month row) — also stored, so the data export keeps it without the keys.</summary>
    [JsonPropertyName("period")] public string? Period { get; set; }

    public static string DayPeriod(DateOnly day) => day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    public static string MonthPeriod(DateOnly day) => day.ToString("yyyy-MM", CultureInfo.InvariantCulture);
}

/// <summary>
/// The day's index of users with AI usage (partition per UTC day, one row per tenant: cost, calls, plan): the summary's
/// top users, active users per plan and anomaly rule read a few day partitions instead of scanning every tenant.
/// Removed with the account (AccountDeletionService finds the days through the tenant's own day rows). 400 days.
/// </summary>
public class AiUsageDayIndexEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(Day);
    [JsonPropertyName("sk")] public string Sk => TenantId;

    [JsonPropertyName("day")] public DateOnly Day { get; set; }
    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("plan")] public string? Plan { get; set; }
    [JsonPropertyName("cost")] public long Cost { get; set; }
    [JsonPropertyName("calls")] public long Calls { get; set; }
    [JsonPropertyName("ttl")] public long Ttl { get; set; }

    public static string GetPk(DateOnly day) => "ai#usage#day#" + day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
}

/// <summary>
/// "This job's usage is counted" — written in the same transaction as the counters (attribute_not_exists), so a retry
/// of the same job (SQS redelivery, a backfill replay) adds nothing. Internal bookkeeping; 8 days (jobs live 7).
/// </summary>
public class AiUsageMarkerEntity : IEntity
{
    public const int RetentionDays = JobEntity.RetentionDays + 1;

    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(MarkerId);

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("markerId")] public string MarkerId { get; set; } = null!;
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }

    [JsonPropertyName("ttl")] public long Ttl => CreatedAt.AddDays(RetentionDays).ToUnixTimeSeconds();

    public static string GetPk(string tenantId) => tenantId == AiUsageEntity.AdminTenant ? "ai#usagemark#admin" : $"tenant#{tenantId}#aiusagemark";
    public static string GetSk(string markerId) => markerId;
}
