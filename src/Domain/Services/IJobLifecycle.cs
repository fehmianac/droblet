using Domain.Entity;
using Domain.Enum;

namespace Domain.Services;

/// <summary>Worker-side job state transitions. Failure refunds any reserved credits.</summary>
public interface IJobLifecycle
{
    Task<JobEntity?> StartAsync(string tenantId, string jobId, CancellationToken ct);
    Task CompleteAsync(JobEntity job, string resultJson, CancellationToken ct);
    Task FailAsync(JobEntity job, JobFailure failure, CancellationToken ct);
    /// <summary>
    /// AI calls a worker makes after the job finished (the try-on's full-quality render after its preview): added to the
    /// usage counters once per job and stage, without counting the job again. Best effort.
    /// </summary>
    Task RecordLateUsageAsync(JobEntity job, string stage, CancellationToken ct);
}

/// <summary>Typical end-to-end duration of a job kind (JobStatsEntity), cached briefly by the Api for the poll hint.</summary>
public interface IJobEtaProvider
{
    Task<long?> TypicalMsAsync(JobKind kind, CancellationToken ct);
}
