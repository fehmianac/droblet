using Domain.Enum;
using Domain.Validation;

namespace Ops.Commands.BrandImport;

/// <summary>
/// Which discovered products get their page fetched, and in which order. Pure and deterministic: the same discovery
/// gives the same list, whatever its order. Only candidates whose category hint is in the source's slug table for the
/// segment (unknown hints are skipped); one colour per model; categories take turns (and, inside a category, its
/// slugs take turns) so a run is not 100 dresses; highest (newest) codes first.
/// </summary>
internal static class CandidatePicker
{
    public static IReadOnlyList<SourceCandidate> Pick(IBrandCatalogSource source, CatalogSegment segment, IEnumerable<SourceCandidate> candidates, int limit)
    {
        var bySlug = new Dictionary<string, (int Order, ProductCategory Category)>(StringComparer.Ordinal);
        foreach (var (slug, category) in source.CategorySlugs(segment))
            bySlug.TryAdd(slug, (bySlug.Count, category));

        // One entry per model: the highest code (ordinal) of its colours, whatever the discovery order is.
        var models = candidates
            .Where(c => bySlug.ContainsKey(c.CategoryHint) && StoreInputRules.IsId(source.ProductId(c.Code)))
            .GroupBy(c => c.ModelCode, StringComparer.Ordinal)
            .Select(g => g.OrderByDescending(c => c.Code, StringComparer.Ordinal).ThenBy(c => c.Url, StringComparer.Ordinal).First());

        // category (enum order) → its slugs (table order) → newest code first
        var categories = models
            .GroupBy(c => bySlug[c.CategoryHint].Category)
            .OrderBy(g => g.Key)
            .Select(category => RoundRobin(category
                .GroupBy(c => c.CategoryHint, StringComparer.Ordinal)
                .OrderBy(g => bySlug[g.Key].Order)
                .Select(slug => slug.OrderByDescending(c => c.Code, StringComparer.Ordinal).ThenBy(c => c.Url, StringComparer.Ordinal).ToList())
                .ToList()))
            .ToList();
        return RoundRobin(categories).Take(Math.Max(0, limit)).ToList();
    }

    private static List<T> RoundRobin<T>(IReadOnlyList<List<T>> queues)
    {
        var total = queues.Sum(q => q.Count);
        var result = new List<T>(total);
        for (var round = 0; result.Count < total; round++)
        {
            foreach (var queue in queues)
            {
                if (round < queue.Count)
                    result.Add(queue[round]);
            }
        }
        return result;
    }
}
