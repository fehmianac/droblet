using Amazon.Extensions.Configuration.SystemsManager;
using Domain.Entity;
using Domain.Enum;
using Domain.Options;
using Infrastructure;
using Infrastructure.Ai;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Ops;

/// <summary>
/// The same services the Api and the workers run (AddDrobletCore / AddDrobletApiServices / AddDrobletAdmin), wired
/// to one stage: table, buckets and config come from the stack's fixed names and from Parameter Store
/// (/droblet/{stage}/api and /droblet/{stage}/worker, the latter holds Ai and Ai/ApiKey). AWS credentials come from
/// the environment (GitHub Actions deploy keys).
/// </summary>
internal static class OpsHost
{
    /// <summary>Audit actor of every write made by this tool (admin audit log: adminId / adminEmail).</summary>
    public const string ActorId = "ops:github-actions";

    public static AdminUserEntity Actor { get; } = new()
    {
        Id = ActorId,
        Email = ActorId,
        Name = "Ops (GitHub Actions)",
        Role = AdminRole.SuperAdmin,
    };

    public static string TableName(string stage) => $"droblet-{stage}-table";
    public static string PhotoBucket(string stage) => $"droblet-{stage}-photos";
    public static string CatalogBucket(string stage) => $"droblet-{stage}-catalog-images";
    public static string Region => Environment.GetEnvironmentVariable("AWS_REGION") is { Length: > 0 } r ? r : "eu-central-1";
    public static string CatalogBaseUrl(string stage) => $"https://{CatalogBucket(stage)}.s3.{Region}.amazonaws.com";

    public static ServiceProvider Build(string stage, OpsOutput output)
    {
        // DynamoDbConstant reads TABLE_NAME once: set it before any repository is created. Never guessed for prod by default.
        Environment.SetEnvironmentVariable("TABLE_NAME", TableName(stage));
        Environment.SetEnvironmentVariable("STAGE", stage);

        var builder = new ConfigurationBuilder();
        // The price list of template.yaml as the base: a branch can measure costs before its template is deployed;
        // the stage's own worker/Ai/Pricing (SSM, below) wins once it exists.
        if (TemplatePricing.Json() is { } pricing)
            builder.AddInMemoryCollection(TemplatePricing.Flatten(pricing, "Ai:Pricing"));
        var configuration = builder
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["STAGE"] = stage,
                ["Photos:Bucket"] = PhotoBucket(stage),
                ["CatalogImages:Bucket"] = CatalogBucket(stage),
                ["CatalogImages:PublicBaseUrl"] = CatalogBaseUrl(stage),
            })
            .AddSystemsManager(source =>
            {
                source.Path = $"/droblet/{stage}/api";
                source.Optional = true;
                source.ParameterProcessor = new JsonOrStringParameterProcessor();
            })
            .AddSystemsManager(source =>
            {
                source.Path = $"/droblet/{stage}/worker";
                source.Optional = true;
                source.ParameterProcessor = new JsonOrStringParameterProcessor();
            })
            // Push secrets (push-test): the notifier's own section.
            .AddSystemsManager(source =>
            {
                source.Path = $"/droblet/{stage}/notifier";
                source.Optional = true;
                source.ParameterProcessor = new JsonOrStringParameterProcessor();
            })
            // Operator calls (image generation at high quality) take longer than a worker's interactive budget.
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Ai:TimeoutSeconds"] = "240" })
            .Build();

        var services = new ServiceCollection();
        services.AddLogging(logging => logging.AddSimpleConsole(o => o.SingleLine = true).SetMinimumLevel(LogLevel.Warning));
        services.AddSingleton(output);
        services.AddDrobletCore(configuration);
        services.AddDrobletApiServices(configuration);
        services.AddDrobletAdmin(configuration);
        // Same provider class as the workers; the handler only copies the error body of a failed call into the
        // operator output (requests here never carry user content).
        services.AddSingleton(sp => new OpenAiProvider(
            new HttpClient(new ErrorBodyCapture(output) { InnerHandler = new HttpClientHandler() }) { Timeout = Timeout.InfiniteTimeSpan },
            sp.GetRequiredService<IOptionsMonitor<AiOptions>>(),
            sp.GetRequiredService<ILogger<OpenAiProvider>>()));
        return services.BuildServiceProvider();
    }
}

/// <summary>Prints status + body of a failed AI call so an operator can see exactly what the API said.</summary>
internal sealed class ErrorBodyCapture(OpsOutput output) : DelegatingHandler
{
    public List<string> Errors { get; } = [];

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var response = await base.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            await response.Content.LoadIntoBufferAsync(cancellationToken);
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            var line = $"AI {request.RequestUri?.AbsolutePath} -> {(int)response.StatusCode}: {(body.Length > 1500 ? body[..1500] + "…" : body)}";
            Errors.Add(line);
            output.Error(line);
        }
        return response;
    }
}
