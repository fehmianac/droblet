using Domain.Entity;
using Domain.Enum;
using Domain.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Notifier;
using Tests.Shared;

namespace NotifierTests;

/// <summary>Event pushes (decisions 8, 9) and the watch-list auto-add pass (decision 10) that ride on the Reminder run.</summary>
public class OutboxAndAutoAddTests
{
    private sealed class FakePush : IPushProvider
    {
        public List<PushMessage> Sent { get; } = [];
        public Task<PushResult> SendAsync(PushMessage message, CancellationToken ct)
        {
            Sent.Add(message);
            return Task.FromResult(PushResult.Sent);
        }
    }

    private sealed class NoOutfit : IMorningOutfitCheck
    {
        public Task<bool> HasOutfitForTodayAsync(string tenantId, string localDay, CancellationToken ct) => Task.FromResult(false);
    }

    private static readonly DateTime Now = new(2026, 11, 20, 10, 0, 0, DateTimeKind.Utc);

    private readonly FakePush _push = new();
    private readonly WorkerTestHost _host;
    private readonly INotificationJobs _jobs;

    public OutboxAndAutoAddTests()
    {
        _host = new WorkerTestHost(services =>
        {
            services.RemoveAll<IPushProvider>();
            services.AddSingleton<IPushProvider>(_push);
            services.RemoveAll<IMorningOutfitCheck>();
            services.AddSingleton<IMorningOutfitCheck>(new NoOutfit());
            services.AddSingleton<INotificationJobs, NotificationJobs>();
        });
        _jobs = _host.Get<INotificationJobs>();
    }

    private async Task TenantAsync(string id, string language = "tr", string? handle = null, params NotificationType[] subscriptions)
    {
        await _host.Repository.SaveAsync(new TenantEntity { Id = id, OwnerUserId = "u-" + id, Language = language, Handle = handle, Version = 1 });
        await _host.Repository.SaveAsync(new DeviceEntity { TenantId = id, DeviceId = "d-" + id, Platform = "ios", PushToken = "token-" + id });
        foreach (var type in subscriptions)
            await _host.Repository.SaveAsync(new NotificationSubscriberEntity { Type = type, SubscriberTenantId = id, UserId = "u-" + id });
    }

    private Task QueueAsync(NotificationType type, string tenantId, string key) =>
        _host.Repository.SaveAsync(new NotificationQueueEntity { Type = type, TenantId = tenantId, Key = key, CreatedAt = Now });

    private Task RequestAsync(string requester, string target) =>
        _host.Repository.SaveAsync(new FollowRequestReceivedEntity { TenantId = target, RequesterTenantId = requester, CreatedAt = Now });

    [Fact]
    public async Task FollowRequest_SentOnlyWhenSwitchedOn_AndStillPending_OnceAndWithoutNames()
    {
        await TenantAsync("asker", handle: "ayse");
        await TenantAsync("owner-on", "en", subscriptions: NotificationType.FollowRequest);
        await TenantAsync("owner-off");
        await TenantAsync("owner-withdrawn", subscriptions: NotificationType.FollowRequest);
        await RequestAsync("asker", "owner-on");
        await RequestAsync("asker", "owner-off");
        await QueueAsync(NotificationType.FollowRequest, "owner-on", "asker");
        await QueueAsync(NotificationType.FollowRequest, "owner-off", "asker");
        await QueueAsync(NotificationType.FollowRequest, "owner-withdrawn", "asker");   // request cancelled meanwhile

        await _jobs.RunAsync(NotificationJob.Reminder, Now, default);
        await QueueAsync(NotificationType.FollowRequest, "owner-on", "asker");          // asked again
        await _jobs.RunAsync(NotificationJob.Reminder, Now.AddMinutes(15), default);

        var message = Assert.Single(_push.Sent);
        Assert.Equal("token-owner-on", message.Token);
        Assert.Equal(("follow_request", "ayse"), (message.Data["type"], message.Data["handle"]));
        Assert.Equal("New follow request", message.Title);
        Assert.DoesNotContain("ayse", message.Body);
        Assert.Empty(await _host.Repository.GetKeysAsync(NotificationQueueEntity.GetPk(NotificationType.FollowRequest)));
    }

    [Fact]
    public async Task PriceDrop_RespectsPreferenceAndBell_ClearsThePendingFlag()
    {
        await TenantAsync("wants", subscriptions: NotificationType.PriceDrop);
        await TenantAsync("muted", subscriptions: NotificationType.PriceDrop);
        await TenantAsync("off");
        foreach (var (tenant, notify) in new[] { ("wants", (bool?)null), ("muted", false), ("off", true) })
        {
            await _host.Repository.SaveAsync(new WatchItemEntity
            {
                TenantId = tenant, ProductId = "p1", PriceAtAddMinor = 1000, PriceDropped = true, DroppedToMinor = 800, NotifyPending = true, Notify = notify, AddedAt = Now,
            });
            await QueueAsync(NotificationType.PriceDrop, tenant, "p1");
        }

        await _jobs.RunAsync(NotificationJob.Reminder, Now, default);

        var message = Assert.Single(_push.Sent);
        Assert.Equal(("token-wants", "price_drop", "p1"), (message.Token, message.Data["type"], message.Data["productId"]));
        foreach (var tenant in new[] { "wants", "muted", "off" })
            Assert.False((await _host.Repository.GetAsync<WatchItemEntity>(WatchItemEntity.GetPk(tenant), WatchItemEntity.GetSk("p1")))!.NotifyPending);
    }

