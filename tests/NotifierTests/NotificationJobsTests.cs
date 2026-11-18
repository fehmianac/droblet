using Domain.Entity;
using Domain.Enum;
using Domain.Options;
using Domain.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Notifier;
using Tests.Shared;

namespace NotifierTests;

public class NotificationJobsTests
{
    private sealed class FakePush : IPushProvider
    {
        public List<PushMessage> Sent { get; } = [];
        public HashSet<string> Unregistered { get; } = [];
        public bool Configured { get; set; } = true;

        public Task<PushResult> SendAsync(PushMessage message, CancellationToken ct)
        {
            if (!Configured) return Task.FromResult(PushResult.NotConfigured);
            if (Unregistered.Contains(message.Token)) return Task.FromResult(PushResult.Unregistered);
            Sent.Add(message);
            return Task.FromResult(PushResult.Sent);
        }
    }

    private sealed class PlannedOutfits : IMorningOutfitCheck
    {
        public HashSet<string> Tenants { get; } = [];
        public Task<bool> HasOutfitForTodayAsync(string tenantId, string localDay, CancellationToken ct) => Task.FromResult(Tenants.Contains(tenantId));
    }

    // Wednesday 18 Nov 2026, 04:30 UTC = 07:30 in Istanbul.
    private static readonly DateTime Now = new(2026, 11, 18, 4, 30, 0, DateTimeKind.Utc);

    private readonly FakePush _push = new();
    private readonly PlannedOutfits _outfits = new();
    private readonly WorkerTestHost _host;
    private readonly INotificationJobs _jobs;

    public NotificationJobsTests()
    {
        _host = new WorkerTestHost(services =>
        {
            services.RemoveAll<IPushProvider>();
            services.AddSingleton<IPushProvider>(_push);
            services.RemoveAll<IMorningOutfitCheck>();
            services.AddSingleton<IMorningOutfitCheck>(_outfits);
            services.AddSingleton<INotificationJobs, NotificationJobs>();
        });
        _jobs = _host.Get<INotificationJobs>();
    }

    private async Task AddTenantAsync(string tenantId, string language = "tr", string? token = "token", NotificationType[]? subscriptions = null,
        string? morningLocalTime = null, string timeZone = "Europe/Istanbul", bool marketingConsent = true)
    {
        await _host.Repository.SaveAsync(new TenantEntity { Id = tenantId, OwnerUserId = "u-" + tenantId, Language = language, Version = 1 });
        if (marketingConsent)
            await _host.Repository.SaveAsync(MarketingConsent(tenantId));
        if (token is not null)
            await _host.Repository.SaveAsync(new DeviceEntity { TenantId = tenantId, DeviceId = "device-" + tenantId, Platform = "ios", PushToken = token + "-" + tenantId });
        foreach (var type in subscriptions ?? [])
            await _host.Repository.SaveAsync(new NotificationSubscriberEntity { Type = type, SubscriberTenantId = tenantId, UserId = "u-" + tenantId });
        if (morningLocalTime is not null)
            await _host.Repository.SaveAsync(new ReminderSlotEntity { LocalTime = morningLocalTime, SubscriberTenantId = tenantId, UserId = "u-" + tenantId, TimeZone = timeZone });
    }

    internal static ConsentEntity MarketingConsent(string tenantId, string version = ConsentOptions.DefaultVersion) => new()
    {
        TenantId = tenantId, Type = ConsentType.MarketingNotifications, Granted = true, Version = version, GrantedAt = Now, UpdatedAt = Now,
    };

    private Task PublishEditAsync(string id, string weekStart, bool published = true) => _host.Repository.SaveAsync(new WeeklyEditEntity
    {
        Id = id, WeekStart = weekStart, Segment = Segment.Women, Published = published, Title = new() { ["tr"] = "Edit" },
    });

    [Fact]
    public async Task WeeklyEdit_GoesToSubscribersWithADevice_OncePerEdit_InTheirLanguage()
    {
        await PublishEditAsync("edit-47", "2026-11-16");
        await AddTenantAsync("t-tr", "tr", subscriptions: [NotificationType.WeeklyEdit]);
        await AddTenantAsync("t-en", "en", subscriptions: [NotificationType.WeeklyEdit]);
        await AddTenantAsync("t-de", "de", subscriptions: [NotificationType.WeeklyEdit]);       // no template yet → default language
        await AddTenantAsync("t-no-device", token: null, subscriptions: [NotificationType.WeeklyEdit]);
        await AddTenantAsync("t-not-subscribed", subscriptions: [NotificationType.FriendRatings]);

        var first = await _jobs.RunAsync(NotificationJob.WeeklyEdit, Now, default);
        var second = await _jobs.RunAsync(NotificationJob.WeeklyEdit, Now.AddHours(1), default);

        Assert.Equal((4, 3), (first.Candidates, first.Sent));
        Assert.Equal(0, second.Sent);                                                  // same edit is never announced twice
        Assert.Equal(3, _push.Sent.Count);
        Assert.Equal("Haftanın edit'i yayında", _push.Sent.Single(m => m.Token == "token-t-tr").Title);
        Assert.Equal("This week's edit is live", _push.Sent.Single(m => m.Token == "token-t-en").Title);
        Assert.Equal("Haftanın edit'i yayında", _push.Sent.Single(m => m.Token == "token-t-de").Title);
        Assert.All(_push.Sent, m => Assert.Equal(("weekly_edit", "edit-47"), (m.Data["type"], m.Data["editId"])));
    }

