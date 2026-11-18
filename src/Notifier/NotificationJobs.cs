using Domain.Entity;
using Domain.Enum;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Notifier;

public enum NotificationJob { Reminder, WeeklyEdit, FriendRatings, Lifecycle }

public sealed record NotificationRunResult(NotificationJob Job, DateTime ScheduledAt, int Candidates, int Sent);

public interface INotificationJobs
{
    Task<NotificationRunResult> RunAsync(NotificationJob job, DateTime scheduledAtUtc, CancellationToken ct);
}

/// <summary>
/// Scheduled notifications, driven by the preference / device records of E11:
/// • Reminder (every 15 min): tenants whose LOCAL morning time is this slot and who have an outfit for today
///   (IMorningOutfitCheck — the plan slice: a look planned for the user's local day).
/// • WeeklyEdit (weekly): subscribers, once per published edit of the current week.
/// • FriendRatings (daily): subscribers whose looks were rated today, one digest per day.
/// • Lifecycle: subscription expiry belongs to the entitlement slice — nothing to send here yet.
/// • Outbox (with every Reminder run, i.e. every 15 min): event pushes queued by the Api — follow requests (decision 8) and
///   watch-list price drops (decision 9) — sent when the type is switched on and the reason still exists; then the
///   watch-list auto-add pass (decision 10) for checkout clicks that saw no conversion in time.
/// A notification goes out only when there is something to do, at most once per key (NotificationSentEntity),
/// in the recipient's profile language; an UNREGISTERED token is deleted on the spot. No photos, no personal text.
/// Every handled event is also written to the in-app inbox (INotificationInbox, 90 days) — with or without a device.
/// The weekly edit and price drops are marketing (legal consent 5): neither the push nor the inbox row without a valid
/// marketingNotifications consent. Follow requests and the ratings digest reach the inbox even with their push switched off.
/// </summary>
public sealed class NotificationJobs(
    IRepository repository,
    IPushProvider push,
    IMorningOutfitCheck morningOutfit,
    IOptionsMonitor<LocalizationOptions> localization,
    IWatchListAutoAdd watchListAutoAdd,
    INotificationInbox inbox,
    IConsentService consents,
    ILogger<NotificationJobs> logger) : INotificationJobs
{
    private const int PageSize = 100;

    public async Task<NotificationRunResult> RunAsync(NotificationJob job, DateTime scheduledAtUtc, CancellationToken ct)
    {
        var (candidates, sent) = job switch
        {
            NotificationJob.Reminder => await RunReminderAsync(scheduledAtUtc, ct),
            NotificationJob.WeeklyEdit => await RunWeeklyEditAsync(scheduledAtUtc, ct),
            NotificationJob.FriendRatings => await RunFriendRatingsAsync(scheduledAtUtc, ct),
            _ => (0, 0),
        };

        if (job == NotificationJob.Reminder)
        {
            var (queued, delivered) = await RunOutboxAsync(scheduledAtUtc, ct);
            var added = await watchListAutoAdd.RunAsync(scheduledAtUtc, ct);
            logger.LogInformation("Notifier outbox at {ScheduledAt:o}: {Queued} queued, {Sent} sent; watch-list auto-add: {Added} products",
                scheduledAtUtc, queued, delivered, added);
        }

        var result = new NotificationRunResult(job, scheduledAtUtc, candidates, sent);
        logger.LogInformation("Notifier {Job} at {ScheduledAt:o}: {Candidates} candidates, {Sent} sent", job, scheduledAtUtc, result.Candidates, result.Sent);
        return result;
    }

    private async Task<(int, int)> RunReminderAsync(DateTime now, CancellationToken ct)
    {
        int candidates = 0, sent = 0;
        foreach (var slot in ReminderRules.LocalSlotsNow(now))
        {
            foreach (var row in await repository.GetAllAsync<ReminderSlotEntity>(ReminderSlotEntity.GetPk(slot), ct))
            {
                if (!ReminderRules.IsDueNow(row.LocalTime, row.TimeZone, now))
                    continue; // same wall-clock slot, different zone
                candidates++;
                var localDay = ReminderRules.LocalDay(row.TimeZone, now);
                if (!await morningOutfit.HasOutfitForTodayAsync(row.SubscriberTenantId, localDay, ct))
                    continue; // nothing to do today → no notification
                await inbox.AddAsync(row.SubscriberTenantId, NotificationType.MorningOutfit, localDay, new Dictionary<string, string> { ["day"] = localDay }, now, ct);
                if (await SendOnceAsync(row.SubscriberTenantId, NotificationType.MorningOutfit, localDay, new() { ["day"] = localDay }, now, ct))
                    sent++;
            }
        }
        return (candidates, sent);
    }

    private async Task<(int, int)> RunWeeklyEditAsync(DateTime now, CancellationToken ct)
    {
        var today = DateOnly.FromDateTime(now);
        var edits = await repository.GetAllAsync<WeeklyEditEntity>(WeeklyEditEntity.GetPk(), ct);
        var edit = WeeklyEditRules.PickCurrent(edits, today, Segment.Women);
        // Only a newly published edit of this week is news.
        if (edit is null || edit.WeekStart != WeeklyEditRules.Format(WeeklyEditRules.WeekStartOf(today)))
            return (0, 0);

        int candidates = 0, sent = 0;
        string? token = null;
        do
        {
            var (subscribers, next, _) = await repository.GetPagedAsync<NotificationSubscriberEntity>(
                NotificationSubscriberEntity.GetPk(NotificationType.WeeklyEdit), token, PageSize, ct);
            foreach (var subscriber in subscribers)
            {
                if (!await HasMarketingConsentAsync(subscriber.SubscriberTenantId, ct))
                    continue; // switched on before consents existed, or the consent text changed: nothing goes out
                candidates++;
                await inbox.AddAsync(subscriber.SubscriberTenantId, NotificationType.WeeklyEdit, edit.Id, new Dictionary<string, string> { ["editId"] = edit.Id }, now, ct);
                if (await SendOnceAsync(subscriber.SubscriberTenantId, NotificationType.WeeklyEdit, edit.Id, new() { ["editId"] = edit.Id }, now, ct))
                    sent++;
            }
            token = next;
        } while (token is not null && !ct.IsCancellationRequested);
        return (candidates, sent);
    }

    private async Task<(int, int)> RunFriendRatingsAsync(DateTime now, CancellationToken ct)
    {
        var day = WeeklyEditRules.Format(DateOnly.FromDateTime(now));
        int candidates = 0, sent = 0;
        foreach (var marker in await repository.GetAllAsync<RatingDigestEntity>(RatingDigestEntity.GetPk(day), ct))
        {
            // The digest is a service message about the user's own looks: always in the inbox, pushed only when switched on.
            await inbox.AddAsync(marker.OwnerTenantId, NotificationType.FriendRatings, day, new Dictionary<string, string> { ["day"] = day }, now, ct);
            var subscribed = await repository.GetAsync<NotificationSubscriberEntity>(
                NotificationSubscriberEntity.GetPk(NotificationType.FriendRatings), NotificationSubscriberEntity.GetSk(marker.OwnerTenantId), ct);
            if (subscribed is null)
                continue;
            candidates++;
            if (await SendOnceAsync(marker.OwnerTenantId, NotificationType.FriendRatings, day, new() { ["day"] = day }, now, ct))
                sent++;
        }
        return (candidates, sent);
    }

    private static readonly NotificationType[] OutboxTypes = [NotificationType.FollowRequest, NotificationType.PriceDrop];

    /// <summary>Drains the event outbox. A row is removed once handled (sent, switched off, or its reason is gone).</summary>
    private async Task<(int, int)> RunOutboxAsync(DateTime now, CancellationToken ct)
    {
        int queued = 0, sent = 0;
        foreach (var type in OutboxTypes)
        {
            foreach (var row in await repository.GetAllAsync<NotificationQueueEntity>(NotificationQueueEntity.GetPk(type), ct))
            {
                queued++;
                var subscribed = await repository.GetAsync<NotificationSubscriberEntity>(
                    NotificationSubscriberEntity.GetPk(type), NotificationSubscriberEntity.GetSk(row.TenantId), ct) is not null;
                var (data, push) = await OutboxDataAsync(row, subscribed, ct);
                if (data is not null)
                    await inbox.AddAsync(row.TenantId, type, row.Key, data, now, ct);
                if (data is not null && push && await SendOnceAsync(row.TenantId, type, row.Key, new Dictionary<string, string>(data), now, ct))
                    sent++;
                await repository.DeleteAsync(row.Pk, row.Sk, ct);
            }
        }
        return (queued, sent);
    }

    /// <summary>
    /// The event data when its reason still exists (null otherwise) and whether it is pushed. A pending follow request always
    /// reaches the inbox; a price drop only with the push switched on and a valid marketing consent.
    /// </summary>
    private async Task<(Dictionary<string, string>? Data, bool Push)> OutboxDataAsync(NotificationQueueEntity row, bool subscribed, CancellationToken ct)
    {
        switch (row.Type)
        {
            case NotificationType.FollowRequest:
            {
                var pending = await repository.GetAsync<FollowRequestReceivedEntity>(
                    FollowRequestReceivedEntity.GetPk(row.TenantId), FollowRequestReceivedEntity.GetSk(row.Key), ct);
                var requester = pending is null ? null : await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(row.Key), ct);
                // Only the handle travels (for the deep link); the sentence never names anybody.
                return requester?.Handle is { } handle ? (new() { ["handle"] = handle }, subscribed) : (null, false);
            }
            case NotificationType.PriceDrop:
            {
                var item = await repository.GetAsync<WatchItemEntity>(WatchItemEntity.GetPk(row.TenantId), WatchItemEntity.GetSk(row.Key), ct);
                if (item is null || !item.PriceDropped || !item.NotifyPending)
                    return (null, false);
                // The drop is handled either way: the flag is cleared so it is not announced again.
                item.NotifyPending = false;
                await repository.SaveAsync(item, ct);
                var wanted = subscribed && WantsPriceDropPush(item) && await HasMarketingConsentAsync(row.TenantId, ct);
                return wanted ? (new() { ["productId"] = row.Key }, true) : (null, false);
            }
            default:
                return (null, false);
        }
    }

    private async Task<bool> HasMarketingConsentAsync(string tenantId, CancellationToken ct) =>
        (await consents.MissingAsync(tenantId, ConsentRules.Marketing, ct)).Count == 0;

    /// <summary>The per-product bell of the watch list (screen 24b).</summary>
    private static bool WantsPriceDropPush(WatchItemEntity item) => item.NotifyEnabled;

    /// <summary>Sends to every registered device of the tenant unless this (type, key) was already sent. True when at least one device accepted it.</summary>
    private async Task<bool> SendOnceAsync(string tenantId, NotificationType type, string key, Dictionary<string, string> data, DateTime now, CancellationToken ct)
    {
        var receiptPk = NotificationSentEntity.GetPk(tenantId);
        var receiptSk = NotificationSentEntity.GetSk(type, key);
        if (await repository.GetAsync<NotificationSentEntity>(receiptPk, receiptSk, ct) is not null)
            return false;

        var tenant = await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(tenantId), ct);
        if (tenant is null)
            return false;

        var devices = (await repository.GetAllAsync<DeviceEntity>(DeviceEntity.GetPk(tenantId), ct)).Where(d => !string.IsNullOrEmpty(d.PushToken)).ToList();
        if (devices.Count == 0)
            return false;

        var (title, body) = NotificationTexts.For(type, tenant.Language, localization.CurrentValue.DefaultLanguage);
        data["type"] = NotificationTexts.Code(type);

        var delivered = false;
        foreach (var device in devices)
        {
            switch (await push.SendAsync(new PushMessage(device.PushToken!, title, body, data) { TokenType = device.PushTokenType ?? PushTokenType.Fcm }, ct))
            {
                case PushResult.Sent:
                    delivered = true;
                    break;
                case PushResult.Unregistered:
                    await repository.DeleteAsync(device.Pk, device.Sk, ct);
                    break;
                case PushResult.NotConfigured:
                    break; // this channel (APNs / FCM) is switched off; another device may still get it, else no receipt
            }
        }

        if (delivered)
            await repository.SaveAsync(new NotificationSentEntity { TenantId = tenantId, Type = type, Key = key, SentAt = now }, ct);
        return delivered;
    }
}

