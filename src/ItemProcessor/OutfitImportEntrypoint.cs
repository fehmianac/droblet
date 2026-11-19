using Amazon.Lambda.Core;
using Amazon.Lambda.SQSEvents;
using Domain.Events;
using Domain.Services;
using Domain.Services.Ai;
using Infrastructure.Services;
using Infrastructure.Workers;
using ItemProcessor.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;

namespace ItemProcessor;

/// <summary>
/// SQS outfit-import-request -> droblet-{stage}-outfit-import (same package as the ItemProcessor, its own function, role,
/// queue, DLQ and log group). BatchSize 1 + ReportBatchItemFailures; SQS MaximumConcurrency caps the whole queue, the
/// per-tenant lease inside the job keeps one tenant's 30 photos from taking every slot.
/// </summary>
public class OutfitImportEntrypoint
{
    private readonly IServiceProvider _services;

    public OutfitImportEntrypoint() : this(WorkerHost.BuildServices(services =>
    {
        services.AddSingleton<IImageCropper, SkiaImageCropper>();
        services.TryAddSingleton<INotificationInbox, NotificationInboxService>();
        services.AddSingleton<IOutfitImportJobService, OutfitImportJobService>();
    })) { }

    public OutfitImportEntrypoint(IServiceProvider services) => _services = services;

    public async Task<SQSBatchResponse> FunctionHandler(SQSEvent sqsEvent, ILambdaContext context)
    {
        var service = _services.GetRequiredService<IOutfitImportJobService>();
        var logger = _services.GetRequiredService<ILogger<OutfitImportEntrypoint>>();
        using var cts = new CancellationTokenSource(WorkerHost.Budget(context.RemainingTime));

        var failures = new List<SQSBatchResponse.BatchItemFailure>();
        foreach (var record in sqsEvent.Records)
        {
            var ok = await JobMessageHandler.HandleAsync<OutfitImportPhotoRequestedEvent>(
                record.Body, record.Attributes, service.ProcessAsync, logger, cts.Token);
            if (!ok)
                failures.Add(new SQSBatchResponse.BatchItemFailure { ItemIdentifier = record.MessageId });
        }

        return new SQSBatchResponse(failures);
    }
}
