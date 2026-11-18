using Domain.Entity;
using Domain.Enum;

namespace Domain.Services;

/// <summary>Worker-side job state transitions. Failure refunds any reserved credits.</summary>
public interface IJobLifecycle
{
    Task<JobEntity?> StartAsync(string tenantId, string jobId, CancellationToken ct);
    Task CompleteAsync(JobEntity job, string resultJson, CancellationToken ct);
    Task FailAsync(JobEntity job, JobFailure failure, CancellationToken ct);
}
