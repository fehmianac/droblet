using System.Diagnostics;
using Amazon.S3;
using Amazon.S3.Model;
using Domain.Entity;
using Domain.Enum;
using Domain.Services;
using Domain.Services.Admin;
using Domain.Services.Ai;
using Infrastructure.Ai;
using Microsoft.Extensions.DependencyInjection;

namespace Ops.Commands;

/// <summary>Which library items get an image in this run. Pure — unit-tested (idempotency, --only, --force, cap).</summary>
internal static class LibraryImagePlan
{
    public sealed record Selection(IReadOnlyList<LibraryItemEntity> ToGenerate, IReadOnlyList<(string Id, string Reason)> Skipped, IReadOnlyList<string> UnknownIds);

    /// <summary>An item "has an image" once an absolute https URL is stored (the seed's relative keys are placeholders with no file behind them).</summary>
    public static bool HasImage(LibraryItemEntity item) => item.ImageKey?.StartsWith("https://", StringComparison.OrdinalIgnoreCase) == true;

    public static Selection Select(IReadOnlyList<LibraryItemEntity> items, IReadOnlyList<string> only, bool force, int budget)
    {
        var known = items.Select(i => i.Id).ToHashSet(StringComparer.Ordinal);
        var unknown = only.Where(id => !known.Contains(id)).ToList();
        var wanted = only.Count == 0 ? items : items.Where(i => only.Contains(i.Id, StringComparer.Ordinal)).ToList();

        var generate = new List<LibraryItemEntity>();
        var skipped = new List<(string, string)>();
        foreach (var item in wanted.OrderBy(i => i.SortOrder).ThenBy(i => i.Id, StringComparer.Ordinal))
        {
            if (item.Retired)
                skipped.Add((item.Id, "retired"));
            else if (HasImage(item) && !force)
                skipped.Add((item.Id, "has image (use --force)"));
            else if (generate.Count >= budget)
                skipped.Add((item.Id, "image-call cap reached"));
            else
                generate.Add(item);
        }
        return new Selection(generate, skipped, unknown);
    }

    public const string Background = "#E8E1D7";

    /// <summary>One house style for all items; only the product sentence changes.</summary>
    public static string Prompt(LibraryItemEntity item)
    {
        var name = item.Name.TryGetValue("en", out var en) && !string.IsNullOrWhiteSpace(en) ? en : item.Name.GetValueOrDefault("tr", item.Id);
        var colors = item.ColorIds
            .Select(id => ColorCatalog.All.FirstOrDefault(c => c.Id == id))
            .Where(c => c is not null)
            .Select(c => $"{c!.Name.GetValueOrDefault("en", c.Id).ToLowerInvariant()} ({c.Hex})")
            .ToList();
        var colour = colors.Count switch
        {
            0 => "",
            1 => $"Colour: {colors[0]}. ",
            _ => $"Colours: {colors[0]} as the main colour, with {string.Join(" and ", colors.Skip(1))}. ",
        };
        var fabric = string.IsNullOrWhiteSpace(item.Fabric) ? "" : $"Material: {item.Fabric}, with a true-to-life {item.Fabric} texture. ";

        return
            $"Professional e-commerce product photograph of a single {AudienceFor(item.Segment, name)}{name.ToLowerInvariant()}. {colour}{fabric}" +
            Presentation(item.Category) + " " +
            $"Seamless, perfectly uniform solid sand-coloured studio background, exact colour {Background}, edge to edge, no gradient, no floor line. " +
            "Soft diffused studio lighting from the upper left, a very subtle soft contact shadow under the product, true colours, crisp fabric detail. " +
            "The product is centred and fills about 75% of the square frame with even margins; nothing is cropped. " +
            "Minimal, premium, editorial catalogue style, consistent with a set of matching product shots. " +
            "Plain, unbranded design: no logos, no brand marks, no labels or tags visible, no text, no watermark. " +
            "No people, no hands, no visible mannequin, no hanger, no props.";
    }

    /// <summary>"women's " (the phase 1 text), "men's " or nothing for a unisex piece. A name that already says "men's" keeps one.</summary>
    public static string Audience(CatalogSegment segment) => segment switch
    {
        CatalogSegment.Men => "men's ",
        CatalogSegment.Unisex => "",
        _ => "women's ",
    };

    private static string AudienceFor(CatalogSegment segment, string name) =>
        Audience(segment) is { Length: > 0 } audience && name.StartsWith(audience.TrimEnd(), StringComparison.OrdinalIgnoreCase) ? "" : Audience(segment);

    public static string Presentation(ItemCategory category) => category switch
    {
        ItemCategory.Top => "Shown on an invisible ghost mannequin, straight front view, natural 3D shape of the garment, sleeves relaxed.",
        ItemCategory.Bottom => "Shown on an invisible ghost mannequin, straight front view, full length from waistband to hem.",
        ItemCategory.Dress => "Shown on an invisible ghost mannequin, straight front view, full length from neckline to hem.",
        ItemCategory.Outerwear => "Shown on an invisible ghost mannequin, straight front view, closed, natural 3D shape, full length.",
        ItemCategory.Shoes => "A pair, placed side by side, photographed from a three-quarter front-side angle at product height.",
        ItemCategory.Bag => "Standing upright, front three-quarter view; handles or a long strap neatly coiled or draped so that the whole bag and strap stay inside the frame.",
        ItemCategory.Accessory => "Neatly folded and softly draped, top-down flat-lay view.",
        ItemCategory.Beachwear => "Shown on an invisible ghost mannequin, straight front view.",
        ItemCategory.Skiwear => "Shown on an invisible ghost mannequin, straight front view, zipped, natural 3D shape.",
        _ => "Straight front view.",
    };
}

