using Domain.Entity;
using Domain.Enum;
using Domain.Manager;
using Domain.Services;

namespace Infrastructure.Services;

public sealed record AiUsageBackfillResult(int Tenants, int Jobs, int Photos, int Written, int AlreadyCounted);

/// <summary>
/// Replays the finished jobs still in the job table (7 days) and finished outfit import photos into the AI usage
/// counters, from their stored aiCost — no AI call. Uses the live markers (job id; "oi#{session}#{index}#done"), so a
/// job the live path already counted is skipped and the replay can run any number of times. Jobs from before the
/// counters carry no token counts (only calls and cost per operation) and no model unless the job used exactly one.
/// </summary>
public sealed class AiUsageBackfill(IRepository repository, IAiUsageRecorder recorder, TimeProvider time)
{
    public async Task<AiUsageBackfillResult> RunAsync(int days, bool dryRun, CancellationToken ct)
    {
        var since = time.GetUtcNow().UtcDateTime.AddDays(-Math.Clamp(days, 1, JobEntity.RetentionDays));
        var tenants = await repository.GetAllAsync<TenantEntity>(TenantEntity.GetPk(), ct);
        int jobs = 0, photos = 0, written = 0, skipped = 0;

        async Task RecordAsync(AiUsageRecord record)
        {
            if (dryRun)
                return;
            if (await recorder.RecordAsync(record, ct))
                written++;
            else
                skipped++;
        }

        foreach (var tenant in tenants)
        {
            foreach (var job in await repository.GetAllAsync<JobEntity>(JobEntity.GetPk(tenant.Id), ct))
            {
                if (job.Status is not (JobStatus.Completed or JobStatus.Failed) || job.UpdatedAt < since || job.Kind is JobKind.DataExport or JobKind.AiTrial)
                    continue;
                jobs++;
                var outcome = job.Status == JobStatus.Completed ? AiUsageOutcome.Completed
                    : job.CreditIdempotencyKey is null ? AiUsageOutcome.Failed : AiUsageOutcome.Refunded;
                await RecordAsync(new AiUsageRecord(job.TenantId, job.Id, job.Kind, outcome, AiUsageCounters.FromJobCost(job.AiCost, job.AiModels),
                    job.UpdatedAt, Source: AiUsageOperations.SourceOf(job.Input)));
            }

            foreach (var photo in await repository.GetAllAsync<OutfitImportPhotoEntity>(OutfitImportPhotoEntity.GetPk(tenant.Id), ct))
            {
                if (photo.Status is not (OutfitImportPhotoStatus.Ready or OutfitImportPhotoStatus.Failed) || photo.UpdatedAt < since)
                    continue;
                photos++;
                await RecordAsync(new AiUsageRecord(photo.TenantId, $"oi#{photo.SessionId}#{photo.Index}#done", JobKind.OutfitImport,
                    photo.Status == OutfitImportPhotoStatus.Ready ? AiUsageOutcome.Completed : AiUsageOutcome.Failed,
                    AiUsageCounters.FromJobCost(photo.AiCost, null), photo.UpdatedAt));
            }
        }
        return new AiUsageBackfillResult(tenants.Count, jobs, photos, written, skipped);
    }
}
