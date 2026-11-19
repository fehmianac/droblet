using Amazon.SQS;
using Amazon.SQS.Model;
using Domain.Events;
using Domain.Manager;
using Domain.Options;
using Infrastructure.Serialization;
using Microsoft.Extensions.Options;

namespace Infrastructure.Manager;

public sealed class EventManager(IAmazonSQS sqs, IOptionsMonitor<QueueOptions> queues) : IEventManager
{
    public Task PublishAsync(IJobRequestedEvent jobEvent, CancellationToken ct = default) => PublishAsync(jobEvent, TimeSpan.Zero, ct);

    public async Task PublishAsync(IJobRequestedEvent jobEvent, TimeSpan delay, CancellationToken ct = default)
    {
        var url = queues.CurrentValue.UrlFor(jobEvent.Kind)
                  ?? throw new InvalidOperationException($"No queue configured for {jobEvent.Kind}.");
        using var _ = Infrastructure.Telemetry.AiTelemetry.Measure("sqs_send");
        var request = new SendMessageRequest { QueueUrl = url, MessageBody = MessageSerializer.Serialize(jobEvent) };
        // SQS: 0..900 s.
        if (delay > TimeSpan.Zero)
            request.DelaySeconds = (int)Math.Clamp(Math.Ceiling(delay.TotalSeconds), 1, 900);
        await sqs.SendMessageAsync(request, ct);
    }
}
