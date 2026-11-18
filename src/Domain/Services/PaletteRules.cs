using System.Security.Cryptography;
using System.Text;
using Domain.Services.Ai;

namespace Domain.Services;

public enum PaletteMatch { Compatible, Incompatible, Neutral, Unmatched }

public sealed record PaletteCompatibility(
    int? Percent,
    int TotalCount,
    int CompatibleCount,
    int NeutralCount,
    int IncompatibleCount,
    IReadOnlyList<string> IncompatibleItemIds,
    int UnmatchedCount = 0);

/// <summary>Palette:NeutralsCountAsCompatible / Palette:NeutralColorIds. Default = the approved rule.</summary>
public sealed record PaletteRuleSettings(bool NeutralsCountAsCompatible, IReadOnlySet<string> NeutralColorIds)
{
    public static readonly PaletteRuleSettings Default = new(true, new HashSet<string>(StringComparer.Ordinal));

    public static PaletteRuleSettings From(Options.PaletteOptions options) => new(
        options.NeutralsCountAsCompatible,
        options.NeutralColorIds.Select(c => c.Trim().ToLowerInvariant()).Where(ColorCatalog.IsKnown).ToHashSet(StringComparer.Ordinal));
}

/// <summary>
/// "Gardırobunun %64'ü paletinle uyumlu" — deterministic, never AI, computed on read and never stored.
/// A piece is judged by its main colour (first colour id):
///   in the season's "avoid" tones      -> Incompatible (listed by "Uyumsuz parçaları gör")
///   in the season's "flattering" tones -> Compatible
///   anything else                      -> Neutral (or, when Palette:NeutralColorIds is set and does not list the
///                                         colour, Unmatched: counted in the total only)
/// Percent = round(100 × (Compatible + Neutral) / Total) while Palette:NeutralsCountAsCompatible is true (the approved
/// default): everything that does not clash counts as compatible, so the percentage and the incompatible list add up
/// to the whole wardrobe. With the setting off only Compatible counts. Pieces without a known colour are skipped.
/// An empty wardrobe has no percentage (null).
/// </summary>
public static class PaletteCompatibilityRules
{
    public static PaletteMatch Classify(string? mainColorId, IReadOnlyCollection<string> flattering, IReadOnlyCollection<string> avoid,
        PaletteRuleSettings? settings = null)
    {
        if (mainColorId is null)
            return PaletteMatch.Neutral;
        if (avoid.Contains(mainColorId))
            return PaletteMatch.Incompatible;
        if (flattering.Contains(mainColorId))
            return PaletteMatch.Compatible;
        var neutrals = (settings ?? PaletteRuleSettings.Default).NeutralColorIds;
        return neutrals.Count == 0 || neutrals.Contains(mainColorId) ? PaletteMatch.Neutral : PaletteMatch.Unmatched;
    }

    public static PaletteCompatibility Evaluate(
        IEnumerable<(string ItemId, string? MainColorId)> items,
        IReadOnlyCollection<string> flattering,
        IReadOnlyCollection<string> avoid,
        PaletteRuleSettings? settings = null)
    {
        settings ??= PaletteRuleSettings.Default;
        int compatible = 0, neutral = 0, unmatched = 0;
        var incompatible = new List<string>();
        foreach (var (itemId, color) in items)
        {
            if (!ColorCatalog.IsKnown(color))
                continue;
            switch (Classify(color, flattering, avoid, settings))
            {
                case PaletteMatch.Compatible: compatible++; break;
                case PaletteMatch.Incompatible: incompatible.Add(itemId); break;
                case PaletteMatch.Unmatched: unmatched++; break;
                default: neutral++; break;
            }
        }

        var total = compatible + neutral + unmatched + incompatible.Count;
        var counted = compatible + (settings.NeutralsCountAsCompatible ? neutral : 0);
        int? percent = total == 0
            ? null
            : (int)Math.Round(100d * counted / total, MidpointRounding.AwayFromZero);
        return new PaletteCompatibility(percent, total, compatible, neutral, incompatible.Count, incompatible, unmatched);
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
