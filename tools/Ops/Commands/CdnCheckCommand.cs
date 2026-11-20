using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;

namespace Ops.Commands;

/// <summary>
/// cdn-check [--base https://cdn.alatech.co]: takes a few published item images (publicImageKey) of the stage and fetches
/// them through the CDN, printing status, content type, Cloudflare cache status and S3's answer. No AI; read only.
/// </summary>
internal static class CdnCheckCommand
{
    public static async Task<int> RunAsync(OpsArguments args, OpsOutput output, CancellationToken ct)
    {
        var baseUrl = (args.Option("base") ?? "https://cdn.alatech.co").TrimEnd('/');
        using var dynamo = new AmazonDynamoDBClient();
        var keys = new List<string>();
        var request = new ScanRequest
        {
            TableName = OpsHost.TableName(args.Stage),
            FilterExpression = "attribute_exists(publicImageKey)",
            ProjectionExpression = "publicImageKey",
        };
        do
        {
            var page = await dynamo.ScanAsync(request, ct);
            keys.AddRange((page.Items ?? []).Select(i => i["publicImageKey"].S).Where(k => !string.IsNullOrEmpty(k)));
            request.ExclusiveStartKey = page.LastEvaluatedKey;
        } while (keys.Count < 3 && request.ExclusiveStartKey is { Count: > 0 });

        if (keys.Count == 0)
        {
            output.Error($"no published item image on {args.Stage}");
            return 1;
        }

        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        var failures = 0;
        output.Line("| url | status | content-type | cf-cache | bytes |");
        output.Line("|---|---|---|---|---|");
        foreach (var key in keys.Take(3))
        {
            var url = $"{baseUrl}/{key}";
            using var response = await http.GetAsync(url, ct);
            var body = await response.Content.ReadAsByteArrayAsync(ct);
            var cache = response.Headers.TryGetValues("cf-cache-status", out var c) ? string.Join(",", c) : "-";
            var type = response.Content.Headers.ContentType?.MediaType ?? "-";
            output.Line($"| {url} | {(int)response.StatusCode} | {type} | {cache} | {body.Length} |");
            if (!response.IsSuccessStatusCode || type != "image/webp")
            {
                failures++;
                output.Line($"  body: {System.Text.Encoding.UTF8.GetString(body.AsSpan(0, Math.Min(body.Length, 300)))}");
            }
        }
        return failures == 0 ? 0 : 1;
    }
}
