namespace Domain.Services;

public sealed record WearEvent(string Date, IReadOnlyList<string> ItemIds);

public sealed record ItemWearStats(int WearCount, string? LastWornAt);

public sealed record MostWornItem(string ItemId, int Days);

public sealed record WearMonthSummary(int LoggedDays, int TotalWears, IReadOnlyList<MostWornItem> MostWorn);

/// <summary>
/// Wear count and "most worn" are derived only from WearLog events:
/// the same piece on the same calendar day counts once, however many logs mention it; removing a log gives the count back.
/// Item.wearCount / lastWornAt are a cache of Recompute and are written only through these rules.
/// </summary>
public static class WearStatsRules
{
    /// <summary>Pieces of a new log that are not yet counted for that day (the only ones whose counter moves).</summary>
    public static IReadOnlyList<string> NewlyCounted(IEnumerable<string> itemIds, IEnumerable<WearEvent> otherLogsSameDay)
    {
        var already = otherLogsSameDay.SelectMany(l => l.ItemIds).ToHashSet(StringComparer.Ordinal);
        return itemIds.Distinct(StringComparer.Ordinal).Where(id => !already.Contains(id)).ToList();
    }

    public static ItemWearStats Recompute(string itemId, IEnumerable<WearEvent> logs)
    {
        var days = logs.Where(l => l.ItemIds.Contains(itemId)).Select(l => l.Date).Distinct(StringComparer.Ordinal).ToList();
        return new ItemWearStats(days.Count, days.Count == 0 ? null : days.Max(StringComparer.Ordinal));
    }

    /// <summary>yyyy-MM-dd sorts lexicographically, so the later day is the larger string. An old offline log never rewinds it.</summary>
    public static string LaterDay(string? current, string date) =>
        current is null || string.CompareOrdinal(date, current) > 0 ? date : current;

    public static WearMonthSummary Summarize(IEnumerable<WearEvent> monthLogs, int top = 5)
    {
        var perDay = monthLogs
            .GroupBy(l => l.Date, StringComparer.Ordinal)
            .Select(g => g.SelectMany(l => l.ItemIds).Distinct(StringComparer.Ordinal).ToList())
            .ToList();

        var mostWorn = perDay
            .SelectMany(ids => ids)
            .GroupBy(id => id, StringComparer.Ordinal)
            .Select(g => new MostWornItem(g.Key, g.Count()))
            .OrderByDescending(m => m.Days)
            .ThenBy(m => m.ItemId, StringComparer.Ordinal)
            .Take(top)
            .ToList();

        return new WearMonthSummary(perDay.Count, perDay.Sum(ids => ids.Count), mostWorn);
    }
}
