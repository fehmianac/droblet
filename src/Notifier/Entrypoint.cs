using Amazon.Lambda.CloudWatchEvents.ScheduledEvents;
using Amazon.Lambda.Core;
using Amazon.Lambda.Serialization.SystemTextJson;
using Infrastructure.Workers;
using Microsoft.Extensions.DependencyInjection;

[assembly: LambdaSerializer(typeof(DefaultLambdaJsonSerializer))]

namespace Notifier;

/// <summary>One zip, four functions (a Lambda has one handler): Reminder, WeeklyEdit, FriendRatings, Lifecycle.</summary>
public class Entrypoint
{
    private readonly IServiceProvider _services;

    public Entrypoint() : this(WorkerHost.BuildServices(services => services.AddSingleton<INotificationJobs, NotificationJobs>())) { }

    public Entrypoint(IServiceProvider services) => _services = services;

    public Task<NotificationRunResult> Reminder(ScheduledEvent scheduledEvent, ILambdaContext context) => Run(NotificationJob.Reminder, scheduledEvent, context);
    public Task<NotificationRunResult> WeeklyEdit(ScheduledEvent scheduledEvent, ILambdaContext context) => Run(NotificationJob.WeeklyEdit, scheduledEvent, context);
    public Task<NotificationRunResult> FriendRatings(ScheduledEvent scheduledEvent, ILambdaContext context) => Run(NotificationJob.FriendRatings, scheduledEvent, context);
    public Task<NotificationRunResult> Lifecycle(ScheduledEvent scheduledEvent, ILambdaContext context) => Run(NotificationJob.Lifecycle, scheduledEvent, context);

    private async Task<NotificationRunResult> Run(NotificationJob job, ScheduledEvent scheduledEvent, ILambdaContext context)
    {
        using var cts = new CancellationTokenSource(WorkerHost.Budget(context.RemainingTime));
        var scheduledAt = scheduledEvent.Time == default ? DateTime.UtcNow : DateTime.SpecifyKind(scheduledEvent.Time, DateTimeKind.Utc);
        return await _services.GetRequiredService<INotificationJobs>().RunAsync(job, scheduledAt, cts.Token);
    }
}
