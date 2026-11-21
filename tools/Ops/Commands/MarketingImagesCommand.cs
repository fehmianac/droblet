using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Serialization;
using Amazon.S3;
using Amazon.S3.Model;
using Domain.Services.Ai;
using Infrastructure.Ai;
using Microsoft.Extensions.DependencyInjection;

namespace Ops.Commands;

/// <summary>A checked-in prompt file for marketing images (e.g. ops-presets/welcome-images.json).</summary>
internal sealed record MarketingImageFile(
    [property: JsonPropertyName("size")] string Size,
    [property: JsonPropertyName("quality")] string Quality,
    [property: JsonPropertyName("format")] string Format,
    [property: JsonPropertyName("style")] string Style,
    [property: JsonPropertyName("images")] IReadOnlyList<MarketingImageSpec> Images)
{
    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true, ReadCommentHandling = JsonCommentHandling.Skip };

    public static MarketingImageFile Parse(string json) =>
        JsonSerializer.Deserialize<MarketingImageFile>(json, Json) ?? throw new InvalidDataException("empty prompt file");

    /// <summary>Problems that stop the run before any call (empty list, duplicate or bad ids, unsupported size/format).</summary>
    public IReadOnlyList<string> Problems()
    {
        var problems = new List<string>();
        if (Images is null || Images.Count == 0)
            problems.Add("no images");
        if (Size is not ("1024x1024" or "1024x1536" or "1536x1024" or "auto"))
            problems.Add($"size '{Size}' (1024x1024 | 1024x1536 | 1536x1024 | auto)");
        if (Format is not ("jpeg" or "webp" or "png"))
            problems.Add($"format '{Format}' (jpeg | webp | png)");
        if (Quality is not ("low" or "medium" or "high" or "auto"))
            problems.Add($"quality '{Quality}' (low | medium | high | auto)");
        foreach (var image in Images ?? [])
        {
            if (!OpsArguments.MarketingIdPattern().IsMatch(image.Id ?? ""))
                problems.Add($"id '{image.Id}' (a-z, 0-9, -)");
            if (string.IsNullOrWhiteSpace(image.Prompt))
                problems.Add($"{image.Id}: empty prompt");
        }
        foreach (var id in (Images ?? []).GroupBy(i => i.Id).Where(g => g.Count() > 1).Select(g => g.Key))
            problems.Add($"duplicate id '{id}'");
        return problems;
    }

    public string PromptFor(MarketingImageSpec image) => string.IsNullOrWhiteSpace(Style) ? image.Prompt : $"{image.Prompt.Trim()} {Style.Trim()}";

    /// <summary>The images of this run: --only (in file order), then capped at <paramref name="max"/>.</summary>
    public (IReadOnlyList<MarketingImageSpec> Selected, IReadOnlyList<string> Unknown) Select(IReadOnlyList<string> only, int max)
    {
        var unknown = only.Where(id => Images.All(i => i.Id != id)).ToList();
        var wanted = only.Count == 0 ? Images : Images.Where(i => only.Contains(i.Id, StringComparer.Ordinal)).ToList();
        return (wanted.Take(max).ToList(), unknown);
    }
}

internal sealed record MarketingImageSpec(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("segment")] string? Segment,
    [property: JsonPropertyName("prompt")] string Prompt);

/// <summary>
/// generate-marketing-images: one image-model call per entry of a checked-in prompt file (default
/// ops-presets/welcome-images.json) with the configured image model → the run's output folder (workflow artifact) and
/// the private photo bucket under marketing/{file}/{id}.{ext}, with a 7-day presigned URL. Hard cap
/// <see cref="OpsArguments.MaxMarketingImageCalls"/> calls per run, never retried. Dev only, no user content.
/// </summary>
internal static class MarketingImagesCommand
{
    public const string DefaultPromptFile = "ops-presets/welcome-images.json";

    public static async Task<int> RunAsync(IServiceProvider services, OpsArguments args, OpsOutput output, CancellationToken ct)
    {
        var path = args.Option("prompts") ?? DefaultPromptFile;
        var file = MarketingImageFile.Parse(await File.ReadAllTextAsync(path, ct));
        if (file.Problems() is { Count: > 0 } problems)
        {
            output.Error($"{path}: " + string.Join("; ", problems));
            return 2;
        }
        var max = args.MaxMarketingCalls;
        var (selected, unknown) = file.Select(args.OnlyIds, max);
        foreach (var id in unknown)
            output.Error($"--only: unknown image id {id}");
        if (unknown.Count > 0)
            return 1;

        output.Line($"{path}: {file.Images.Count} prompts · this run {selected.Count} · cap {max} image calls · {file.Size} {file.Quality} {file.Format}");
        if (args.DryRun)
        {
            foreach (var image in selected)
                output.Line($"[dry-run] {image.Id} ({image.Segment}): {file.PromptFor(image)}");
            output.Table(["id", "segment", "outcome"], selected.Select(i => (IReadOnlyList<string>)[i.Id, i.Segment ?? "", "would generate"]));
            output.Summary($"### generate-marketing-images (dry-run)\n\nWould make **{selected.Count}** image calls (cap {max}); no call made.\n");
            return 0;
        }

        var provider = services.GetRequiredService<OpenAiProvider>();
        var s3 = services.GetRequiredService<IAmazonS3>();
        var bucket = OpsHost.PhotoBucket(args.Stage);
        var folder = Path.GetFileNameWithoutExtension(path);
        var extension = file.Format == "jpeg" ? "jpg" : file.Format;
        var budget = new ImageCallBudget(max);
        var rows = new List<IReadOnlyList<string>>();
        var failures = 0;
        foreach (var image in selected)
        {
            if (!budget.TryTake())
            {
                rows.Add([image.Id, "skip: cap reached", "", ""]);
                continue;
            }
            var watch = Stopwatch.StartNew();
            try
            {
                var result = await provider.GenerateImageAsync(new ImageGenerationRequest(file.PromptFor(image), file.Size, file.Format, 92, file.Quality), ct);
                var name = $"{image.Id}.{extension}";
                output.SaveFile($"marketing/{name}", result.Data);
                var key = $"marketing/{folder}/{name}";
                await s3.PutObjectAsync(new PutObjectRequest
                {
                    BucketName = bucket,
                    Key = key,
                    InputStream = new MemoryStream(result.Data),
                    ContentType = file.Format == "jpeg" ? "image/jpeg" : $"image/{file.Format}",
                }, ct);
                var url = await s3.GetPreSignedURLAsync(new GetPreSignedUrlRequest { BucketName = bucket, Key = key, Verb = HttpVerb.GET, Expires = DateTime.UtcNow.AddDays(7) });
                rows.Add([image.Id, "ok", $"{result.Data.Length / 1024} KB · {watch.Elapsed.TotalSeconds:0}s", url]);
            }
            catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
            {
                // No retry: a failed call still counts against the cap.
                failures++;
                rows.Add([image.Id, "failed", $"{watch.Elapsed.TotalSeconds:0}s", ex.Message]);
                output.Error($"{image.Id}: {ex.GetType().Name}: {ex.Message}");
            }
        }

        output.Summary($"### generate-marketing-images ({args.Stage})\n\nImage calls: **{budget.Used}** (cap {max}) · files in the run artifact under `marketing/` and s3://{bucket}/marketing/{folder}/\n");
        output.Table(["id", "outcome", "image", "url / error"], rows);
        output.Line($"Image calls made: {budget.Used}");
        return failures == 0 ? 0 : 1;
    }
}
