using Domain.Events;

namespace Domain.Manager;

public interface IEventManager
{
    Task PublishAsync(IJobRequestedEvent jobEvent, CancellationToken ct = default);
}