    [Fact]
    public async Task WeeklyEdit_NothingNewThisWeek_SendsNothing()
    {
        await PublishEditAsync("edit-46", "2026-11-09");                               // last week's edit
        await PublishEditAsync("edit-47-draft", "2026-11-16", published: false);
        await AddTenantAsync("t1", subscriptions: [NotificationType.WeeklyEdit]);

        var result = await _jobs.RunAsync(NotificationJob.WeeklyEdit, Now, default);

        Assert.Equal((0, 0), (result.Candidates, result.Sent));
        Assert.Empty(_push.Sent);
    }

    [Fact]
    public async Task FriendRatings_OneDigestPerDay_OnlyForRatedSubscribers()
    {
        await AddTenantAsync("rated", subscriptions: [NotificationType.FriendRatings]);
        await AddTenantAsync("rated-off");                                             // switched the type off
        await AddTenantAsync("quiet", subscriptions: [NotificationType.FriendRatings]); // nobody rated her today
        await _host.Repository.SaveAsync(new RatingDigestEntity { Day = "2026-11-18", OwnerTenantId = "rated", CreatedAt = Now });
        await _host.Repository.SaveAsync(new RatingDigestEntity { Day = "2026-11-18", OwnerTenantId = "rated-off", CreatedAt = Now });

        var first = await _jobs.RunAsync(NotificationJob.FriendRatings, Now.AddHours(12), default);
        var again = await _jobs.RunAsync(NotificationJob.FriendRatings, Now.AddHours(13), default);

        Assert.Equal((1, 1), (first.Candidates, first.Sent));
        Assert.Equal(0, again.Sent);
        var message = Assert.Single(_push.Sent);
        Assert.Equal("token-rated", message.Token);
        Assert.Equal("friend_ratings", message.Data["type"]);
        Assert.DoesNotContain("5", message.Body);                                      // no scores, no names, no images in the text
    }

    [Fact]
    public async Task Reminder_OnlyTheLocalSlotThatIsNow_AndOnlyWithAnOutfitForToday()
    {
        await AddTenantAsync("istanbul-planned", morningLocalTime: "07:30");
        await AddTenantAsync("istanbul-no-plan", morningLocalTime: "07:30");
        await AddTenantAsync("istanbul-later", morningLocalTime: "08:00");
        await AddTenantAsync("london", morningLocalTime: "07:30", timeZone: "Europe/London");   // 04:30 there
        _outfits.Tenants.UnionWith(["istanbul-planned", "istanbul-later", "london"]);

        var first = await _jobs.RunAsync(NotificationJob.Reminder, Now, default);
        var sameSlot = await _jobs.RunAsync(NotificationJob.Reminder, Now.AddMinutes(10), default);
        var londonMorning = await _jobs.RunAsync(NotificationJob.Reminder, new DateTime(2026, 11, 18, 7, 30, 0, DateTimeKind.Utc), default);

        Assert.Equal((2, 1), (first.Candidates, first.Sent));                          // two due in Istanbul, one has a plan
        Assert.Equal(0, sameSlot.Sent);                                                // once per local day
        Assert.Equal(1, londonMorning.Sent);
        Assert.Equal(["token-istanbul-planned", "token-london"], _push.Sent.Select(m => m.Token).ToArray());
        Assert.Equal("morning_outfit", _push.Sent[0].Data["type"]);
    }

    [Fact]
    public async Task UnregisteredToken_IsDeleted_AndPushNotConfigured_KeepsNoReceipt()
    {
        await PublishEditAsync("edit-47", "2026-11-16");
        await AddTenantAsync("gone", subscriptions: [NotificationType.WeeklyEdit]);
        await AddTenantAsync("fine", subscriptions: [NotificationType.WeeklyEdit]);
        _push.Unregistered.Add("token-gone");

        _push.Configured = false;
        var disabled = await _jobs.RunAsync(NotificationJob.WeeklyEdit, Now, default);
        _push.Configured = true;
        var enabled = await _jobs.RunAsync(NotificationJob.WeeklyEdit, Now, default);

        Assert.Equal(0, disabled.Sent);
        Assert.Equal(1, enabled.Sent);                                                 // nothing was marked as sent while push was off
        Assert.Empty(await _host.Repository.GetKeysAsync(DeviceEntity.GetPk("gone")));
        Assert.Single(await _host.Repository.GetKeysAsync(DeviceEntity.GetPk("fine")));
    }

