using System.Text.Json;
using Domain.Entity;
using Domain.Entity.Base;
using Domain.Enum;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Microsoft.Extensions.Options;

namespace Infrastructure.Services.Integration;

/// <summary>
/// IClosetReader on the real wardrobe partitions (Item / Look / Trip). It performs no authorisation of its own:
/// social code calls it only after PersonContext.CanView (VisibilityPolicy + block rules) allowed the resource, and
/// the store side only ever passes the caller's own tenant id.
/// What leaves here is deliberately narrow:
///   • item image = the cleaned (background-removed) image under the owner's prefix, or the global library / catalog
///     asset — never the original upload, never a try-on image;
///   • looks carry only their existing pieces (a deleted item's slot is dropped);
///   • moderation-hidden looks / items / pieces are flagged (ModerationHidden), not dropped: the owner still reads them
///     through here, and every cross-tenant caller drops them (SocialService.ForViewer).
///   • trips = finished trips as city + month only (no dates, no packing list). Trips stay owner-only (A-6) — that
///     is decided by VisibilityPolicy, not here.
/// </summary>
public sealed class WardrobeClosetReader(
    IRepository repository,
    IItemImageUrls imageUrls,
    TimeProvider timeProvider) : IClosetReader
{
    public async Task<IReadOnlyList<ClosetItem>> GetItemsAsync(string tenantId, CancellationToken ct)
    {
        var items = await repository.GetAllAsync<ItemEntity>(ItemEntity.GetPk(tenantId), ct);
        var result = new List<ClosetItem>(items.Count);
        foreach (var item in items.OrderByDescending(i => i.CreatedAt).ThenByDescending(i => i.Id, StringComparer.Ordinal))
            result.Add(await ToClosetItemAsync(item, ct));
        return result;
    }

    public async Task<IReadOnlyList<ClosetLook>> GetLooksAsync(string tenantId, CancellationToken ct)
    {
        // An inspiration look is an editor photograph the owner kept for themselves, not an outfit of theirs: never shown to others.
        var looks = (await repository.GetAllAsync<LookEntity>(LookEntity.GetPk(tenantId), ct)).Where(l => l.Source != LookSource.Inspiration).ToList();
        if (looks.Count == 0)
            return [];
        var items = await ItemsByIdAsync(tenantId, ct);
        var result = new List<ClosetLook>(looks.Count);
        foreach (var look in looks.OrderByDescending(l => l.CreatedAt).ThenByDescending(l => l.Id, StringComparer.Ordinal))
            result.Add(await ToClosetLookAsync(look, items, ct));
        return result;
    }

    public async Task<ClosetLook?> GetLookAsync(string tenantId, string lookId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(lookId))
            return null;
        var look = await repository.GetAsync<LookEntity>(LookEntity.GetPk(tenantId), LookEntity.GetSk(lookId), ct);
        return look is null || look.Source == LookSource.Inspiration ? null : await ToClosetLookAsync(look, await ItemsByIdAsync(tenantId, ct), ct);
    }

    public async Task<IReadOnlyList<ClosetTrip>> GetCompletedTripsAsync(string tenantId, CancellationToken ct)
    {
        var today = CalendarDay.ToText(DateOnly.FromDateTime(timeProvider.GetUtcNow().UtcDateTime));
        var trips = await repository.GetAllAsync<TripEntity>(TripEntity.GetPk(tenantId), ct);
        return trips
            .Where(t => CalendarDay.IsValid(t.EndDate) && CalendarDay.IsValid(t.StartDate) && string.CompareOrdinal(t.EndDate, today) < 0)
            .OrderByDescending(t => t.EndDate, StringComparer.Ordinal).ThenBy(t => t.Id, StringComparer.Ordinal)
            .Select(t => new ClosetTrip(t.Id, string.IsNullOrWhiteSpace(t.CityName) ? t.CityId : t.CityName, t.StartDate[..7]))
            .ToList();
    }

    private async Task<Dictionary<string, ItemEntity>> ItemsByIdAsync(string tenantId, CancellationToken ct) =>
        (await repository.GetAllAsync<ItemEntity>(ItemEntity.GetPk(tenantId), ct)).ToDictionary(i => i.Id, StringComparer.Ordinal);

    private async Task<ClosetLook> ToClosetLookAsync(LookEntity look, IReadOnlyDictionary<string, ItemEntity> items, CancellationToken ct)
    {
        var pieces = new List<ClosetLookPiece>(look.Slots.Count);
        foreach (var slot in look.Slots.OrderBy(s => s.Slot))
        {
            if (slot.ItemId is not null)
            {
                if (!items.TryGetValue(slot.ItemId, out var item))
                    continue; // deleted piece
                pieces.Add(new ClosetLookPiece(slot.Slot, item.Id, null, item.Name, await ImageUrlAsync(item, ct), item.IsModerationHidden()));
            }
            else if (slot.ProductId is not null)
            {
                pieces.Add(new ClosetLookPiece(slot.Slot, null, slot.ProductId)); // name / image come from the catalog
            }
        }

        var occasion = look.Occasion is { } o ? JsonNamingPolicy.CamelCase.ConvertName(o.ToString()) : null;
        return new ClosetLook(look.Id, look.Name ?? "", occasion, look.CreatedAt, pieces, look.IsModerationHidden());
    }

    private async Task<ClosetItem> ToClosetItemAsync(ItemEntity item, CancellationToken ct) =>
        new(item.Id, item.Name ?? "", item.Category, item.ColorIds, await ImageUrlAsync(item, ct), item.IsModerationHidden());

    /// <summary>The cleaned image at 768 px (public CDN URL once published; presigned otherwise), else the global asset.</summary>
    private async Task<string?> ImageUrlAsync(ItemEntity item, CancellationToken ct) =>
        (await imageUrls.GetForOthersAsync(item, ct)).MediumUrl;
}

/// <summary>Global (non user) assets: a library / catalog image is stored either as a key of the public asset base or as an absolute https URL.</summary>
public static class GlobalAssets
{
    public static string? PublicUrl(string? keyOrUrl, string? baseUrl)
    {
        if (string.IsNullOrWhiteSpace(keyOrUrl))
            return null;
        if (keyOrUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            return keyOrUrl;
        return string.IsNullOrWhiteSpace(baseUrl) ? null : $"{baseUrl.TrimEnd('/')}/{keyOrUrl.TrimStart('/')}";
    }
}
