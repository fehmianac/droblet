using Domain.Entity;
using Domain.Enum;
using Domain.Manager;
using Domain.Domain;
using Domain.Services;
using Infrastructure.Telemetry;
using Microsoft.Extensions.Logging;

namespace Infrastructure.Services;

/// <summary>
/// Worker-side job transitions. The single place where a finished job's AI cost is written: the job record (timings,
/// aiCost, aiModels) and the durable usage counters (IAiUsageRecorder, once per job id — an SQS retry adds nothing).
/// </summary>
public sealed class JobLifecycle(
    IRepository repository,
    ICreditService credits,
    IItemRecognitionQuotaService itemRecognition,
    IAiUsageRecorder usage,
    TimeProvider timeProvider,
    ILogger<JobLifecycle> logger) : IJobLifecycle
{
    public async Task<JobEntity?> StartAsync(string tenantId, string jobId, CancellationToken ct)
    {
        var job = await repository.GetAsync<JobEntity>(JobEntity.GetPk(tenantId), JobEntity.GetSk(jobId), ct);
        if (job is null || job.Status is JobStatus.Completed or JobStatus.Failed)
        {
            logger.LogInformation("Job {JobId} for tenant {TenantId} skipped (missing or finished)", jobId, tenantId);
            return null;
        }

        job.Status = JobStatus.Processing;
        job.UpdatedAt = timeProvider.GetUtcNow().UtcDateTime;
        if (AiTelemetry.Current is { } timings)
        {
            timings.JobId = job.Id;
            timings.JobKind = job.Kind.ToString();
            // Api saved the job → this worker picked it up (Api enqueue + SQS + Lambda scaling / init).
            timings.Set("since_created", (job.UpdatedAt - job.CreatedAt).TotalMilliseconds);
        }
        await repository.SaveAsync(job, ct);
        return job;
    }

    public async Task CompleteAsync(JobEntity job, string resultJson, CancellationToken ct)
    {
        job.Status = JobStatus.Completed;
        job.Failure = null;
        job.Result = resultJson;
        job.UpdatedAt = timeProvider.GetUtcNow().UtcDateTime;
        job.Timings = AiTelemetry.Current?.Snapshot();
        job.AiCost = AiTelemetry.Current?.CostSnapshot();
        job.AiModels = AiTelemetry.Current?.Models();
        await repository.SaveAsync(job, ct);
        await RecordDurationAsync(job, ct);
        await RecordUsageAsync(job, AiUsageOutcome.Completed, ct);

        if (job.CreditIdempotencyKey is { } key)
            await credits.CommitAsync(job.TenantId, key, ct);
        // A recognised photo consumes one of a non-member's free recognitions (no-op for members).
        if (job.Kind is JobKind.ItemProcess or JobKind.ItemSplit)
            await itemRecognition.CommitAsync(job.TenantId, job.Id, ct);
    }

    public async Task FailAsync(JobEntity job, JobFailure failure, CancellationToken ct)
    {
        job.Status = JobStatus.Failed;
        job.Failure = failure;
        job.UpdatedAt = timeProvider.GetUtcNow().UtcDateTime;
        job.Timings = AiTelemetry.Current?.Snapshot();
        job.AiCost = AiTelemetry.Current?.CostSnapshot();
        job.AiModels = AiTelemetry.Current?.Models();
        await repository.SaveAsync(job, ct);
        // Counted before the refund, so a crash between the two can only be retried into "already counted".
        await RecordUsageAsync(job, job.CreditIdempotencyKey is null ? AiUsageOutcome.Failed : AiUsageOutcome.Refunded, ct);

        // A failed AI call never costs the user a credit.
        if (job.CreditIdempotencyKey is { } key)
            await credits.RefundAsync(job.TenantId, key, ct);
        // …nor one of a non-member's free garment recognitions, whatever the failure (provider, guard, deleted source).
        if (job.Kind is JobKind.ItemProcess or JobKind.ItemSplit)
            await itemRecognition.ReleaseAsync(job.TenantId, job.Id, ct);

        logger.LogWarning("Job {JobId} ({Kind}) for tenant {TenantId} failed: {Failure}", job.Id, job.Kind, job.TenantId, failure);
    }

    public Task RecordLateUsageAsync(JobEntity job, string stage, CancellationToken ct)
    {
        var calls = AiTelemetry.Current?.TakeUncountedCalls().Select(c => c.ToUsage()).ToList() ?? [];
        return calls.Count == 0
            ? Task.CompletedTask
            : usage.RecordAsync(new AiUsageRecord(job.TenantId, job.Id + "#" + stage, job.Kind, AiUsageOutcome.Completed, calls,
                timeProvider.GetUtcNow().UtcDateTime, CountsJob: false, Source: AiUsageOperations.SourceOf(job.Input)), ct);
    }

    /// <summary>The run's provider calls into the durable usage counters (marker = job id). Best effort.</summary>
    private Task RecordUsageAsync(JobEntity job, AiUsageOutcome outcome, CancellationToken ct)
    {
        var calls = AiTelemetry.Current?.TakeUncountedCalls().Select(c => c.ToUsage()).ToList() ?? [];
        return usage.RecordAsync(new AiUsageRecord(job.TenantId, job.Id, job.Kind, outcome, calls, job.UpdatedAt,
            Source: AiUsageOperations.SourceOf(job.Input)), ct);
    }

    /// <summary>Feeds the kind's typical duration (JobStatsEntity, poll hint of GET job). Best effort: never fails the job.</summary>
    private async Task RecordDurationAsync(JobEntity job, CancellationToken ct)
    {
        try
        {
            var sample = (long)(job.UpdatedAt - job.CreatedAt).TotalMilliseconds;
            if (sample <= 0)
                return;
            var stats = await repository.GetAsync<JobStatsEntity>(JobStatsEntity.GetPk(), JobStatsEntity.GetSk(job.Kind), ct) ?? new JobStatsEntity { Kind = job.Kind };
            stats.TypicalMs = JobEta.Update(stats.TypicalMs, stats.Samples, sample);
            stats.Samples++;
            stats.UpdatedAt = job.UpdatedAt;
            await repository.SaveAsync(stats, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Job {JobId}: typical duration not recorded", job.Id);
        }
    }
}
