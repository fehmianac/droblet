using System.Diagnostics;
using Domain.Entity;
using Domain.Manager;
using Domain.Services.Ai;
using Microsoft.Extensions.DependencyInjection;

namespace Ops.Commands;

/// <summary>
/// look-cover-sample: renders the AI flat-lay look cover (prompt look.cover.image, the configured image model and
/// Image.LookCoverSize / LookCoverQuality) for a few fixed outfits made of ready-library pieces — no user content — so the
/// owner can judge the prompt. Output: the run artifact under look-cover/. Hard cap <see cref="OpsArguments.MaxLookCoverSamples"/>
/// image calls per run, never retried. Dev only.
/// </summary>
internal static class LookCoverSampleCommand
{
    private static readonly (string Id, string[] Pieces)[] Outfits =
    [
        ("office", ["lib-white-shirt", "lib-black-trousers", "lib-navy-blazer", "lib-black-ankle-boots", "lib-black-tote"]),
        ("weekend", ["lib-cream-knit", "lib-blue-jeans", "lib-beige-trench", "lib-white-sneakers", "lib-tan-crossbody"]),
        ("dinner", ["lib-little-black-dress", "lib-camel-coat", "lib-black-heels", "lib-silk-scarf"]),
    ];

    public static async Task<int> RunAsync(IServiceProvider services, OpsArguments args, OpsOutput output, CancellationToken ct)
    {
        var max = Math.Clamp(args.IntOption("max", 0), 0, OpsArguments.MaxLookCoverSamples);
        var repository = services.GetRequiredService<IRepository>();
        var renderer = services.GetRequiredService<ILookCoverRenderer>();
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
        var budget = new ImageCallBudget(max);
        var rows = new List<IReadOnlyList<string>>();
        var failures = 0;

        foreach (var (id, pieceIds) in Outfits.Take(max))
        {
            var images = new List<ImageInput>();
            foreach (var pieceId in pieceIds)
            {
                var item = await repository.GetAsync<LibraryItemEntity>(LibraryItemEntity.GetPk(), LibraryItemEntity.GetSk(pieceId), ct);
                if (item?.ImageKey is not { } url || !url.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                    continue;   // a piece without a generated library image is left out
                using var response = await http.GetAsync(url, ct);
                if (!response.IsSuccessStatusCode)
                    continue;
                images.Add(new ImageInput(await response.Content.ReadAsByteArrayAsync(ct), response.Content.Headers.ContentType?.MediaType ?? "image/webp"));
            }
            if (images.Count < 2)
            {
                rows.Add([id, "skip: fewer than 2 piece images", ""]);
                continue;
            }
            if (!budget.TryTake())
            {
                rows.Add([id, "skip: cap reached", ""]);
                continue;
            }
            var watch = Stopwatch.StartNew();
            try
            {
                var cover = await renderer.RenderFlatlayAsync(images, ct);
                var extension = cover.ContentType.EndsWith("png", StringComparison.Ordinal) ? "png" : cover.ContentType.EndsWith("jpeg", StringComparison.Ordinal) ? "jpg" : "webp";
                output.SaveFile($"look-cover/{id}.{extension}", cover.Data);
                rows.Add([id, "ok", $"{images.Count} pieces · {cover.Data.Length / 1024} KB · {watch.Elapsed.TotalSeconds:0}s"]);
            }
            catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
            {
                failures++;
                rows.Add([id, "failed", ex.Message]);
                output.Error($"{id}: {ex.GetType().Name}: {ex.Message}");
            }
        }

        output.Summary($"### look-cover-sample ({args.Stage})\n\nImage calls: **{budget.Used}** (cap {max}) · files in the run artifact under `look-cover/`\n");
        output.Table(["outfit", "outcome", "detail"], rows);
        output.Line($"Image calls made: {budget.Used}");
        return failures == 0 ? 0 : 1;
    }
}
