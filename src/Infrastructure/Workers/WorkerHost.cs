using System.Text.Json;
using Infrastructure.Configuration;
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
        return services.BuildServiceProvider();
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
