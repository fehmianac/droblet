using Amazon.Lambda.Core;
using Amazon.Lambda.Serialization.SystemTextJson;
using Amazon.Lambda.SQSEvents;
using Domain.Events;
using Domain.Services.Ai;
using Infrastructure.Workers;
using ItemProcessor.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

[assembly: LambdaSerializer(typeof(DefaultLambdaJsonSerializer))]

namespace ItemProcessor;

/// <summary>SQS item-process-request -> ItemProcessor. BatchSize 1 + ReportBatchItemFailures: one request's failure never retries another.</summary>
public class Entrypoint
{
    private readonly IServiceProvider _services;

    public Entrypoint() : this(WorkerHost.BuildServices(services => services
        .AddSingleton<IImageCropper, SkiaImageCropper>()
        .AddSingleton<IItemProcessJobService, ItemProcessJobService>())) { }

    public Entrypoint(IServiceProvider services) => _services = services;

    public async Task<SQSBatchResponse> FunctionHandler(SQSEvent sqsEvent, ILambdaContext context)
    {
        var service = _services.GetRequiredService<IItemProcessJobService>();
        var logger = _services.GetRequiredService<ILogger<Entrypoint>>();
        using var cts = new CancellationTokenSource(WorkerHost.Budget(context.RemainingTime));

        var failures = new List<SQSBatchResponse.BatchItemFailure>();
        foreach (var record in sqsEvent.Records)
        {
            var ok = await JobMessageHandler.HandleAsync<ItemProcessRequestedEvent>(
                record.Body, WorkerHost.ReceiveCount(record.Attributes), service.ProcessAsync, logger, cts.Token);
            if (!ok)
                failures.Add(new SQSBatchResponse.BatchItemFailure { ItemIdentifier = record.MessageId });
        }

        return new SQSBatchResponse(failures);
    }
}
