using System.Text.Json;
using Amazon.Lambda.Core;
using Amazon.Lambda.Serialization.SystemTextJson;
using Amazon.Lambda.SQSEvents;
using Domain.Events;
using Infrastructure.Ai;
using Infrastructure.Serialization;
using Infrastructure.Workers;
using Stylist.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

[assembly: LambdaSerializer(typeof(DefaultLambdaJsonSerializer))]

namespace Stylist;

/// <summary>
/// SQS stylist-request -> Stylist. BatchSize 1 + ReportBatchItemFailures: one request's failure never retries another.
/// The same queue carries the admin AI trials (kind AiTrial: prompt dry-run, model test, model list) — the Stylist
/// worker holds the provider key, the Api does not. A trial is never retried by SQS (each try may cost an AI call).
/// </summary>
public class Entrypoint
{
    private readonly IServiceProvider _services;

    public Entrypoint() : this(WorkerHost.BuildServices(services =>
    {
        services.AddSingleton<IStylistJobService, StylistJobService>();
        services.AddSingleton<AiTrialRunner>();
    })) { }

    public Entrypoint(IServiceProvider services) => _services = services;

    public async Task<SQSBatchResponse> FunctionHandler(SQSEvent sqsEvent, ILambdaContext context)
    {
        var service = _services.GetRequiredService<IStylistJobService>();
        var logger = _services.GetRequiredService<ILogger<Entrypoint>>();
        using var cts = new CancellationTokenSource(WorkerHost.Budget(context.RemainingTime));

        var failures = new List<SQSBatchResponse.BatchItemFailure>();
        foreach (var record in sqsEvent.Records)
        {
            if (TrialId(record.Body) is { } trialId)
            {
                await RunTrialAsync(trialId, logger, cts.Token);
                continue;
            }
            var ok = await JobMessageHandler.HandleAsync<StylistRequestedEvent>(
                record.Body, record.Attributes, service.ProcessAsync, logger, cts.Token);
            if (!ok)
                failures.Add(new SQSBatchResponse.BatchItemFailure { ItemIdentifier = record.MessageId });
        }

        return new SQSBatchResponse(failures);
    }

    private async Task RunTrialAsync(string trialId, ILogger logger, CancellationToken ct)
    {
        try
        {
            await _services.GetRequiredService<AiTrialRunner>().RunAsync(trialId, ct);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "AI trial {TrialId} could not be recorded", trialId);
        }
    }

    /// <summary>The trial id when the message is an <see cref="AiTrialRequestedEvent"/> (kind AiTrial), else null.</summary>
    public static string? TrialId(string body)
    {
        try
        {
            using var document = JsonDocument.Parse(body);
            var root = document.RootElement;
            return root.ValueKind == JsonValueKind.Object
                   && root.TryGetProperty("kind", out var kind) && kind.ValueKind == JsonValueKind.String && kind.GetString() == nameof(Domain.Enum.JobKind.AiTrial)
                   && root.TryGetProperty("jobId", out var id) && id.ValueKind == JsonValueKind.String
                ? MessageSerializer.Deserialize<AiTrialRequestedEvent>(body).JobId
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
