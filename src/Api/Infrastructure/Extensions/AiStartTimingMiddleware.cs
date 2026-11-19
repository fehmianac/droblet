using System.Text.RegularExpressions;
using Infrastructure.Telemetry;

namespace Api.Infrastructure.Extensions;

/// <summary>
/// Start path of the AI features: times the POST that queues a job (validation, entitlement / credit, DynamoDB, SQS send)
/// and emits it like a worker stage — structured log + EMF (Droblet/Ai, Job = the start route, Stage = api_start /
/// db / sqs_send, ColdStart on the first request of an instance).
/// </summary>
public static partial class AiStartTimingMiddleware
{
    private static int _requests;

    [GeneratedRegex(@"^/v1/tenant/(?<route>stylist/outfit|stylist/week|trip/[^/]+/pack|tryon|tryon/week|palette/analyze|item-draft|item-draft/[^/]+/select|item-draft/[^/]+/retry)/?$",
        RegexOptions.ExplicitCapture | RegexOptions.IgnoreCase)]
    private static partial Regex StartRoute();

    /// <summary>"stylist/outfit" → "start.stylist_outfit"; ids are dropped (trip/{id}/pack → start.trip_pack). Null = not an AI start.</summary>
    public static string? Label(string method, string? path)
    {
        if (!HttpMethods.IsPost(method) || path is null || StartRoute().Match(path) is not { Success: true } match)
            return null;
        var parts = match.Groups["route"].Value.ToLowerInvariant().Split('/');
        var named = parts.Length == 3 ? [parts[0], parts[2]] : parts;
        return "start." + string.Join('_', named).Replace('-', '_');
    }

    public static IApplicationBuilder UseAiStartTimings(this IApplicationBuilder app) => app.Use(async (context, next) =>
    {
        var label = Label(context.Request.Method, context.Request.Path.Value);
        if (label is null)
        {
            await next();
            return;
        }

        var timings = AiTelemetry.Begin();
        timings.JobKind = label;
        timings.ColdStart = Interlocked.Increment(ref _requests) == 1;
        try
        {
            using (timings.Measure("api_start"))
                await next();
            var logger = context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("AiStartTiming");
            logger.LogInformation("AI start {Route} {Status} cold {Cold}: {Timings}", label, context.Response.StatusCode, timings.ColdStart,
                EmbeddedMetrics.Compact(timings.Snapshot()));
            EmbeddedMetrics.Emit(timings, Environment.GetEnvironmentVariable("STAGE") ?? "local", DateTimeOffset.UtcNow);
        }
        finally
        {
            AiTelemetry.End();
        }
    });
}
