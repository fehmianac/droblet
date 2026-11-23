using System.Text.Json;
using System.Text.Json.Serialization;
using Amazon.S3;
using Amazon.S3.Model;
using Domain.Enum;
using Domain.Services;
using Domain.Validation;
using Microsoft.Extensions.DependencyInjection;

namespace Ops.Commands;

internal sealed record FeedSeedPost(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("file")] string File,
    [property: JsonPropertyName("occasion")] Occasion Occasion,
    [property: JsonPropertyName("titleTr")] string TitleTr,
    [property: JsonPropertyName("titleEn")] string TitleEn,
    [property: JsonPropertyName("hoursAgo")] double HoursAgo);

/// <summary>
/// seed-feed-posts --dir &lt;folder&gt;: Akış editor posts from pictures the owner supplied. Reads &lt;folder&gt;/manifest.json and
/// the JPEG files next to it, uploads each picture to the public catalog image bucket (catalog/feed/{id}.jpg — the same
/// place the admin panel uploads to) and writes the post through the admin feed service ("Droblet Edit", published, no
/// products). Idempotent: the same id overwrites the same picture and post. Dev only; no AI call.
/// </summary>
internal static class SeedFeedPostsCommand
{
    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true, Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) } };

    public static async Task<int> RunAsync(IServiceProvider services, OpsArguments args, OpsOutput output, string stage, CancellationToken ct)
    {
        if (args.Option("dir") is not { } dir || !File.Exists(Path.Combine(dir, "manifest.json")))
        {
            output.Error("--dir <folder with manifest.json> is required.");
            return 2;
        }
        var posts = JsonSerializer.Deserialize<List<FeedSeedPost>>(await File.ReadAllTextAsync(Path.Combine(dir, "manifest.json"), ct), Json) ?? [];
        var problems = posts.Where(p => !FeedInputRules.IsId(p.Id) || string.IsNullOrWhiteSpace(p.TitleTr) || string.IsNullOrWhiteSpace(p.TitleEn)
                                        || !File.Exists(Path.Combine(dir, p.File))).Select(p => p.Id).ToList();
        if (posts.Count == 0 || problems.Count > 0 || posts.Select(p => p.Id).Distinct(StringComparer.Ordinal).Count() != posts.Count)
        {
            output.Error($"manifest.json: no posts, a repeated id, or an invalid entry ({string.Join(", ", problems)}).");
            return 2;
        }
        output.Line($"{posts.Count} posts from {dir}");
        if (args.DryRun)
            return 0;

        var s3 = services.GetRequiredService<IAmazonS3>();
        var feed = services.GetRequiredService<IFeedService>();
        var now = DateTime.UtcNow;
        var rows = new List<IReadOnlyList<string>>();
        var failed = 0;
        foreach (var post in posts)
        {
            var key = $"catalog/feed/{post.Id.ToLowerInvariant()}.jpg";
            await using (var stream = File.OpenRead(Path.Combine(dir, post.File)))
            {
                var put = new PutObjectRequest { BucketName = OpsHost.CatalogBucket(stage), Key = key, InputStream = stream, ContentType = "image/jpeg" };
                put.Headers.CacheControl = "public, max-age=86400";
                await s3.PutObjectAsync(put, ct);
            }
            var (outcome, _, _) = await feed.UpsertPostAsync(new FeedPostInput(
                post.Id, null,
                new FeedAuthorInput(FeedAuthorKind.Edit, new Dictionary<string, string> { ["tr"] = "Droblet Edit", ["en"] = "Droblet Edit" }, null, null),
                post.Occasion,
                new Dictionary<string, string> { ["tr"] = post.TitleTr, ["en"] = post.TitleEn },
                null,
                [$"{OpsHost.CatalogBaseUrl(stage)}/{key}"],
                [],
                now.AddHours(-post.HoursAgo), 0, Published: true), ct);
            if (outcome is not (Domain.Services.CatalogWriteOutcome.Created or Domain.Services.CatalogWriteOutcome.Updated))
                failed++;
            rows.Add([post.Id, post.Occasion.ToString(), post.TitleTr, outcome.ToString()]);
        }
        output.Table(["id", "occasion", "title", "outcome"], rows);
        output.Summary($"### seed-feed-posts\n\n**{posts.Count - failed}** of {posts.Count} posts written.\n");
        return failed == 0 ? 0 : 1;
    }
}
