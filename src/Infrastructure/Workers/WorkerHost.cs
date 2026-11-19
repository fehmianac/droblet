using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using Domain.Manager;
using Domain.Services;
using Infrastructure.Configuration;
using Infrastructure.Telemetry;
using Infrastructure.Serialization;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Infrastructure.Workers;

public static class WorkerHost
{
    /// <summary>SQS maxReceiveCount (template.yaml). The last attempt must leave the job Failed, never stuck.</summary>
    public const int MaxReceiveCount = 3;

    public static IServiceProvider BuildServices(Action<IServiceCollection> configure) =>
        BuildServices((services, _) => configure(services));

    public static IServiceProvider BuildServices(Action<IServiceCollection, IConfiguration> configure)
    {
        var configuration = new ConfigurationBuilder()
            .SetBasePath(AppContext.BaseDirectory)
            .AddJsonFile("appsettings.json", optional: true)
            .AddEnvironmentVariables()
            .AddDrobletConfiguration()
            .Build();

        var services = new ServiceCollection();
        services.AddSingleton<IConfiguration>(configuration);
        services.AddLogging(logging => logging.AddJsonConsole().SetMinimumLevel(LogLevel.Information));
        services.AddDrobletCore(configuration);
        services.AddDrobletAi();
        configure(services, configuration);
        DecorateWithTimings(services);
        var provider = services.BuildServiceProvider();
        WarmUp(provider);
        return provider;
    }

    /// <summary>
    /// Cold start: the first DynamoDB call of a fresh instance took ~0.9 s (SDK first use, credentials, TLS) against
    /// ~70 ms warm, and the first OpenAI call pays its TLS handshake. Both are started in the background at init, so they
    /// overlap with the rest of the start-up and the job's first steps instead of adding to them. Best effort.
    /// </summary>
    public static void WarmUp(IServiceProvider services)
    {
        _ = Task.Run(async () =>
        {
            try
            {
                var repository = services.GetRequiredService<IRepository>();
                await repository.GetAsync<Domain.Entity.JobStatsEntity>(Domain.Entity.JobStatsEntity.GetPk(), Domain.Entity.JobStatsEntity.GetSk(Domain.Enum.JobKind.TryOn));
            }
            catch (Exception)
            {
                // warm-up only
            }
        });
        _ = Task.Run(async () =>
        {
            try
            {
                await services.GetRequiredService<Infrastructure.Ai.OpenAiProvider>().WarmUpAsync(CancellationToken.None);
            }
            catch (Exception)
            {
                // warm-up only
            }
        });
    }

    /// <summary>DynamoDB and S3 calls of a job run are added to its stage timings ("db", "s3_get", "s3_put").</summary>
    public static void DecorateWithTimings(IServiceCollection services)
    {
        Decorate<IRepository>(services, inner => new TimedRepository(inner));
        Decorate<IObjectStorage>(services, inner => new TimedObjectStorage(inner));
    }

    private static void Decorate<T>(IServiceCollection services, Func<T, T> wrap) where T : class
    {
        var descriptor = services.LastOrDefault(d => d.ServiceType == typeof(T));
        if (descriptor is null)
            return;
        services.Remove(descriptor);
        services.Add(new ServiceDescriptor(typeof(T), sp =>
        {
            var inner = descriptor.ImplementationInstance as T
                        ?? (descriptor.ImplementationFactory is { } factory ? (T)factory(sp) : (T)ActivatorUtilities.CreateInstance(sp, descriptor.ImplementationType!));
            return wrap(inner);
        }, descriptor.Lifetime));
    }

    /// <summary>Time left for work, keeping 5 s to record the outcome; never below 1 s.</summary>
    public static TimeSpan Budget(TimeSpan remaining) =>
        remaining - TimeSpan.FromSeconds(5) is var budget && budget > TimeSpan.FromSeconds(1) ? budget : TimeSpan.FromSeconds(1);

    public static int ReceiveCount(IDictionary<string, string>? attributes) =>
        attributes is not null && attributes.TryGetValue("ApproximateReceiveCount", out var value) && int.TryParse(value, out var count)
            ? count
            : 1;
}

/// <summary>Handles one SQS message. Returns false when the message should be retried by SQS.</summary>
public static class JobMessageHandler
{
    private static int _invocations;