    private async Task ProductAsync(string id, bool retired = false) =>
        await _host.Repository.SaveAsync(new CatalogProductEntity { Id = id, BrandId = "b", PriceMinor = 5000, Retired = retired, Name = new() { ["tr"] = id } });

    private Task CandidateAsync(string tenant, string clickId, DateTime clickedAt, params string[] products) =>
        _host.Repository.SaveAsync(new WatchAutoAddCandidateEntity
        {
            TenantId = tenant, ClickId = clickId, ProductIds = products.ToList(), ClickedAt = clickedAt, DueAt = clickedAt.AddHours(48),
        });

    private async Task<List<WatchItemEntity>> WatchAsync(string tenant) => await _host.Repository.GetAllAsync<WatchItemEntity>(WatchItemEntity.GetPk(tenant));

    [Fact]
    public async Task AutoAdd_After48Hours_AddsUnboughtProducts_Idempotently_AsAutoWithoutBell()
    {
        await TenantAsync("t1");
        foreach (var p in new[] { "keep", "bought", "owned", "watched", "removed", "retired", "removed-before" })
            await ProductAsync(p, retired: p == "retired");
        var clickedAt = Now.AddHours(-48).AddMinutes(-5);
        await CandidateAsync("t1", "click-1", clickedAt, "keep", "bought", "owned", "watched", "removed", "retired", "removed-before", "unknown");
        await CandidateAsync("t1", "click-later", Now.AddHours(-47), "keep");                       // not due yet
        await _host.Repository.SaveAsync(new AffiliateConversionEntity { TenantId = "t1", Source = AffiliateSource.Network, ExternalId = "o1", ClickId = "other", BrandId = "b", ProductIds = ["bought"] });
        await _host.Repository.SaveAsync(new ItemEntity { TenantId = "t1", Id = "i1", ProductId = "owned" });
        await _host.Repository.SaveAsync(new WatchItemEntity { TenantId = "t1", ProductId = "watched", PriceAtAddMinor = 1, AddedAt = clickedAt, Notify = true });
        await _host.Repository.SaveAsync(new WatchRemovedEntity { TenantId = "t1", ProductId = "removed", RemovedAt = clickedAt.AddHours(1) });
        await _host.Repository.SaveAsync(new WatchRemovedEntity { TenantId = "t1", ProductId = "removed-before", RemovedAt = clickedAt.AddHours(-1) });

        await _jobs.RunAsync(NotificationJob.Reminder, Now, default);
        await _jobs.RunAsync(NotificationJob.Reminder, Now.AddMinutes(15), default);   // replay: nothing twice

        var items = (await WatchAsync("t1")).ToDictionary(i => i.ProductId);
        Assert.Equal(["keep", "removed-before", "watched"], items.Keys.Order(StringComparer.Ordinal).ToArray());
        Assert.Equal((WatchOrigin.Auto, false, 5000L), (items["keep"].Origin, items["keep"].NotifyEnabled, items["keep"].PriceAtAddMinor));
        Assert.Equal(WatchOrigin.User, items["watched"].Origin);
        Assert.NotNull(await _host.Repository.GetAsync<ProductWatcherEntity>(ProductWatcherEntity.GetPk("keep"), ProductWatcherEntity.GetSk("t1")));
        Assert.Single(await _host.Repository.GetAllAsync<WatchAutoAddCandidateEntity>(WatchAutoAddCandidateEntity.GetPk(Now.AddHours(1))));  // the later click waits
    }

    [Fact]
    public async Task AutoAdd_ConvertedClickOrDeletedAccount_AddsNothing()
    {
        await TenantAsync("t2");
        await ProductAsync("p");
        var clickedAt = Now.AddHours(-49);
        await CandidateAsync("t2", "click-converted", clickedAt, "p");
        await CandidateAsync("gone", "click-gone", clickedAt, "p");
        await _host.Repository.SaveAsync(new AffiliateConversionEntity { TenantId = "t2", Source = AffiliateSource.Direct, ExternalId = "o2", ClickId = "click-converted", BrandId = "b" });

        await _jobs.RunAsync(NotificationJob.Reminder, Now, default);

        Assert.Empty(await WatchAsync("t2"));
        Assert.Empty(await WatchAsync("gone"));
        Assert.Empty(await _host.Repository.GetAllAsync<WatchAutoAddCandidateEntity>(WatchAutoAddCandidateEntity.GetPk(clickedAt.AddHours(48))));
    }
}
