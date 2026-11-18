using Amazon.CloudWatchLogs;
using Amazon.CloudWatchLogs.Model;

namespace Ops.Commands;

/// <summary>
/// logs --function stylist [--minutes 30] [--filter OpenAI]: the last N minutes of the function's log group
/// /droblet/{stage}/lambda/{fn} (template.yaml LoggingConfig, with retention). Events still in the old auto-created
/// group /aws/lambda/droblet-{stage}-{fn} (before the switch) are read too, until that group is deleted.
/// The Lambdas never log prompts, answers, images or keys (OpenAiProvider), so the events are safe to print.
/// </summary>
internal static class LogsCommand
{
    public static string LogGroup(string stage, string function) => $"/droblet/{stage}/lambda/{function}";

    /// <summary>The group Lambda created on its own before LoggingConfig pointed it elsewhere (no retention).</summary>
    public static string LegacyLogGroup(string stage, string function) => $"/aws/lambda/droblet-{stage}-{function}";

    public static async Task<int> RunAsync(OpsArguments args, OpsOutput output, CancellationToken ct)
    {
        var events = await FetchAsync(args.Stage, args.Option("function")!, TimeSpan.FromMinutes(args.IntOption("minutes", 30)),
            args.Option("filter"), args.IntOption("limit", 200), ct);
        output.Line($"{events.Count} event(s) from {LogGroup(args.Stage, args.Option("function")!)}");
        foreach (var (at, message) in events)
            output.Line($"{at:HH:mm:ss} {message.TrimEnd()}");
        output.Summary($"### logs {args.Option("function")} ({events.Count} events)\n\n```\n" +
                       string.Join('\n', events.TakeLast(80).Select(e => $"{e.At:HH:mm:ss} {Trim(e.Message)}")) + "\n```");
        return 0;
    }

    public static async Task<IReadOnlyList<(DateTime At, string Message)>> FetchAsync(string stage, string function, TimeSpan window, string? filter, int limit, CancellationToken ct)
    {
        using var client = new AmazonCloudWatchLogsClient();
        var result = new List<(DateTime, string)>();
        foreach (var group in new[] { LogGroup(stage, function), LegacyLogGroup(stage, function) })
        {
            var request = new FilterLogEventsRequest
            {
                LogGroupName = group,
                StartTime = DateTimeOffset.UtcNow.Subtract(window).ToUnixTimeMilliseconds(),
                FilterPattern = string.IsNullOrWhiteSpace(filter) ? null : $"\"{filter.Replace("\"", "", StringComparison.Ordinal)}\"",
                Limit = Math.Clamp(limit, 1, 10_000),
            };
            try
            {
                var fromGroup = 0;
                do
                {
                    var response = await client.FilterLogEventsAsync(request, ct);
                    var events = (response.Events ?? []).Select(e => (DateTimeOffset.FromUnixTimeMilliseconds(e.Timestamp ?? 0).UtcDateTime, e.Message ?? "")).ToList();
                    result.AddRange(events);
                    fromGroup += events.Count;
                    request.NextToken = response.NextToken;
                } while (request.NextToken is not null && fromGroup < limit);
            }
            catch (ResourceNotFoundException)
            {
                // No invocation yet (new group) or already deleted (legacy group).
            }
        }
        return result.OrderBy(e => e.Item1).TakeLast(limit).ToList();
    }

    private static string Trim(string message) => message.Length > 400 ? message[..400] + "…" : message.TrimEnd();
}
