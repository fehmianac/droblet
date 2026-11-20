using Amazon.Lambda.Core;
using Amazon.Lambda.Serialization.SystemTextJson;
using Amazon.Lambda.SQSEvents;
using Domain.Events;
using Domain.Services.Ai;
using Infrastructure.Serialization;
using Infrastructure.Services.Maintenance;
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
        .AddSingleton<Domain.Services.IImageThumbnailer, SkiaImageThumbnailer>()
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
            // Admin "Bakım" › publish-item-images batches share this queue (this worker has SkiaSharp for the thumbnails).
            var ok = SqsMaintenanceQueue.IsBatchMessage(record.Body)
                ? await MaintenanceBatchHandler.HandleAsync(_services, record.Body, WorkerHost.ReceiveCount(record.Attributes), logger, cts.Token)
                : await JobMessageHandler.HandleAsync<ItemProcessRequestedEvent>(record.Body, record.Attributes, service.ProcessAsync, logger, cts.Token);
            if (!ok)
                failures.Add(new SQSBatchResponse.BatchItemFailure { ItemIdentifier = record.MessageId });
        }

        return new SQSBatchResponse(failures);
    }
}

/// <summary>One publish-item-images batch. False = let SQS retry; the last delivery marks the run failed instead.</summary>
public static class MaintenanceBatchHandler
{
    public static async Task<bool> HandleAsync(IServiceProvider services, string body, int receiveCount, ILogger logger, CancellationToken ct)
    {
        Domain.Services.Admin.PublishItemImagesBatchRequested message;
        try
        {
            message = MessageSerializer.Deserialize<Domain.Services.Admin.PublishItemImagesBatchRequested>(body);
        }
        catch (System.Text.Json.JsonException)
        {
            logger.LogError("Malformed maintenance message dropped");
            return true;
        }

        var job = services.GetRequiredService<PublishItemImagesJob>();
        try
        {
            await job.RunBatchAsync(message, ct);
            return true;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "publish-item-images batch {Seq} of run {RunId} failed (attempt {Attempt})", message.Seq, message.MaintenanceRunId, receiveCount);
            if (receiveCount < WorkerHost.MaxReceiveCount)
                return false;
            await job.FailAsync(message.MaintenanceRunId, CancellationToken.None);
            return true;
        }
    }
}
