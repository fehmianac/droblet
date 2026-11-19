using System.Text.Json;
using Domain.Entity;
using Domain.Enum;

namespace Domain.Domain;

/// <param name="Timings">Worker stage timings in ms (internal diagnostics: queue_wait, init, db, s3_get, ai.*, worker); null until the worker finished.</param>
/// <param name="EtaMs">While queued / processing: the expected remaining time from recent jobs of this kind; null when unknown or settled.</param>
/// <param name="RetryAfterMs">While queued / processing: when to poll next (500..3000 ms); null when settled.</param>
public record JobDto(string Id, JobKind Kind, JobStatus Status, JobFailure? Failure, JsonElement? Result, DateTime CreatedAt, DateTime UpdatedAt,
    IReadOnlyDictionary<string, long>? Timings = null, long? EtaMs = null, long? RetryAfterMs = null);

public static class JobDtoMapper
{
    public static JobDto ToDto(this JobEntity entity) => new(
        entity.Id,
        entity.Kind,
        entity.Status,
        entity.Failure,
        string.IsNullOrEmpty(entity.Result) ? null : JsonDocument.Parse(entity.Result).RootElement.Clone(),
        entity.CreatedAt,
        entity.UpdatedAt,
        entity.Timings);

    /// <summary>The job with the poll hint (JobEta) while it is still running.</summary>
    public static JobDto ToDto(this JobEntity entity, long? typicalMs, DateTime now)
    {
        var dto = entity.ToDto();
        if (entity.Status is JobStatus.Completed or JobStatus.Failed)
            return dto;
        var (eta, retryAfter) = JobEta.Hint(typicalMs, (long)(now - entity.CreatedAt).TotalMilliseconds);
        return dto with { EtaMs = eta, RetryAfterMs = retryAfter };
    }
}

/// <summary>
/// Poll hint for a running job. With a typical duration T for the kind and E ms elapsed: eta = T − E (null when T is
/// unknown); the next poll comes when the job is expected to be done, but never later than 3 s nor sooner than 500 ms.
/// Past the typical duration (a slow job) the client polls every second.
/// </summary>
public static class JobEta
{
    public const long MinRetryMs = 500;
    public const long MaxRetryMs = 3000;
    public const long LateRetryMs = 1000;
    public const long UnknownRetryMs = 1000;

    public static (long? EtaMs, long RetryAfterMs) Hint(long? typicalMs, long elapsedMs)
    {
        if (typicalMs is not { } typical || typical <= 0)
            return (null, UnknownRetryMs);
        var eta = typical - Math.Max(0, elapsedMs);
        return eta <= 0 ? (0, LateRetryMs) : (eta, Math.Clamp(eta, MinRetryMs, MaxRetryMs));
    }

    /// <summary>EWMA update (weight 0.2 for the new sample; the first sample is taken as is).</summary>
    public static long Update(long typicalMs, long samples, long sampleMs) =>
        samples <= 0 || typicalMs <= 0 ? sampleMs : (long)Math.Round(typicalMs * 0.8 + sampleMs * 0.2);
}