/// <summary>WebP size checks without an image library: dimensions from the RIFF header (VP8, VP8L, VP8X).</summary>
internal static class WebpImage
{
    public const int MaxSide = 1200;
    public const int MaxBytes = 250 * 1024;

    public static bool IsWebp(byte[] data) =>
        data.Length >= 30 && data[0] == 'R' && data[1] == 'I' && data[2] == 'F' && data[3] == 'F' && data[8] == 'W' && data[9] == 'E' && data[10] == 'B' && data[11] == 'P';

    public static (int Width, int Height)? Dimensions(byte[] data)
    {
        if (!IsWebp(data))
            return null;
        var chunk = System.Text.Encoding.ASCII.GetString(data, 12, 4);
        return chunk switch
        {
            "VP8 " when data.Length >= 30 => ((data[26] | data[27] << 8) & 0x3FFF, (data[28] | data[29] << 8) & 0x3FFF),
            "VP8L" when data.Length >= 25 => (1 + (data[21] | (data[22] & 0x3F) << 8), 1 + ((data[22] >> 6) | data[23] << 2 | (data[24] & 0x0F) << 10)),
            "VP8X" when data.Length >= 30 => (1 + (data[24] | data[25] << 8 | data[26] << 16), 1 + (data[27] | data[28] << 8 | data[29] << 16)),
            _ => null,
        };
    }

    public static bool Fits(byte[] data) =>
        data.Length < MaxBytes && Dimensions(data) is { } d && d.Width <= MaxSide && d.Height <= MaxSide;

    /// <summary>Re-encodes with cwebp (libwebp tools, installed by the workflow) until the file fits. Null when cwebp is missing or nothing fits.</summary>
    public static async Task<byte[]?> ReencodeAsync(byte[] source, CancellationToken ct)
    {
        var dir = Directory.CreateTempSubdirectory("ops-webp-");
        try
        {
            var input = Path.Combine(dir.FullName, "in.img");
            await File.WriteAllBytesAsync(input, source, ct);
            foreach (var quality in new[] { 82, 74, 66, 58 })
            {
                var output = Path.Combine(dir.FullName, $"out-{quality}.webp");
                var resize = Dimensions(source) is { } d && Math.Max(d.Width, d.Height) <= MaxSide ? "" : $"-resize {MaxSide} 0 ";
                var start = new ProcessStartInfo("cwebp", $"-quiet -q {quality} -m 6 {resize}\"{input}\" -o \"{output}\"") { RedirectStandardError = true, RedirectStandardOutput = true };
                Process? process;
                try
                {
                    process = Process.Start(start);
                }
                catch (System.ComponentModel.Win32Exception)
                {
                    return null; // cwebp not installed
                }
                if (process is null)
                    return null;
                await process.WaitForExitAsync(ct);
                if (process.ExitCode == 0 && File.Exists(output))
                {
                    var bytes = await File.ReadAllBytesAsync(output, ct);
                    if (Fits(bytes))
                        return bytes;
                }
            }
            return null;
        }
        finally
        {
            dir.Delete(recursive: true);
        }
    }
}

/// <summary>
/// generate-library-images: one image-model call per ready-library item → WebP on the public catalog bucket
/// (catalog/library/{id}.webp) → the item's imageUrl set through IAdminLibraryService (the admin "edit library item"
/// path), audited as library.upsert by ops:github-actions. Idempotent: items with an image are skipped unless --force.
/// </summary>
internal static class LibraryImagesCommand
{
    public const decimal DefaultPricePerImage = 0.25m;

