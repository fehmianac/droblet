using System.Globalization;
using System.Text;
using Domain.Entity;
using Domain.Entity.Base;
using Domain.Enum;
using Domain.Extensions;
using Domain.Manager;
using Domain.Services;

namespace Infrastructure.Services;

/// <summary>
/// The in-app inbox (Bildirimler). One partition per tenant, bounded by the 90-day TTL (a few hundred rows at most), so a
/// page is read from the whole partition and ordered by time; the page token is a (createdAt, id) cursor, so new rows
/// arriving between two pages never shift or repeat items.
/// </summary>
public sealed class NotificationInboxService(IRepository repository, TimeProvider timeProvider) : INotificationInbox
{
    public const int DefaultLimit = 30;
    public const int MaxLimit = 100;

    public async Task<bool> AddAsync(string tenantId, NotificationType type, string key, IReadOnlyDictionary<string, string> data, DateTime now, CancellationToken ct)
    {
        var row = new NotificationInboxEntity
        {
            Id = Ulid.New(now),
            TenantId = tenantId,
            Type = type,
            Key = key,
            Data = new Dictionary<string, string>(data),
            CreatedAt = now,
        };
        // Create-only: a retried run (push not delivered, next slot) keeps the first row and its read state.
        var result = await repository.TransactWriteAsync([TransactWriteOperation.Create(row)], ct);
        return result.Applied;
    }

    public async Task<InboxPageDto> GetPageAsync(string tenantId, string? pageToken, int limit, CancellationToken ct)
    {
        limit = limit <= 0 ? DefaultLimit : Math.Min(limit, MaxLimit);
        var rows = await LiveRowsAsync(tenantId, ct);
        var unread = rows.Count(r => r.ReadAt is null);

        IEnumerable<NotificationInboxEntity> ordered = rows;
        if (DecodeCursor(pageToken) is { } cursor)
            ordered = ordered.Where(r => Compare(r, cursor) < 0);
        var page = ordered.Take(limit + 1).ToList();
        var more = page.Count > limit;
        if (more)
            page.RemoveAt(page.Count - 1);

        return new InboxPageDto(
            page.Select(ToDto).ToList(),
            more ? EncodeCursor(page[^1]) : null,
            unread);
    }

    public async Task<InboxReadResultDto> MarkReadAsync(string tenantId, IReadOnlyCollection<string>? ids, CancellationToken ct)
    {
        var rows = await LiveRowsAsync(tenantId, ct);
        var wanted = ids is null ? null : new HashSet<string>(ids, StringComparer.Ordinal);
        var now = timeProvider.GetUtcNow().UtcDateTime;
        var changed = new List<IEntity>();
        foreach (var row in rows.Where(r => r.ReadAt is null && (wanted is null || wanted.Contains(r.Id))))
        {
            row.ReadAt = now;
            changed.Add(row);
        }
        if (changed.Count > 0)
            await repository.BatchWriteAsync(changed, ct);
        return new InboxReadResultDto(rows.Count(r => r.ReadAt is null));
    }

    /// <summary>Newest first; rows past their TTL (DynamoDB removes them lazily) are left out.</summary>
    private async Task<List<NotificationInboxEntity>> LiveRowsAsync(string tenantId, CancellationToken ct)
    {
        var nowSeconds = timeProvider.GetUtcNow().UtcDateTime.ToUnixTimeSeconds();
        return (await repository.GetAllAsync<NotificationInboxEntity>(NotificationInboxEntity.GetPk(tenantId), ct))
            .Where(r => r.Ttl > nowSeconds)
            .OrderByDescending(r => r.CreatedAt)
            .ThenByDescending(r => r.Id, StringComparer.Ordinal)
            .ToList();
    }

    private static InboxNotificationDto ToDto(NotificationInboxEntity row) =>
        new(row.Id, NotificationCodes.Code(row.Type), row.CreatedAt, row.ReadAt, row.Data);

    private sealed record Cursor(long Ticks, string Id);

    /// <summary>Negative when <paramref name="row"/> sorts after (is older than) the cursor.</summary>
    private static int Compare(NotificationInboxEntity row, Cursor cursor)
    {
        var byTime = row.CreatedAt.Ticks.CompareTo(cursor.Ticks);
        return byTime != 0 ? byTime : string.CompareOrdinal(row.Id, cursor.Id);
    }

    private static string EncodeCursor(NotificationInboxEntity row) =>
        Convert.ToBase64String(Encoding.UTF8.GetBytes($"{row.CreatedAt.Ticks.ToString(CultureInfo.InvariantCulture)}.{row.Id}"))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static Cursor? DecodeCursor(string? token)
    {
        if (string.IsNullOrWhiteSpace(token) || token.Length > 200)
            return null;
        try
        {
            var base64 = token.Replace('-', '+').Replace('_', '/');
            base64 = base64.PadRight(base64.Length + (4 - base64.Length % 4) % 4, '=');
            var text = Encoding.UTF8.GetString(Convert.FromBase64String(base64));
            var dot = text.IndexOf('.', StringComparison.Ordinal);
            return dot > 0 && long.TryParse(text[..dot], NumberStyles.None, CultureInfo.InvariantCulture, out var ticks) && Ulid.IsValid(text[(dot + 1)..])
                ? new Cursor(ticks, text[(dot + 1)..])
                : null;
        }
        catch (FormatException)
        {
            return null;
        }
    }
}

/// <summary>Wire codes of the notification types (push `data.type` and the inbox `type`).</summary>
public static class NotificationCodes
{
    public static string Code(NotificationType type) => type switch
    {
        NotificationType.MorningOutfit => "morning_outfit",
        NotificationType.WeeklyEdit => "weekly_edit",
        NotificationType.PriceDrop => "price_drop",
        NotificationType.FollowRequest => "follow_request",
        NotificationType.DataExportReady => "data_export_ready",
        _ => "friend_ratings",
    };
}
