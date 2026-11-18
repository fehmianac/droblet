using Domain.Enum;
using Domain.Events;
using Domain.Services;
using Domain.Services.Ai;
using Infrastructure.Workers;
using Microsoft.Extensions.Logging;

namespace Stylist.Services;

public interface IStylistJobService
{
    Task ProcessAsync(StylistRequestedEvent message, bool isLastAttempt, CancellationToken ct);
}

/// <summary>
/// Outfit / week / pack / complete drafts. Model output is only ever accepted through the matching output guard
/// (StylistOutputGuard, PackingRules — E5). Until a guard exists for a kind, output is rejected, never used raw.
/// </summary>
public sealed class StylistJobService(IJobLifecycle jobs, IStylistModel model, ILogger<StylistJobService> logger) : IStylistJobService
{
    private static readonly IReadOnlyDictionary<JobKind, Func<string, bool>> Guards = new Dictionary<JobKind, Func<string, bool>>();

    public async Task ProcessAsync(StylistRequestedEvent message, bool isLastAttempt, CancellationToken ct)
    {
        var job = await jobs.StartAsync(message.TenantId, message.JobId, ct);
        if (job is null)
            return;

        try
        {
            var output = await model.GenerateAsync(new StylistPrompt(message.Kind, "{}"), ct);
            if (!Guards.TryGetValue(message.Kind, out var guard) || !guard(output))
            {
                await jobs.FailAsync(job, JobFailure.GuardRejected, ct);
                return;
            }

            await jobs.CompleteAsync(job, output, ct);
        }
        catch (Exception ex) when (!WorkerFailure.IsRetryable(ex, isLastAttempt))
        {
            logger.LogWarning(ex, "Stylist job {JobId} ({Kind}) failed for tenant {TenantId}", job.Id, message.Kind, job.TenantId);
            await jobs.FailAsync(job, JobFailure.ProviderError, ct);
        }
    }
}
