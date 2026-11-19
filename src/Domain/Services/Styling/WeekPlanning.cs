namespace Domain.Services.Styling;

/// <summary>
/// The week plan in parallel: the dates are split into small contiguous batches, each batch is one model call with the
/// same candidate set, and the merged answer goes through the usual guard (AcceptWeek drops a look that repeats the day
/// before, also across a batch border). <see cref="RepeatedDates"/> is the final rule-based consistency pass: a look that
/// already appeared earlier in the week is replaced when the wardrobe has another one.
/// </summary>
public static class WeekPlanning
{
    /// <summary>
    /// Contiguous batches of at most <paramref name="maxPerBatch"/> dates, as even as possible (7 days by 3 → 3, 2, 2).
    /// maxPerBatch ≤ 0 or ≥ the number of dates = one batch (the old single call).
    /// </summary>
    public static IReadOnlyList<IReadOnlyList<string>> Split(IReadOnlyList<string> dates, int maxPerBatch)
    {
        if (dates.Count == 0)
            return [];
        if (maxPerBatch <= 0 || maxPerBatch >= dates.Count)
            return [dates.ToList()];

        var batches = (dates.Count + maxPerBatch - 1) / maxPerBatch;
        var result = new List<IReadOnlyList<string>>(batches);
        var start = 0;
        for (var b = 0; b < batches; b++)
        {
            var size = dates.Count / batches + (b < dates.Count % batches ? 1 : 0);
            result.Add(dates.Skip(start).Take(size).ToList());
            start += size;
        }
        return result;
    }

    /// <summary>
    /// Merges the batch answers into one week answer: each batch contributes only the days it was asked for (a day the
    /// model added for another date is ignored). Null when no batch answered.
    /// </summary>
    public static ModelWeekOutput? Merge(IEnumerable<(IReadOnlyList<string> Dates, ModelWeekOutput? Output)> batches)
    {
        var answered = batches.Where(b => b.Output is not null).ToList();
        if (answered.Count == 0)
            return null;
        var days = answered.SelectMany(b => (b.Output!.Days ?? []).Where(d => b.Dates.Contains(d.Date, StringComparer.Ordinal))).ToList();
        return new ModelWeekOutput(days, answered.Select(b => b.Output!.Refusal).FirstOrDefault(r => r is not null));
    }

    /// <summary>
    /// Dates (in order) whose accepted look is identical to the look of an earlier date of the week. The first
    /// occurrence keeps its look; consecutive repeats are already removed by AcceptWeek.
    /// </summary>
    public static IReadOnlyList<string> RepeatedDates(IReadOnlyDictionary<string, SuggestedOutfit> accepted, IReadOnlyList<string> dates)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var repeated = new List<string>();
        foreach (var date in dates)
        {
            if (!accepted.TryGetValue(date, out var outfit))
                continue;
            if (!seen.Add(GapFill.RawSignature(outfit)))
                repeated.Add(date);
        }
        return repeated;
    }
}
