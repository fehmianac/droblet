using Amazon.Lambda.CloudWatchEvents.ScheduledEvents;
using Amazon.Lambda.Core;
using Amazon.Lambda.Serialization.SystemTextJson;
using Amazon.Lambda.SQSEvents;
using Domain.Events;
using Domain.Services;
using Infrastructure;
using Infrastructure.Workers;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

[assembly: LambdaSerializer(typeof(DefaultLambdaJsonSerializer))]

namespace Notifier;

/// <summary>
/// One zip, five functions (a Lambda has one handler): Reminder, WeeklyEdit, FriendRatings, Lifecycle (schedules) and
/// DataExport (SQS data-export-request, "Verilerimi indir").
/// </summary>
public class Entrypoint
{
    private readonly IServiceProvider _services;

    public Entrypoint() : this(WorkerHost.BuildServices((services, configuration) =>
    {
        services.AddSingleton<INotificationJobs, NotificationJobs>();
        // Teen mode daily run (docs/api/teen.md §7–§8): turning 18, photo retention, request expiry.
        services.AddSingleton<IPhotoService, Infrastructure.Services.PhotoService>();
        services.AddSingleton<ITeenMaintenance, Infrastructure.Services.TeenMaintenance>();
        services.AddDrobletDataExportWorker(configuration);
    })) { }

    public Entrypoint(IServiceProvider services) => _services = services;

    public Task<NotificationRunResult> Reminder(ScheduledEvent scheduledEvent, ILambdaContext context) => Run(NotificationJob.Reminder, scheduledEvent, context);
    public Task<NotificationRunResult> WeeklyEdit(ScheduledEvent scheduledEvent, ILambdaContext context) => Run(NotificationJob.WeeklyEdit, scheduledEvent, context);
    public Task<NotificationRunResult> FriendRatings(ScheduledEvent scheduledEvent, ILambdaContext context) => Run(NotificationJob.FriendRatings, scheduledEvent, context);
    /// <summary>Daily: the lifecycle notifications, then the teen run (turning 18, photo retention, request expiry).</summary>
    public async Task<NotificationRunResult> Lifecycle(ScheduledEvent scheduledEvent, ILambdaContext context)
    {
        var result = await Run(NotificationJob.Lifecycle, scheduledEvent, context);
        using var cts = new CancellationTokenSource(WorkerHost.Budget(context.RemainingTime));
        await _services.GetRequiredService<ITeenMaintenance>().RunAsync(result.ScheduledAt, cts.Token);
        return result;
    }

    /// <summary>SQS data-export-request → the ZIP (BatchSize 1 + ReportBatchItemFailures).</summary>
    public async Task<SQSBatchResponse> DataExport(SQSEvent sqsEvent, ILambdaContext context)
    {
        var job = _services.GetRequiredService<IDataExportJob>();
        var logger = _services.GetRequiredService<ILogger<Entrypoint>>();
        using var cts = new CancellationTokenSource(WorkerHost.Budget(context.RemainingTime));
        var failures = new List<SQSBatchResponse.BatchItemFailure>();
        foreach (var record in sqsEvent.Records)
        {
            var ok = await JobMessageHandler.HandleAsync<DataExportRequestedEvent>(
                record.Body, WorkerHost.ReceiveCount(record.Attributes),
                (message, isLast, ct) => job.ProcessAsync(message.TenantId, message.JobId, isLast, ct), logger, cts.Token);
            if (!ok)
                failures.Add(new SQSBatchResponse.BatchItemFailure { ItemIdentifier = record.MessageId });
        }
        return new SQSBatchResponse(failures);
    }

    private async Task<NotificationRunResult> Run(NotificationJob job, ScheduledEvent scheduledEvent, ILambdaContext context)
    {
        using var cts = new CancellationTokenSource(WorkerHost.Budget(context.RemainingTime));
        var scheduledAt = scheduledEvent.Time == default ? DateTime.UtcNow : DateTime.SpecifyKind(scheduledEvent.Time, DateTimeKind.Utc);
        return await _services.GetRequiredService<INotificationJobs>().RunAsync(job, scheduledAt, cts.Token);
    }
}
