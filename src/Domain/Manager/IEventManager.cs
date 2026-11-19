using Domain.Events;

namespace Domain.Manager;

public interface IEventManager
{
    Task PublishAsync(IJobRequestedEvent jobEvent, CancellationToken ct = default);

    /// <summary>Delivered after <paramref name="delay"/> (SQS DelaySeconds, at most 15 minutes).</summary>
    Task PublishAsync(IJobRequestedEvent jobEvent, TimeSpan delay, CancellationToken ct = default) => PublishAsync(jobEvent, ct);
}
