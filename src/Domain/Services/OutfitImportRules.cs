using Domain.Entity;
using Domain.Enum;
using Domain.Services.Ai;

namespace Domain.Services;

/// <summary>A piece that can be compared with an import crop: a wardrobe item or a new piece found earlier in the session.</summary>
public sealed record MatchCandidate(string Id, bool IsSessionPiece, ItemCategory Category, string? Subcategory, IReadOnlyList<string> ColorIds, string ImageKey, DateTime CreatedAt);

/// <summary>Wire state of a session, derived from its photos (the stored row only knows open / committed).</summary>
public enum OutfitImportPhase { Uploading, Processing, Ready, Failed, Committed }

/// <summary>
/// Pure rules of "Kombinlerini içe aktar": the attribute shortlist before the one vision match call per piece (stage B),
/// the look slots of a photo's pieces (stage D), and the session phase shown to the app.
/// </summary>
public static class OutfitImportRules
{
    /// <summary>Pieces kept per photo (the detection guard's cap applies first).</summary>
    public const int MaxPiecesPerPhoto = 8;

    /// <summary>
    /// Up to <paramref name="k"/> candidates worth one vision comparison: same category; a different known sub-type (jeans vs
    /// skirt) or no shared colour at all rules a candidate out. Ranked by colour agreement (same main colour first), then
    /// sub-type agreement, then the session's own new pieces (the same photo series), then the newest. Empty = the piece is
    /// new without a model call.
    /// </summary>
    public static IReadOnlyList<MatchCandidate> Shortlist(ItemCategory category, string? subcategory, IReadOnlyList<string> colorIds,
        IEnumerable<MatchCandidate> candidates, int k)
    {
        if (k <= 0)
            return [];
        return candidates
            .Where(c => c.Category == category)
            .Where(c => subcategory is null || c.Subcategory is null || c.Subcategory == subcategory)
            .Select(c => (Candidate: c, Score: ColourScore(colorIds, c.ColorIds)))
            .Where(x => x.Score >= 0)
            .OrderByDescending(x => x.Score)
            .ThenByDescending(x => subcategory is not null && x.Candidate.Subcategory == subcategory)
            .ThenByDescending(x => x.Candidate.IsSessionPiece)
            .ThenByDescending(x => x.Candidate.CreatedAt)
            .ThenBy(x => x.Candidate.Id, StringComparer.Ordinal)
            .Take(k)
            .Select(x => x.Candidate)
            .ToList();
    }

    /// <summary>3 = same main colour, 1 = some shared colour, 0 = a side has no colour (unknown), -1 = no colour in common.</summary>
    public static int ColourScore(IReadOnlyList<string> a, IReadOnlyList<string> b)
    {
        if (a.Count == 0 || b.Count == 0)
            return 0;
        if (a[0] == b[0])
            return 3;
        return a.Intersect(b, StringComparer.Ordinal).Any() ? 1 : -1;
    }

    /// <summary>
    /// The look of one photo: one piece per slot (the category's default slot), the most confident piece winning a slot; a
    /// dress takes the top slot and closes the bottom one. The other pieces get no slot (saved as wardrobe items only).
    /// </summary>
    /// <param name="categoryOf">The category that decides the slot: the matched wardrobe item's, else the detected one.</param>
    public static void AssignSlots(IReadOnlyList<OutfitImportOccurrence> pieces, Func<OutfitImportOccurrence, ItemCategory> categoryOf)
    {
        foreach (var piece in pieces)
            piece.Slot = null;
        var taken = new HashSet<OutfitSlot>();
        var ordered = pieces
            .OrderByDescending(p => categoryOf(p) == ItemCategory.Dress) // a dress decides top / bottom first
            .ThenByDescending(p => p.Confidence)
            .ThenBy(p => p.Ref, StringComparer.Ordinal);
        foreach (var piece in ordered)
        {
            var category = categoryOf(piece);
            var slot = OutfitSlotRules.DefaultSlot(category);
            if (taken.Contains(slot) || !OutfitSlotRules.Accepts(slot, category))
                continue;
            taken.Add(slot);
            piece.Slot = slot;
            if (category == ItemCategory.Dress && slot == OutfitSlot.Top)
                taken.Add(OutfitSlot.Bottom);
        }
    }

    /// <summary>Photos still being uploaded / processed decide the phase; a committed session is committed.</summary>
    public static OutfitImportPhase Phase(OutfitImportStatus status, IReadOnlyCollection<OutfitImportPhotoStatus> photos)
    {
        if (status == OutfitImportStatus.Committed)
            return OutfitImportPhase.Committed;
        var inFlight = photos.Count(p => p is OutfitImportPhotoStatus.Uploaded or OutfitImportPhotoStatus.Detected);
        var ready = photos.Count(p => p == OutfitImportPhotoStatus.Ready);
        var failed = photos.Count(p => p == OutfitImportPhotoStatus.Failed);
        var pending = photos.Count(p => p == OutfitImportPhotoStatus.Pending);
        if (inFlight > 0)
            return OutfitImportPhase.Processing;
        if (ready > 0)
            return OutfitImportPhase.Ready;
        if (pending > 0)
            return OutfitImportPhase.Uploading;
        return failed > 0 ? OutfitImportPhase.Failed : OutfitImportPhase.Uploading;
    }

    /// <summary>Commit is possible once nothing is in flight and at least one photo has a look draft (photos never uploaded are dropped).</summary>
    public static bool CanCommit(OutfitImportPhase phase) => phase == OutfitImportPhase.Ready;

    /// <summary>Seasons of a new item (at least one): the detected ones, else all four.</summary>
    public static IReadOnlyList<Season> SeasonsOrAll(IReadOnlyList<Season> seasons) =>
        seasons.Count > 0 ? seasons.Distinct().ToList() : System.Enum.GetValues<Season>();

    /// <summary>Rate-limit back-off before the photo is tried again: base × 2^n, capped.</summary>
    public static TimeSpan Backoff(int backoffs, int baseSeconds, int maxSeconds) =>
        TimeSpan.FromSeconds(Math.Min(Math.Max(1, maxSeconds), Math.Max(1, baseSeconds) * Math.Pow(2, Math.Clamp(backoffs, 0, 16))));

    /// <summary>Leases still holding (not expired), without the given holder.</summary>
    public static List<OutfitImportLease> Live(IEnumerable<OutfitImportLease> leases, DateTime now, string? except = null) =>
        leases.Where(l => l.Until > now && l.Holder != except).ToList();
}
