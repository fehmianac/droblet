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
    public async Task PublishAsync(IJobRequestedEvent jobEvent, CancellationToken ct = default)
    {
        var url = queues.CurrentValue.UrlFor(jobEvent.Kind)
                  ?? throw new InvalidOperationException($"No queue configured for {jobEvent.Kind}.");
        using var _ = Infrastructure.Telemetry.AiTelemetry.Measure("sqs_send");
        await sqs.SendMessageAsync(new SendMessageRequest { QueueUrl = url, MessageBody = MessageSerializer.Serialize(jobEvent) }, ct);
    }
}