    public static async Task<int> RunAsync(IServiceProvider services, OpsArguments args, OpsOutput output, CancellationToken ct)
    {
        var library = services.GetRequiredService<IAdminLibraryService>();
        var audit = services.GetRequiredService<IAuditLog>();
        var provider = services.GetRequiredService<OpenAiProvider>();
        var s3 = services.GetRequiredService<IAmazonS3>();
        var budget = new ImageCallBudget(args.MaxImageCalls);
        var price = args.DecimalOption("price-per-image", DefaultPricePerImage);
        var quality = args.Option("quality") ?? "high";

        // The admin list (stored items, or the built-in seed before the first write) → full entities.
        var items = new List<LibraryItemEntity>();
        foreach (var dto in await library.ListAsync(ct))
            if (await library.GetAsync(dto.Id, ct) is { } entity)
                items.Add(entity);

        var plan = LibraryImagePlan.Select(items, args.OnlyIds, args.Force, budget.Max);
        foreach (var id in plan.UnknownIds)
            output.Error($"--only: unknown library id {id}");
        output.Line($"{items.Count} library items · to generate {plan.ToGenerate.Count} · skipped {plan.Skipped.Count} · cap {budget.Max} image calls");
        output.Line($"Cost estimate: {plan.ToGenerate.Count} × ~${price:0.00} (assumed per {quality} 1024² image) ≈ ${plan.ToGenerate.Count * price:0.00}");
        if (args.DryRun)
        {
            foreach (var item in plan.ToGenerate)
                output.Line($"[dry-run] {item.Id}: {LibraryImagePlan.Prompt(item)}");
            output.Table(["id", "outcome"], plan.ToGenerate.Select(i => (IReadOnlyList<string>)[i.Id, "would generate"])
                .Concat(plan.Skipped.Select(s => (IReadOnlyList<string>)[s.Id, "skip: " + s.Reason])));
            return plan.UnknownIds.Count == 0 ? 0 : 1;
        }

        var rows = new List<IReadOnlyList<string>>();
        var failures = 0;
        var baseUrl = OpsHost.CatalogBaseUrl(args.Stage);
        var bucket = OpsHost.CatalogBucket(args.Stage);
        foreach (var item in plan.ToGenerate)
        {
            if (!budget.TryTake())
            {
                rows.Add([item.Id, "skip: image-call cap reached", "", ""]);
                continue;
            }
            var watch = Stopwatch.StartNew();
            try
            {
                var image = await provider.GenerateImageAsync(
                    new ImageGenerationRequest(LibraryImagePlan.Prompt(item), "1024x1024", "webp", 80, quality), ct);
                var data = image.Data;
                if (!WebpImage.Fits(data))
                    data = await WebpImage.ReencodeAsync(data, ct) ?? throw new InvalidOperationException(
                        $"image does not fit (webp={WebpImage.IsWebp(image.Data)}, {image.Data.Length / 1024} KB, {WebpImage.Dimensions(image.Data)}) and cwebp could not shrink it");

                var key = $"catalog/library/{item.Id}.webp";
                await s3.PutObjectAsync(new PutObjectRequest
                {
                    BucketName = bucket,
                    Key = key,
                    InputStream = new MemoryStream(data),
                    ContentType = "image/webp",
                    Headers = { CacheControl = "public, max-age=86400" },
                }, ct);
                output.SaveFile($"library/{item.Id}.webp", data);

                // Version suffix: a re-generated image (--force) is not served from a stale cache.
                var url = $"{baseUrl}/{key}?v={DateTime.UtcNow:yyyyMMddHHmmss}";
                var before = new { item.Id, imageUrl = item.ImageKey };
                var (errors, saved) = await library.UpsertAsync(new LibraryItemInput(
                    item.Id, item.Name, item.Category, item.ColorIds, item.Fabric, item.Seasons, url, item.SortOrder, item.Retired, item.Segment), ct);
                if (errors.Count > 0 || saved is null)
                    throw new InvalidOperationException("library upsert rejected: " + string.Join(", ", errors.Select(e => $"{e.Key}={string.Join('/', e.Value)}")));
                await audit.WriteAsync(OpsHost.Actor, "library.upsert", "library", item.Id, before, new { item.Id, imageUrl = url, generatedBy = "ops generate-library-images" }, null, ct);

                var dims = WebpImage.Dimensions(data);
                rows.Add([item.Id, "ok", $"{dims?.Width}x{dims?.Height} · {data.Length / 1024} KB · {watch.Elapsed.TotalSeconds:0}s", url]);
            }
            catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
            {
                failures++;
                rows.Add([item.Id, "failed", $"{watch.Elapsed.TotalSeconds:0}s", ex.Message]);
                output.Error($"{item.Id}: {ex.GetType().Name}: {ex.Message}");
            }
        }
        rows.AddRange(plan.Skipped.Select(s => (IReadOnlyList<string>)[s.Id, "skip: " + s.Reason, "", ""]));

        output.Summary($"### generate-library-images ({args.Stage})\n\nImage calls: **{budget.Used}** (cap {budget.Max}) · estimated cost ≈ ${budget.Used * price:0.00}\n");
        output.Table(["id", "outcome", "image", "url / error"], rows);
        WriteContactSheet(output, plan.ToGenerate.Select(i => i.Id));
        output.Line($"Image calls made: {budget.Used}");
        return failures == 0 && plan.UnknownIds.Count == 0 ? 0 : 1;
    }

    private static void WriteContactSheet(OpsOutput output, IEnumerable<string> ids)
    {
        var cells = string.Concat(ids.Where(id => File.Exists(Path.Combine(output.Directory, "library", id + ".webp")))
            .Select(id => $"<figure><img src=\"{id}.webp\" alt=\"{id}\"><figcaption>{id}</figcaption></figure>"));
        var html = "<!doctype html><meta charset=utf-8><title>Library images</title><style>body{font:13px system-ui;background:#fff;margin:16px}" +
                   "main{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}img{width:100%;display:block}figure{margin:0}</style><main>" + cells + "</main>";
        output.SaveFile("library/index.html", System.Text.Encoding.UTF8.GetBytes(html));
    }
}
