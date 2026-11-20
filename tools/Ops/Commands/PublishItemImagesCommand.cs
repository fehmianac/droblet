using Amazon.SQS;
using Amazon.SQS.Model;
using Domain.Entity;
using Domain.Manager;
using Domain.Services;
using Domain.Services.Admin;
using Infrastructure.Serialization;
using Infrastructure.Services.Maintenance;
using ItemProcessor.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Ops.Commands;

/// <summary>
/// publish-item-images: a thin wrapper over the admin "Bakım" job (docs/images.md §8) — the run is the same row the admin
/// panel lists, started as the Ops actor and audited. No AI; idempotent; allowed on dev and prod.
///   default   start the run on the item processor queue (the worker processes the batches) and return;
///   --wait    … then poll until it finishes and print the counters (exit 1 when pieces failed or the run did not complete);
///   --inline  process the batches in this process with the same job code (no queue needed: CI, or before the worker
///             has the code);
///   --dry-run count only.
/// </summary>
internal static class PublishItemImagesCommand
{
    public static string QueueName(string stage) => $"droblet-{stage}-item-process-request";

    public static async Task<int> RunAsync(IServiceProvider services, OpsArguments args, OpsOutput output, CancellationToken ct)
    {
        var repository = services.GetRequiredService<IRepository>();
        var time = services.GetRequiredService<TimeProvider>();
        var audit = services.GetRequiredService<IAuditLog>();
        IMaintenanceQueue queue;
        InlineQueue? inline = null;
        if (args.Flag("inline"))
            queue = inline = new InlineQueue();
        else
        {
            var sqs = services.GetRequiredService<IAmazonSQS>();
            var url = (await sqs.GetQueueUrlAsync(new GetQueueUrlRequest { QueueName = QueueName(args.Stage) }, ct)).QueueUrl;
            queue = new FixedQueue(sqs, url);
        }
        var maintenance = new MaintenanceService(repository, queue, audit, time, services.GetRequiredService<ILogger<MaintenanceService>>());
        PublishItemImagesJob Job() => new(repository,
            new ItemImageMigrator(repository, services.GetRequiredService<IObjectStorage>(), new SkiaImageThumbnailer(), services.GetRequiredService<IItemImagePublisher>(), time),
            queue, services.GetRequiredService<IOptionsMonitor<MaintenanceOptions>>(), time, services.GetRequiredService<ILogger<PublishItemImagesJob>>());

        return await RunAsync(maintenance, inline is null ? null : Job(), inline, args.DryRun, args.Flag("wait"), args.Stage, output, ct);
    }

    public static async Task<int> RunAsync(IMaintenanceService maintenance, IPublishItemImagesJob? job, InlineQueue? inline, bool dryRun, bool wait,
        string stage, OpsOutput output, CancellationToken ct, TimeSpan? pollInterval = null)
    {
        var started = await maintenance.StartPublishItemImagesAsync(OpsHost.Actor, dryRun, null, ct);
        if (started.Outcome != MaintenanceStartOutcome.Started)
        {
            output.Error($"publish-item-images: not started ({started.Outcome}{(started.Run is { } active ? $", active run {active.Id}" : "")})");
            output.Summary($"**publish-item-images refused:** {started.Outcome}");
            return 1;
        }
        var run = started.Run!;
        output.Line($"run {run.Id} started{(dryRun ? " (dry run)" : "")}; it is listed in the admin panel under Bakım");

        if (job is not null && inline is not null)
        {
            while (inline.Next is { } next)
            {
                inline.Next = null;
                await job.RunBatchAsync(next, ct);
                if (await maintenance.GetPublishItemImagesAsync(run.Id, ct) is { } progress)
                    output.Line($"batch {next.Seq}: scanned {progress.Scanned} · published {progress.Published} · already public {progress.AlreadyPublic} · skipped {progress.Skipped} · failed {progress.Failed}");
            }
        }
        else if (wait)
        {
            while (await maintenance.GetPublishItemImagesAsync(run.Id, ct) is { } current && current.Status is MaintenanceRunStatus.Queued or MaintenanceRunStatus.Running or MaintenanceRunStatus.Cancelling)
                await Task.Delay(pollInterval ?? TimeSpan.FromSeconds(10), ct);
        }
        else
        {
            output.Summary($"### publish-item-images ({stage}){(dryRun ? " — dry run" : "")}\n\nRun `{run.Id}` queued; follow it in the admin panel (Bakım) or re-run with --wait.");
            return 0;
        }

        run = await maintenance.GetPublishItemImagesAsync(run.Id, ct) ?? run;
        Report(run, stage, output);
        return run.Status == MaintenanceRunStatus.Completed && run.Failed == 0 ? 0 : 1;
    }

    private static void Report(MaintenanceRunDto run, string stage, OpsOutput output)
    {
        output.Summary($"### publish-item-images ({stage}){(run.DryRun ? " — dry run" : "")} — run `{run.Id}` {run.Status}\n");
        output.Table(["tenants", "items scanned", run.DryRun ? "would publish" : "published", "already public", "skipped", "hidden (moderation)",
                run.DryRun ? "would make renditions" : "renditions made", "failed"],
            [[$"{run.Tenants}", $"{run.Scanned}", $"{run.Published}", $"{run.AlreadyPublic}", $"{run.Skipped}", $"{run.Hidden}", $"{run.RenditionsMade}", $"{run.Failed}"]]);
        if (run.SkipReasons.Count > 0)
            output.Table(["skipped because", "items"], run.SkipReasons.Select(s => new[] { s.Reason, $"{s.Count}" }).ToList());
        if (run.FailedItems.Count > 0)
            output.Table(["tenant", "item", "reason"], run.FailedItems.Select(f => new[] { f.TenantId, f.ItemId, f.Reason }).ToList());
    }

    /// <summary>--inline: the next batch message is kept here instead of being sent to SQS.</summary>
    internal sealed class InlineQueue : IMaintenanceQueue
    {
        public PublishItemImagesBatchRequested? Next { get; set; }

        public Task EnqueueAsync(PublishItemImagesBatchRequested message, CancellationToken ct)
        {
            Next = message;
            return Task.CompletedTask;
        }
    }

    private sealed class FixedQueue(IAmazonSQS sqs, string url) : IMaintenanceQueue
    {
        public Task EnqueueAsync(PublishItemImagesBatchRequested message, CancellationToken ct) =>
            sqs.SendMessageAsync(new SendMessageRequest { QueueUrl = url, MessageBody = MessageSerializer.Serialize(message) }, ct);
    }
}
