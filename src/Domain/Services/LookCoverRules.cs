using System.Security.Cryptography;
using System.Text;
using Domain.Entity;
using Domain.Enum;

namespace Domain.Services;

/// <summary>
/// AI flat-lay cover of a saved look (canvas 21c "Looklar · AI flat-lay kapak", owner decision 2026-11-22). One image per
/// look and set of pieces: rendered once in the background when the look is saved, again only when its pieces (slot item /
/// product ids) change — never for a name, occasion or favourite change, never for an imported look (its own photo is the
/// cover). A failed cover is tried once more for the same pieces, on the look's next save (owner decision 2026-11-22);
/// after that the app keeps its drawn cover until the pieces change.
/// </summary>
public static class LookCoverRules
{
    /// <summary>A Pending request older than this is no longer reported as pending (the app stops waiting; nothing is re-queued).</summary>
    public static readonly TimeSpan PendingTimeout = TimeSpan.FromMinutes(10);

    /// <summary>Imported looks and inspiration looks (their photograph is the cover) never get an AI cover.</summary>
    public static bool IsEligible(LookEntity look) =>
        look.CoverImageKey is null && look.Source is not (LookSource.Import or LookSource.Inspiration) && look.Slots.Count > 0;

    /// <summary>
    /// Stable hash of the look's pieces: the sorted "slot|itemId|productId" refs, SHA-256, 16 lower-case hex chars. The order
    /// the slots were sent in does not matter; anything but the pieces (name, occasion, favourite) is not part of it.
    /// </summary>
    public static string SlotsHash(IEnumerable<LookSlotValue> slots)
    {
        var refs = slots.Select(s => $"{s.Slot}|{s.ItemId}|{s.ProductId}").Order(StringComparer.Ordinal);
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(string.Join('\n', refs)));
        return Convert.ToHexStringLower(hash.AsSpan(0, 8));
    }

    /// <summary>Requests per set of pieces: the first one and, when it failed, one more.</summary>
    public const int MaxAttempts = 2;

    /// <summary>
    /// A cover is requested for pieces it was never requested for, or again when the last request for these pieces failed and
    /// fewer than <see cref="MaxAttempts"/> were made. Pending and ready covers are never requested again.
    /// </summary>
    public static bool NeedsRequest(LookCoverEntity? cover, string slotsHash) =>
        cover is null || cover.SlotsHash != slotsHash || (cover.Status == LookCoverStatus.Failed && Math.Max(1, cover.Attempts) < MaxAttempts);

    /// <summary>The image of exactly these pieces, when one was written (null otherwise: the app draws its own cover).</summary>
    public static string? ReadyImageKey(LookCoverEntity? cover, string slotsHash) =>
        cover is { ImageKey: { } key } && cover.ImageHash == slotsHash ? key : null;

    /// <summary>True while the cover of exactly these pieces is being made (and not for longer than <see cref="PendingTimeout"/>).</summary>
    public static bool IsPending(LookCoverEntity? cover, string slotsHash, DateTime now) =>
        cover is { Status: LookCoverStatus.Pending } && cover.SlotsHash == slotsHash && ReadyImageKey(cover, slotsHash) is null
        && now - cover.RequestedAt < PendingTimeout;
}
