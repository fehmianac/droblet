using Domain.Enum;
using Domain.Services.Ai;

namespace Domain.Services.Styling;

public sealed record CandidateCriteria(
    IReadOnlySet<Season> Seasons,
    Occasion? Occasion,
    int? MaxTempC,
    bool IsTrip,
    int MaxCandidates,
    int HotFromC,
    string? PinnedItemId = null);

/// <summary>
/// Server-side candidate selection (brief §5.4): the model only ever sees — and may only ever reference — this list.
/// Rule-based, cheap and deterministic:
///  1. Beachwear only in summer and Skiwear only in winter, and only for a trip or a matching / unspecified occasion.
///  2. Pieces tagged for one of the target seasons; a slot group that would end up empty keeps all of its pieces
///     (a shoe tagged for the wrong season beats no shoes).
///  3. On a hot day (max ≥ HotFromC) outerwear is left out.
///  4. A pinned piece ("Bununla kombin yap") is always a candidate.
///  5. Cap: least worn first, taken round-robin per slot group so no slot is starved.
/// </summary>
public static class StylistCandidateSelector
{
    public static IReadOnlyList<CandidateItem> Select(IEnumerable<CandidateItem> wardrobe, CandidateCriteria criteria)
    {
        var all = wardrobe.ToList();
        var pinned = criteria.PinnedItemId is null ? null : all.FirstOrDefault(i => i.Id == criteria.PinnedItemId);

        var eligible = all.Where(i => SpecialtyAllowed(i.Category, criteria)).ToList();
        if (criteria.MaxTempC is { } max && max >= criteria.HotFromC)
            eligible = eligible.Where(i => i.Category != ItemCategory.Outerwear).ToList();

        var selected = new List<CandidateItem>();
        foreach (var group in eligible.GroupBy(i => OutfitSlotRules.DefaultSlot(i.Category)))
        {
            var inSeason = group.Where(i => i.Seasons.Any(criteria.Seasons.Contains)).ToList();
            selected.AddRange(inSeason.Count > 0 ? inSeason : group);
        }

        var capped = Cap(selected, Math.Max(1, criteria.MaxCandidates));
        if (pinned is not null && capped.All(i => i.Id != pinned.Id))
        {
            if (capped.Count >= criteria.MaxCandidates && capped.Count > 0)
                capped.RemoveAt(capped.Count - 1);
            capped.Add(pinned);
        }

        return capped.OrderBy(i => i.Id, StringComparer.Ordinal).ToList();
    }

    private static bool SpecialtyAllowed(ItemCategory category, CandidateCriteria criteria) => category switch
    {
        ItemCategory.Beachwear => criteria.Seasons.Contains(Season.Summer)
                                  && (criteria.IsTrip || criteria.Occasion is null or Occasion.Travel or Occasion.Weekend),
        ItemCategory.Skiwear => criteria.Seasons.Contains(Season.Winter)
                                && (criteria.IsTrip || criteria.Occasion is null or Occasion.Travel or Occasion.Sport),
        // Socks are chosen by the user in the look builder (canvas 15′); the stylist does not pick them yet.
        ItemCategory.Socks => false,
        _ => true,
    };

    private static List<CandidateItem> Cap(List<CandidateItem> items, int max)
    {
        if (items.Count <= max)
            return items;

        var queues = items
            .GroupBy(i => OutfitSlotRules.DefaultSlot(i.Category))
            .OrderBy(g => g.Key)
            .Select(g => new Queue<CandidateItem>(LeastWornFirst(g)))
            .ToList();

        var result = new List<CandidateItem>(max);
        while (result.Count < max && queues.Any(q => q.Count > 0))
        {
            foreach (var queue in queues)
            {
                if (result.Count < max && queue.TryDequeue(out var item))
                    result.Add(item);
            }
        }
        return result;
    }

    public static IOrderedEnumerable<CandidateItem> LeastWornFirst(IEnumerable<CandidateItem> items) =>
        items.OrderBy(i => i.WearCount)
            .ThenBy(i => i.LastWornAt ?? "", StringComparer.Ordinal)
            .ThenBy(i => i.Id, StringComparer.Ordinal);
}
