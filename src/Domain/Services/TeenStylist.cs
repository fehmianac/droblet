using Domain.Entity;
using Domain.Enum;
using Domain.Options;

namespace Domain.Services;

/// <summary>
/// The Istanbul calendar of the teen stylist allowance (Teen:Stylist): a day starts at 00:00 Europe/Istanbul, a week on
/// Monday 00:00. Keys are the day / the Monday as yyyy-MM-dd. Istanbul has no DST; the fixed +03:00 fallback only matters
/// on a host without tz data.
/// </summary>
public static class TeenStylistCalendar
{
    private static readonly TimeZoneInfo Zone = TimeZoneInfo.TryFindSystemTimeZoneById("Europe/Istanbul", out var zone)
        ? zone
        : TimeZoneInfo.CreateCustomTimeZone("Europe/Istanbul", TimeSpan.FromHours(3), "Istanbul", "Istanbul");

    public static TeenStylistPeriod Of(DateTime nowUtc)
    {
        var local = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(nowUtc, DateTimeKind.Utc), Zone);
        var day = DateOnly.FromDateTime(local);
        var monday = day.AddDays(-(((int)day.DayOfWeek + 6) % 7));
        return new TeenStylistPeriod(Key(day), StartUtc(day.AddDays(1)), Key(monday), StartUtc(monday.AddDays(7)));
    }

    private static string Key(DateOnly day) => day.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);

    private static DateTime StartUtc(DateOnly day) =>
        TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(day.ToDateTime(TimeOnly.MinValue), DateTimeKind.Unspecified), Zone);
}

/// <param name="Day">Istanbul day key (yyyy-MM-dd).</param>
/// <param name="DayResetsAt">Next Istanbul midnight, UTC.</param>
/// <param name="Week">Monday of the Istanbul week (yyyy-MM-dd).</param>
/// <param name="WeekResetsAt">Next Monday 00:00 Istanbul, UTC.</param>
public sealed record TeenStylistPeriod(string Day, DateTime DayResetsAt, string Week, DateTime WeekResetsAt);

/// <summary>A teen's stylist allowance right now: completed jobs of the period plus jobs still holding a slot.</summary>
public sealed record TeenStylistQuota(
    bool Enabled, int DailyLimit, int UsedToday, DateTime ResetsAt, int WeekPlanLimit, int WeekPlanUsed, int TripPackLimit, int TripPackUsed,
    DateTime WeekResetsAt)
{
    /// <summary>A job that was neither completed nor failed within this time (lost in the DLQ) stops holding its slot.</summary>
    public static readonly TimeSpan PendingLifetime = TimeSpan.FromHours(24);

    public static TeenStylistQuota Of(TeenStylistUsageEntity? usage, TeenStylistOptions options, DateTime now)
    {
        var period = TeenStylistCalendar.Of(now);
        var pending = (usage?.Pending ?? []).Where(p => now - p.At < PendingLifetime).ToList();
        int Pending(TeenStylistKind kind, Func<TeenStylistPending, bool> inPeriod) => pending.Count(p => p.Kind == kind && inPeriod(p));

        var outfits = (usage?.Day == period.Day ? usage.OutfitsUsed : 0) + Pending(TeenStylistKind.Outfit, p => p.Day == period.Day);
        var sameWeek = usage?.Week == period.Week;
        var weekPlans = (sameWeek ? usage!.WeekPlansUsed : 0) + Pending(TeenStylistKind.WeekPlan, p => p.Week == period.Week);
        var tripPacks = (sameWeek ? usage!.TripPacksUsed : 0) + Pending(TeenStylistKind.TripPack, p => p.Week == period.Week);
        return new TeenStylistQuota(options.Enabled, Math.Max(0, options.DailyLimit), outfits, period.DayResetsAt,
            Math.Max(0, options.WeekPlanPerWeek), weekPlans, Math.Max(0, options.TripPackPerWeek), tripPacks, period.WeekResetsAt);
    }

    public int Limit(TeenStylistKind kind) => kind switch
    {
        TeenStylistKind.Outfit => DailyLimit,
        TeenStylistKind.WeekPlan => WeekPlanLimit,
        _ => TripPackLimit,
    };

    public int Used(TeenStylistKind kind) => kind switch
    {
        TeenStylistKind.Outfit => UsedToday,
        TeenStylistKind.WeekPlan => WeekPlanUsed,
        _ => TripPackUsed,
    };

    public DateTime ResetsAtOf(TeenStylistKind kind) => kind == TeenStylistKind.Outfit ? ResetsAt : WeekResetsAt;

    public TeenStylistDto ToDto()
    {
        static int Left(int limit, int used) => Math.Max(0, limit - used);
        return new TeenStylistDto(Enabled, DailyLimit, Math.Min(UsedToday, DailyLimit), Enabled ? Left(DailyLimit, UsedToday) : 0, ResetsAt,
            WeekPlanLimit, Math.Min(WeekPlanUsed, WeekPlanLimit), Enabled ? Left(WeekPlanLimit, WeekPlanUsed) : 0, WeekResetsAt,
            TripPackLimit, Math.Min(TripPackUsed, TripPackLimit), Enabled ? Left(TripPackLimit, TripPackUsed) : 0);
    }
}

/// <summary>
/// teen.stylist of GET v1/tenant/teen (docs/api/teen.md §4.2). enabled = Teen:Stylist:Enabled; a limit of 0 = that
/// capability is off for teens. resetsAt = next Istanbul midnight, weekResetsAt = next Monday 00:00 Istanbul (UTC).
/// </summary>
public sealed record TeenStylistDto(
    bool Enabled,
    int DailyLimit, int UsedToday, int RemainingToday, DateTime ResetsAt,
    int WeekPlanLimit, int WeekPlanUsed, int WeekPlanRemaining, DateTime WeekResetsAt,
    int TripPackLimit, int TripPackUsed, int TripPackRemaining);

/// <summary>
/// The gate of every stylist job start (outfit, week plan, trip packing). Adults and members: EntitlementPolicy.Check as
/// before. Teen on the free tier: EntitlementPolicy.CheckTeenStylist, and when allowed a slot is reserved for the job in the
/// same conditional write. The worker commits it when the job completes and releases it when the job fails, so a failed
/// job never costs the teen a suggestion. Every call is idempotent per job id.
/// </summary>
public interface IStylistAllowanceService
{
    Task<EntitlementDecision> ReserveAsync(string tenantId, string jobId, TeenStylistKind kind, CancellationToken ct);
    Task CommitAsync(string tenantId, string jobId, CancellationToken ct);
    Task ReleaseAsync(string tenantId, string jobId, CancellationToken ct);
}
