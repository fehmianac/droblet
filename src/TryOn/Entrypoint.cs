using System.Text.Json;
using Amazon.Lambda.Core;
using Amazon.Lambda.Serialization.SystemTextJson;
using Amazon.Lambda.SQSEvents;
using Domain.Events;
using Infrastructure.Workers;
using TryOn.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

[assembly: LambdaSerializer(typeof(DefaultLambdaJsonSerializer))]

namespace TryOn;

/// <summary>
/// SQS tryon-request -> TryOn (try-on images and the AI flat-lay covers of saved looks). BatchSize 1 + ReportBatchItemFailures:
/// one request's failure never retries another.
/// </summary>
public class Entrypoint
{
    private readonly IServiceProvider _services;

    public Entrypoint() : this(WorkerHost.BuildServices(services =>
    {
        services.AddSingleton<ITryOnJobService, TryOnJobService>();
        services.AddSingleton<ILookCoverJobService, LookCoverJobService>();
    })) { }

    public Entrypoint(IServiceProvider services) => _services = services;

    public async Task<SQSBatchResponse> FunctionHandler(SQSEvent sqsEvent, ILambdaContext context)
    {
        var service = _services.GetRequiredService<ITryOnJobService>();
        var logger = _services.GetRequiredService<ILogger<Entrypoint>>();
        using var cts = new CancellationTokenSource(WorkerHost.Budget(context.RemainingTime));

        var failures = new List<SQSBatchResponse.BatchItemFailure>();
        foreach (var record in sqsEvent.Records)
        {
            var ok = IsLookCover(record.Body)
                ? await JobMessageHandler.HandleAsync<LookCoverRequestedEvent>(
                    record.Body, record.Attributes, _services.GetRequiredService<ILookCoverJobService>().ProcessAsync, logger, cts.Token)
                : await JobMessageHandler.HandleAsync<TryOnRequestedEvent>(
                    record.Body, record.Attributes, service.ProcessAsync, logger, cts.Token);
            if (!ok)
                failures.Add(new SQSBatchResponse.BatchItemFailure { ItemIdentifier = record.MessageId });
        }

        return new SQSBatchResponse(failures);
    }

    /// <summary>
    /// The same queue carries the look covers (kind LookCover, <see cref="LookCoverRequestedEvent"/>); every other message is
    /// a try-on (older try-on messages carry kind TryOn too). A body that is not JSON goes to the try-on path, which drops it.
    /// </summary>
    public static bool IsLookCover(string body)
    {
        try
        {
            using var document = JsonDocument.Parse(body);
            return document.RootElement.ValueKind == JsonValueKind.Object
                   && document.RootElement.TryGetProperty("kind", out var kind) && kind.ValueKind == JsonValueKind.String
                   && kind.GetString() == nameof(Domain.Enum.JobKind.LookCover);
        }
        catch (JsonException)
        {
            return false;
        }
    }
}