    [Fact]
    public void Texts_ExistForEverySupportedLanguage_AndFallBackToTheDefault()
    {
        var supported = new LocalizationOptions().Languages;

        foreach (var type in Enum.GetValues<NotificationType>())
        {
            Assert.Subset(NotificationTexts.Languages(type).ToHashSet(), supported.ToHashSet());
            Assert.NotEqual(NotificationTexts.For(type, "tr", "tr"), NotificationTexts.For(type, "en", "tr"));
            Assert.Equal(NotificationTexts.For(type, "tr", "tr"), NotificationTexts.For(type, "xx", "tr"));
            Assert.Equal(NotificationTexts.For(type, "tr", "tr"), NotificationTexts.For(type, null, "tr"));
            Assert.DoesNotContain("!", NotificationTexts.For(type, "tr", "tr").Body);  // tone: no exclamation
        }
    }

    [Fact]
    public async Task EachDevice_IsSentThroughItsOwnChannel_ApnsOrFcm()
    {
        await PublishEditAsync("edit-47", "2026-11-16");
        await AddTenantAsync("t1", subscriptions: [NotificationType.WeeklyEdit]);       // legacy row: no type = fcm
        await _host.Repository.SaveAsync(new DeviceEntity
        {
            TenantId = "t1", DeviceId = "device-t1-iphone", Platform = "ios", PushToken = "a1b2c3", PushTokenType = PushTokenType.Apns,
        });

        await _jobs.RunAsync(NotificationJob.WeeklyEdit, Now, default);

        Assert.Equal(PushTokenType.Apns, _push.Sent.Single(m => m.Token == "a1b2c3").TokenType);
        Assert.Equal(PushTokenType.Fcm, _push.Sent.Single(m => m.Token == "token-t1").TokenType);
    }

    private async Task<List<NotificationInboxEntity>> InboxAsync(string tenantId) =>
        await _host.Repository.GetAllAsync<NotificationInboxEntity>(NotificationInboxEntity.GetPk(tenantId));

    [Fact]
    public async Task WeeklyEdit_IsMarketing_NeitherPushNorInbox_WithoutAValidConsent()
    {
        await PublishEditAsync("edit-47", "2026-11-16");
        await AddTenantAsync("consented", subscriptions: [NotificationType.WeeklyEdit]);
        await AddTenantAsync("legacy-switch", subscriptions: [NotificationType.WeeklyEdit], marketingConsent: false); // on before consents existed
        await AddTenantAsync("old-text", subscriptions: [NotificationType.WeeklyEdit], marketingConsent: false);
        await _host.Repository.SaveAsync(MarketingConsent("old-text", version: "2025-01-01"));                         // consent on an outdated text
        await AddTenantAsync("no-device", token: null, subscriptions: [NotificationType.WeeklyEdit]);

        var run = await _jobs.RunAsync(NotificationJob.WeeklyEdit, Now, default);

        Assert.Equal((2, 1), (run.Candidates, run.Sent));
        Assert.Equal(["token-consented"], _push.Sent.Select(m => m.Token).ToArray());
        var row = Assert.Single(await InboxAsync("consented"));
        Assert.Equal((NotificationType.WeeklyEdit, "edit-47"), (row.Type, row.Data["editId"]));
        Assert.Single(await InboxAsync("no-device"));                                   // the inbox does not need a device
        Assert.Empty(await InboxAsync("legacy-switch"));
        Assert.Empty(await InboxAsync("old-text"));
    }

    [Fact]
    public async Task Inbox_GetsEveryHandledEvent_Once_EvenWhenThePushIsOffOrNotDelivered()
    {
        await AddTenantAsync("planned", token: null, morningLocalTime: "07:30");
        _outfits.Tenants.Add("planned");
        await AddTenantAsync("rated-push-off");
        await _host.Repository.SaveAsync(new RatingDigestEntity { Day = "2026-11-18", OwnerTenantId = "rated-push-off", CreatedAt = Now });

        await _jobs.RunAsync(NotificationJob.Reminder, Now, default);
        await _jobs.RunAsync(NotificationJob.Reminder, Now.AddMinutes(10), default);    // same slot again: no second row
        await _jobs.RunAsync(NotificationJob.FriendRatings, Now.AddHours(12), default);
        await _jobs.RunAsync(NotificationJob.FriendRatings, Now.AddHours(13), default);

        var morning = Assert.Single(await InboxAsync("planned"));
        Assert.Equal((NotificationType.MorningOutfit, "2026-11-18", (DateTime?)null), (morning.Type, morning.Data["day"], morning.ReadAt));
        var ratings = Assert.Single(await InboxAsync("rated-push-off"));
        Assert.Equal(NotificationType.FriendRatings, ratings.Type);
        Assert.Empty(_push.Sent);                                                       // no device / switched off: inbox only
        Assert.True(morning.Ttl - new DateTimeOffset(morning.CreatedAt).ToUnixTimeSeconds() == 90 * 24 * 3600);
    }
}

