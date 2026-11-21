using Amazon.Lambda.CloudWatchEvents.ScheduledEvents;
using Amazon.Lambda.TestUtilities;
using Microsoft.Extensions.DependencyInjection;
using Notifier;
using Tests.Shared;

namespace NotifierTests;

public class NotifierEntrypointTests
{
    private static Entrypoint Create() =>
        new(new WorkerTestHost(s =>
        {
            s.AddSingleton<INotificationJobs, NotificationJobs>();
            s.AddSingleton<Domain.Services.IPhotoService, Infrastructure.Services.PhotoService>();
            s.AddSingleton<Domain.Services.ITeenMaintenance, Infrastructure.Services.TeenMaintenance>();
        }).Services);

    [Fact]
    public async Task EveryHandler_DelegatesWithItsJobAndScheduledTime_NobodyToNotifyYet()
    {
        var entrypoint = Create();
        var context = new TestLambdaContext { RemainingTime = TimeSpan.FromMinutes(5) };
        var at = new DateTime(2026, 11, 18, 7, 30, 0, DateTimeKind.Utc);
        var scheduled = new ScheduledEvent { Time = at };

        var results = new[]
        {
            await entrypoint.Reminder(scheduled, context),
            await entrypoint.WeeklyEdit(scheduled, context),
            await entrypoint.FriendRatings(scheduled, context),
            await entrypoint.Lifecycle(scheduled, context),
        };

        Assert.Equal([NotificationJob.Reminder, NotificationJob.WeeklyEdit, NotificationJob.FriendRatings, NotificationJob.Lifecycle], results.Select(r => r.Job).ToArray());
        Assert.All(results, r => Assert.Equal(at, r.ScheduledAt));
        Assert.All(results, r => Assert.Equal(0, r.Sent));
    }
}