    /// <summary>
    /// One job run with stage timings: queue wait (now − the message's SentTimestamp attribute), Lambda init on the
    /// first message of a process (cold start), then whatever the job adds (db, s3, ai.*, its own stages). The timings
    /// go into the job record (JobLifecycle) and out as one structured log line + EMF (namespace Droblet/Ai).
    /// </summary>
    public static async Task<bool> HandleAsync<TMessage>(
        string body,
        IDictionary<string, string>? attributes,
        Func<TMessage, bool, CancellationToken, Task> process,
        ILogger logger,
        CancellationToken ct)
    {
        var timings = AiTelemetry.Begin();
        try
        {
            var now = DateTimeOffset.UtcNow;
            timings.Attempt = WorkerHost.ReceiveCount(attributes);
            if (QueueWait(attributes, now) is { } wait)
                timings.Set("queue_wait", wait.TotalMilliseconds);
            if (Interlocked.Increment(ref _invocations) == 1)
            {
                timings.ColdStart = true;
                timings.Set("init", InitDuration(now).TotalMilliseconds);
            }

            var ok = await HandleAsync(body, timings.Attempt, process, logger, ct);

            var snapshot = timings.Snapshot();
            logger.LogInformation("Job timings {JobId} {Kind} attempt {Attempt} cold {Cold}: {Timings} | ai calls {Calls}",
                timings.JobId ?? "-", timings.JobKind ?? "-", timings.Attempt, timings.ColdStart, EmbeddedMetrics.Compact(snapshot),
                string.Join("; ", timings.Calls.Select(Describe)));
            EmbeddedMetrics.Emit(timings, Environment.GetEnvironmentVariable("STAGE") ?? "local", DateTimeOffset.UtcNow);
            return ok;
        }
        finally
        {
            AiTelemetry.End();
        }
    }

    private static string Describe(AiCallRecord c) =>
        $"{c.Operation} {c.Model} {c.DurationMs:0}ms {c.Status} in {c.InputTokens} (cached {c.CachedTokens}) out {c.OutputTokens} (reasoning {c.ReasoningTokens}) " +
        $"effort {c.ReasoningEffort ?? "-"} img {c.ImageSize ?? "-"}/{c.ImageQuality ?? "-"} req {c.RequestBytes}B";

    /// <summary>now − SentTimestamp (epoch ms, an SQS system attribute); null when the attribute is missing.</summary>
    public static TimeSpan? QueueWait(IDictionary<string, string>? attributes, DateTimeOffset now) =>
        attributes is not null && attributes.TryGetValue("SentTimestamp", out var raw) && long.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var sent)
            ? TimeSpan.FromMilliseconds(Math.Max(0, now.ToUnixTimeMilliseconds() - sent))
            : null;

    /// <summary>Process start → first message (runtime start, SSM config load, service graph): the cold-start cost.</summary>
    private static TimeSpan InitDuration(DateTimeOffset now)
    {
        try
        {
            var started = new DateTimeOffset(Process.GetCurrentProcess().StartTime.ToUniversalTime());
            var duration = now - started;
            return duration > TimeSpan.Zero && duration < TimeSpan.FromMinutes(15) ? duration : TimeSpan.Zero;
        }
        catch (Exception ex) when (ex is InvalidOperationException or NotSupportedException or System.ComponentModel.Win32Exception)
        {
            return TimeSpan.Zero;
        }
    }

    public static async Task<bool> HandleAsync<TMessage>(
        string body,
        int receiveCount,
        Func<TMessage, bool, CancellationToken, Task> process,
        ILogger logger,
        CancellationToken ct)
    {
        TMessage message;
        try
        {
            message = MessageSerializer.Deserialize<TMessage>(body);
        }
        catch (JsonException ex)
        {
            // Poison message: retrying cannot fix it.
            logger.LogError(ex, "Dropping malformed {Message} message", typeof(TMessage).Name);
            return true;
        }

        try
        {
            await process(message, receiveCount >= WorkerHost.MaxReceiveCount, ct);
            return true;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "{Message} processing failed (attempt {Attempt})", typeof(TMessage).Name, receiveCount);
            return false;
        }
    }
}

/// <summary>Shared provider-failure handling for AI workers.</summary>
public static class WorkerFailure
{
    public static bool IsRetryable(Exception ex, bool isLastAttempt) =>
        !isLastAttempt && ex is not Domain.Services.Ai.AiProviderException;
}
