using System.Security.Cryptography;
using System.Text;
using Domain.Services.Ai;

namespace Domain.Services;

public enum PaletteMatch { Compatible, Incompatible, Neutral }

public sealed record PaletteCompatibility(
    int? Percent,
    int TotalCount,
    int CompatibleCount,
    int NeutralCount,
    int IncompatibleCount,
    IReadOnlyList<string> IncompatibleItemIds);

/// <summary>
/// "Gardırobunun %64'ü paletinle uyumlu" — deterministic, never AI, computed on read and never stored.
/// A piece is judged by its main colour (first colour id):
///   in the season's "avoid" tones      -> Incompatible (listed by "Uyumsuz parçaları gör")
///   in the season's "flattering" tones -> Compatible
///   anything else                      -> Neutral
/// Percent = round(100 × (Compatible + Neutral) / Total): everything that does not clash counts as compatible, so the
/// percentage and the incompatible list always add up to the whole wardrobe. Pieces without a known colour are skipped.
/// An empty wardrobe has no percentage (null).
/// </summary>
public static class PaletteCompatibilityRules
{
    public static PaletteMatch Classify(string? mainColorId, IReadOnlyCollection<string> flattering, IReadOnlyCollection<string> avoid)
    {
        if (mainColorId is null)
            return PaletteMatch.Neutral;
        if (avoid.Contains(mainColorId))
            return PaletteMatch.Incompatible;
        return flattering.Contains(mainColorId) ? PaletteMatch.Compatible : PaletteMatch.Neutral;
    }

    public static PaletteCompatibility Evaluate(
        IEnumerable<(string ItemId, string? MainColorId)> items,
        IReadOnlyCollection<string> flattering,
        IReadOnlyCollection<string> avoid)
    {
        int compatible = 0, neutral = 0;
        var incompatible = new List<string>();
        foreach (var (itemId, color) in items)
        {
            if (!ColorCatalog.IsKnown(color))
                continue;
            switch (Classify(color, flattering, avoid))
            {
                case PaletteMatch.Compatible: compatible++; break;
                case PaletteMatch.Incompatible: incompatible.Add(itemId); break;
                default: neutral++; break;
            }
        }

        var total = compatible + neutral + incompatible.Count;
        int? percent = total == 0
            ? null
            : (int)Math.Round(100d * (compatible + neutral) / total, MidpointRounding.AwayFromZero);
        return new PaletteCompatibility(percent, total, compatible, neutral, incompatible.Count, incompatible);
    }
}

public enum PaletteGuardOutcome { Accepted, NoFace, PhotoUnsuitable, Rejected }

public sealed record PaletteGuardResult(PaletteGuardOutcome Outcome, SeasonTypeDefinition? SeasonType = null, bool LowConfidence = false);

/// <summary>
/// Palette worker guard: exactly one face; a refusal is passed on; the season type must be in the fixed table;
/// the model's own colour lists are ignored (colours come from SeasonTypeCatalog) but an answer whose lists
/// contradict each other is rejected as inconsistent. Confidence below the threshold is only ever marked, never raised.
/// </summary>
public static class PaletteOutputGuard
{
    public static PaletteGuardResult Evaluate(PaletteAnalysis analysis, double confidenceThreshold)
    {
        if (analysis.FacesDetected != 1)
            return new PaletteGuardResult(PaletteGuardOutcome.NoFace);
        if (!string.IsNullOrEmpty(analysis.Refusal))
            return new PaletteGuardResult(PaletteGuardOutcome.PhotoUnsuitable);
        if (SeasonTypeCatalog.Find(analysis.SeasonTypeId) is not { } season
            || analysis.FlatteringColorIds.Intersect(analysis.AvoidColorIds).Any())
            return new PaletteGuardResult(PaletteGuardOutcome.Rejected);

        return new PaletteGuardResult(PaletteGuardOutcome.Accepted, season, analysis.Confidence < confidenceThreshold);
    }
}

/// <summary>One renderable piece of a try-on: the tenant's own item or a catalog product.</summary>
public sealed record OutfitPiece(string? ItemId, string? ProductId)
{
    public string Key => ItemId is { Length: > 0 } ? $"i:{ItemId}" : $"p:{ProductId}";
}

/// <summary>
/// "Aynı kombinin görseli önbellekten gelir, ikinci kez kredi düşmez": the cache identity of an outfit is the sorted
/// set of its piece ids — not the look id or its version — so a suggestion, the look it was saved as and the same
/// look planned on a day all share one image and one credit.
/// </summary>
public static class TryOnFingerprint
{
    public static string Of(IEnumerable<OutfitPiece> pieces)
    {
        var canonical = string.Join('|', pieces.Select(p => p.Key).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal));
        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(canonical)))[..32];
    }
}