/// <summary>
/// Push sentences per language (tone: calm, editorial, no exclamation, no urgency). Chosen by the recipient's profile
/// language, falling back to the default language. A new language is one more entry per type here — the only
/// server-side sentences in the product; everything else the API returns is codes or stored content.
/// </summary>
public static class NotificationTexts
{
    private static readonly Dictionary<NotificationType, Dictionary<string, (string Title, string Body)>> Templates = new()
    {
        [NotificationType.MorningOutfit] = new()
        {
            ["tr"] = ("Bugünün kombini hazır", "Planladığın look seni bekliyor."),
            ["en"] = ("Today's outfit is ready", "The look you planned is waiting."),
        },
        [NotificationType.WeeklyEdit] = new()
        {
            ["tr"] = ("Haftanın edit'i yayında", "Bu haftanın yedi look'una göz at."),
            ["en"] = ("This week's edit is live", "Take a look at this week's seven looks."),
        },
        [NotificationType.FriendRatings] = new()
        {
            ["tr"] = ("Look'larına yeni puanlar var", "Arkadaşların bugün look'larını puanladı."),
            ["en"] = ("New ratings on your looks", "Your friends rated your looks today."),
        },
        [NotificationType.PriceDrop] = new()
        {
            ["tr"] = ("İzleme listende fiyat düştü", "Takip ettiğin bir parçanın fiyatı düştü."),
            ["en"] = ("A price dropped on your watch list", "Something you are watching now costs less."),
        },
        [NotificationType.FollowRequest] = new()
        {
            ["tr"] = ("Yeni takip isteği", "Biri dolabını takip etmek istiyor."),
            ["en"] = ("New follow request", "Someone would like to follow your closet."),
        },
    };

    public static (string Title, string Body) For(NotificationType type, string? language, string defaultLanguage)
    {
        var texts = Templates[type];
        if (language is not null && texts.TryGetValue(language, out var exact))
            return exact;
        return texts.TryGetValue(defaultLanguage, out var fallback) ? fallback : texts.Values.First();
    }

    public static string Code(NotificationType type) => Infrastructure.Services.NotificationCodes.Code(type);

    public static IReadOnlyCollection<string> Languages(NotificationType type) => Templates[type].Keys;
}
