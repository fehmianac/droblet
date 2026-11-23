using System.Globalization;
using System.Net;
using Domain.Entity;
using Domain.Services;
using Domain.Services.Admin;
using Domain.Validation;
using FluentValidation;
using Microsoft.Extensions.DependencyInjection;

namespace Ops.Commands;

/// <summary>One GET of a public vakko.com page. Status 0 = no response (network error or timeout).</summary>
internal sealed record VakkoResponse(int Status, string? Body, string? Error = null)
{
    public bool Ok => Status is >= 200 and < 300 && Body is not null;
}

/// <summary>The site as import-vakko reads it (HttpClient in the tool, a fake in the tests).</summary>
internal interface IVakkoSource
{
    Task<VakkoResponse> GetAsync(string url, TimeSpan timeout, CancellationToken ct);
}

/// <summary>
/// Plain sequential GETs with a browser-like user agent. Only https://www.vakko.com/… without a query string is ever
/// requested: robots.txt allows product pages and the sitemap, and disallows the account / basket / search / filter URLs.
/// </summary>
internal sealed class HttpVakkoSource : IVakkoSource, IDisposable
{
    private readonly HttpClient _http;

    public HttpVakkoSource()
    {
        _http = new HttpClient(new SocketsHttpHandler { AutomaticDecompression = DecompressionMethods.All, AllowAutoRedirect = true, MaxAutomaticRedirections = 3 })
        {
            Timeout = Timeout.InfiniteTimeSpan,   // every request has its own deadline (20 s for a page)
        };
        _http.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0");
        _http.DefaultRequestHeaders.Accept.ParseAdd("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
        _http.DefaultRequestHeaders.AcceptLanguage.ParseAdd("tr-TR,tr;q=0.9");
    }

    public static bool IsAllowedUrl(string url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps && uri.Host == "www.vakko.com"
        && uri.Query.Length == 0 && uri.Fragment.Length == 0;

    public async Task<VakkoResponse> GetAsync(string url, TimeSpan timeout, CancellationToken ct)
    {
        if (!IsAllowedUrl(url))
            return new VakkoResponse(0, null, "url not allowed");
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(timeout);
        try
        {
            using var response = await _http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
            var status = (int)response.StatusCode;
            if (!response.IsSuccessStatusCode)
                return new VakkoResponse(status, null, $"HTTP {status}");
            return new VakkoResponse(status, await response.Content.ReadAsStringAsync(deadline.Token));
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            return new VakkoResponse(0, null, "timeout");
        }
        catch (Exception ex) when (ex is HttpRequestException or IOException)
        {
            return new VakkoResponse(0, null, ex.GetType().Name);
        }
    }

    public void Dispose() => _http.Dispose();
}

internal sealed record ImportVakkoSettings(int Max, int MaxPages, int DelayMs, bool DryRun);

/// <summary>What one run did (the tests read it; the operator reads the table and the summary).</summary>
internal sealed class ImportVakkoResult
{
    public int Candidates { get; set; }
    public int PagesFetched { get; set; }
    public int Imported { get; set; }
    public int Updated { get; set; }
    public int Unchanged { get; set; }
    public int FetchFailed { get; set; }
    public int ParseErrors { get; set; }
    public int Invalid { get; set; }
    public int WriteFailed { get; set; }
    public Dictionary<VakkoSkip, int> Skipped { get; } = [];
    public bool BrandCreated { get; set; }
    /// <summary>Null = ran to the end (enough products, or no candidate / page budget left).</summary>
    public string? Stopped { get; set; }
    /// <summary>Products of an earlier run that this run did not write: now out of stock / skipped, or not reached. Reported only.</summary>
    public List<string> NotTouched { get; } = [];
    public int Kept => Imported + Updated + Unchanged;
}

/// <summary>
/// import-vakko (dev only; owner request 2026-11-23): a first trial that puts women's products of Vakko into the
/// catalog so the store shows real products and "Satın al" opens the product on vakko.com. Sitemap → candidates →
/// one page at a time (sequential, a pause between requests) → the admin services (ICatalogService: same validation,
/// previous-price and price-drop rules as the admin panel), audited as ops:github-actions. Images are hot-linked from
/// cdn.vakko.com, never copied. No AI call. Idempotent: a re-run updates what changed and leaves the rest alone;
/// products imported earlier that are out of stock or no longer picked are reported, not retired.
/// </summary>
internal sealed class ImportVakkoCommand(
    IVakkoSource source,
    ICatalogService catalog,
    IValidator<ProductInput> productValidator,
    IValidator<BrandInput> brandValidator,
    IAuditLog audit,
    OpsOutput output,
    Func<TimeSpan, CancellationToken, Task>? pause = null)
{
    public const int MaxConsecutiveFailures = 3;
    /// <summary>This many unreadable pages in a row means the page format changed: stop instead of fetching hundreds more.</summary>
    public const int MaxConsecutiveParseErrors = 10;
    public static readonly TimeSpan PageTimeout = TimeSpan.FromSeconds(20);
    public static readonly TimeSpan SitemapTimeout = TimeSpan.FromSeconds(120);   // ≈ 35 MB uncompressed

    private readonly Func<TimeSpan, CancellationToken, Task> _pause = pause ?? Task.Delay;

    public static async Task<int> RunAsync(IServiceProvider services, OpsArguments args, OpsOutput output, CancellationToken ct)
    {
        using var http = new HttpVakkoSource();
        var command = new ImportVakkoCommand(
            http,
            services.GetRequiredService<ICatalogService>(),
            services.GetRequiredService<IValidator<ProductInput>>(),
            services.GetRequiredService<IValidator<BrandInput>>(),
            services.GetRequiredService<IAuditLog>(),
            output);
        var (exit, _) = await command.RunAsync(new ImportVakkoSettings(args.VakkoMaxProducts, args.VakkoMaxPages, args.VakkoDelayMs, args.DryRun), ct);
        return exit;
    }

    public async Task<(int Exit, ImportVakkoResult Result)> RunAsync(ImportVakkoSettings settings, CancellationToken ct)
    {
        var result = new ImportVakkoResult();
        var title = $"### import-vakko{(settings.DryRun ? " (dry run)" : "")}\n\n";

        var sitemap = await source.GetAsync(VakkoSitemapParser.SitemapUrl, SitemapTimeout, ct);
        if (!sitemap.Ok)
        {
            output.Error($"sitemap: {sitemap.Error ?? "empty"}");
            output.Summary($"{title}**Sitemap could not be read** (`{sitemap.Error ?? "empty"}`): nothing fetched, nothing written.\n");
            return (1, result);
        }
        IReadOnlyList<VakkoSitemapEntry> entries;
        try
        {
            entries = VakkoSitemapParser.Parse(sitemap.Body!);
        }
        catch (System.Xml.XmlException ex)
        {
            output.Error($"sitemap: not XML ({ex.Message})");
            output.Summary($"{title}**Sitemap is not XML**: nothing fetched, nothing written.\n");
            return (1, result);
        }
        var candidates = VakkoCandidatePicker.Pick(entries, settings.MaxPages);
        result.Candidates = candidates.Count;
        output.Line($"Sitemap: {entries.Count} products, {candidates.Count} candidate page(s) (women's apparel / shoes / bags, one colour per model); "
                    + $"target {settings.Max} product(s), at most {settings.MaxPages} page(s), {settings.DelayMs} ms between requests.");

        var stored = (await catalog.GetProductsAsync(ct))
            .Where(p => p.BrandId == VakkoCatalogMapper.BrandId && p.Id.StartsWith(VakkoCatalogMapper.IdPrefix, StringComparison.Ordinal))
            .ToDictionary(p => p.Id, StringComparer.Ordinal);

        if (await EnsureBrandAsync(settings.DryRun, result, ct) is { } brandError)
        {
            output.Error(brandError);
            output.Summary($"{title}**Brand not written:** {brandError}\n");
            return (1, result);
        }

        var rows = new List<IReadOnlyList<string>>();
        var written = new HashSet<string>(StringComparer.Ordinal);
        var seenSkipped = new Dictionary<string, string>(StringComparer.Ordinal);
        int failures = 0, parseErrors = 0;
        foreach (var candidate in candidates)
        {
            if (result.Kept >= settings.Max)
                break;
            if (result.PagesFetched > 0)
                await _pause(TimeSpan.FromMilliseconds(settings.DelayMs), ct);

            var id = VakkoCatalogMapper.ProductId(candidate.Code);
            var page = await source.GetAsync(candidate.Url, PageTimeout, ct);
            result.PagesFetched++;
            if (page.Status is 403 or 429)
            {
                result.FetchFailed++;
                rows.Add(Row(candidate, null, null, $"fetch failed: HTTP {page.Status}"));
                result.Stopped = $"HTTP {page.Status} from the site — stopped at once";
                break;
            }
            if (!page.Ok)
            {
                result.FetchFailed++;
                seenSkipped[id] = "fetch failed";
                rows.Add(Row(candidate, null, null, $"fetch failed: {page.Error ?? "empty"}"));
                if (++failures >= MaxConsecutiveFailures)
                {
                    result.Stopped = $"{MaxConsecutiveFailures} failed requests in a row";
                    break;
                }
                continue;
            }
            failures = 0;

            var product = VakkoPageParser.Parse(page.Body!, candidate.Code, out var parseError);
            if (product is null)
            {
                result.ParseErrors++;
                seenSkipped[id] = "parse error";
                rows.Add(Row(candidate, null, null, $"parse error: {parseError}"));
                if (++parseErrors >= MaxConsecutiveParseErrors)
                {
                    result.Stopped = $"{MaxConsecutiveParseErrors} unreadable pages in a row (page format changed?)";
                    break;
                }
                continue;
            }
            parseErrors = 0;

            var (mapped, skip) = VakkoCatalogMapper.Map(candidate, product);
            if (mapped is null)
            {
                result.Skipped[skip!.Value] = result.Skipped.GetValueOrDefault(skip.Value) + 1;
                seenSkipped[id] = SkipText(skip.Value);
                rows.Add(Row(candidate, product, null, $"skipped: {SkipText(skip.Value)}"));
                continue;
            }

            var validation = await productValidator.ValidateAsync(mapped.Input, ct);
            if (!validation.IsValid)
            {
                result.Invalid++;
                seenSkipped[id] = "invalid";
                rows.Add(Row(candidate, product, mapped, "invalid: " + string.Join(", ", validation.Errors.Select(e => e.ErrorCode).Distinct())));
                continue;
            }

            stored.TryGetValue(id, out var existing);
            if (existing is not null && VakkoCatalogMapper.SameAsStored(existing, mapped.Input))
            {
                result.Unchanged++;
                written.Add(id);
                rows.Add(Row(candidate, product, mapped, "unchanged"));
                continue;
            }
            if (settings.DryRun)
            {
                if (existing is null) result.Imported++; else result.Updated++;
                written.Add(id);
                rows.Add(Row(candidate, product, mapped, existing is null ? "would import" : "would update"));
                continue;
            }

            try
            {
                var outcome = await WriteAsync(mapped, existing, ct);
                if (existing is null) result.Imported++; else result.Updated++;
                written.Add(id);
                rows.Add(Row(candidate, product, mapped, outcome));
            }
            catch (InvalidOperationException ex)
            {
                result.WriteFailed++;
                rows.Add(Row(candidate, product, mapped, $"write failed: {ex.Message}"));
                result.Stopped = "a catalog write failed";
                break;
            }
        }

        foreach (var id in stored.Keys.Where(id => !written.Contains(id)).Order(StringComparer.Ordinal))
            result.NotTouched.Add(seenSkipped.TryGetValue(id, out var why) ? $"{id} ({why})" : $"{id} (not picked this run)");

        output.Table(["code", "category", "name", "price", "sizes", "outcome"], rows);
        Report(title, settings, result);
        return (result.Stopped is null ? 0 : 1, result);
    }

    /// <summary>The brand is created once (admin brand upsert, validated and audited); an existing brand is never rewritten.</summary>
    private async Task<string?> EnsureBrandAsync(bool dryRun, ImportVakkoResult result, CancellationToken ct)
    {
        if (await catalog.GetBrandAsync(VakkoCatalogMapper.BrandId, ct) is not null)
            return null;
        var input = VakkoCatalogMapper.Brand;
        var validation = await brandValidator.ValidateAsync(input, ct);
        if (!validation.IsValid)
            return "brand input rejected: " + string.Join(", ", validation.Errors.Select(e => e.ErrorCode).Distinct());
        result.BrandCreated = true;
        if (dryRun)
            return null;
        var (_, brand) = await catalog.UpsertBrandAsync(input, ct);
        await audit.WriteAsync(OpsHost.Actor, "brand.upsert", "brand", brand.Id, null,
            new { brand.Id, brand.Name, brand.WebsiteUrl, source = brand.Source.ToString(), importedBy = "ops import-vakko" }, null, ct);
        return null;
    }

    private async Task<string> WriteAsync(VakkoMapped mapped, CatalogProductEntity? existing, CancellationToken ct)
    {
        var input = mapped.Input;
        // A new product the site sells below its list price: the list price is written first, so the catalog's own
        // price-change rule stores it as the previous price (no watcher exists yet — nobody is notified).
        if (existing is null && mapped.StrikePriceMinor is { } list)
            Check(await catalog.UpsertProductAsync(input with { PriceMinor = list }, ct));
        var write = Check(await catalog.UpsertProductAsync(input, ct));

        var before = existing is null ? null : new { existing.Id, existing.PriceMinor, existing.Sizes, images = existing.Images.Count };
        await audit.WriteAsync(OpsHost.Actor, "product.upsert", "product", input.Id, before,
            new { input.Id, input.PriceMinor, previousPriceMinor = write.Product!.PreviousPriceMinor, input.Sizes, images = input.Images?.Count ?? 0, importedBy = "ops import-vakko" }, null, ct);

        if (existing is null)
            return "imported";
        return write.PriceDropped ? $"updated (price drop, {write.WatchersFlagged} watcher(s) flagged)" : "updated";
    }

    private static ProductWriteResult Check(ProductWriteResult write) =>
        write.Outcome is CatalogWriteOutcome.Created or CatalogWriteOutcome.Updated && write.Product is not null
            ? write
            : throw new InvalidOperationException($"catalog refused the product ({write.Outcome})");

    private void Report(string title, ImportVakkoSettings settings, ImportVakkoResult result)
    {
        var verb = settings.DryRun ? "would be " : "";
        var skipped = Enum.GetValues<VakkoSkip>().Where(s => result.Skipped.ContainsKey(s)).Select(s => $"{SkipText(s)} {result.Skipped[s]}").ToList();
        if (result.ParseErrors > 0) skipped.Add($"parse error {result.ParseErrors}");
        if (result.FetchFailed > 0) skipped.Add($"fetch failed {result.FetchFailed}");
        if (result.Invalid > 0) skipped.Add($"invalid {result.Invalid}");
        if (result.WriteFailed > 0) skipped.Add($"write failed {result.WriteFailed}");

        var lines = new List<string>
        {
            $"Pages fetched: {result.PagesFetched} (of {result.Candidates} candidates, cap {settings.MaxPages}).",
            $"Products: {result.Imported} {verb}imported, {result.Updated} {verb}updated, {result.Unchanged} unchanged — {result.Kept} of the {settings.Max} asked for.",
            $"Skipped: {(skipped.Count == 0 ? "none" : string.Join(", ", skipped))}.",
        };
        if (result.BrandCreated)
            lines.Add($"Brand '{VakkoCatalogMapper.BrandId}' {verb}created.");
        if (result.Stopped is not null)
            lines.Add($"STOPPED EARLY: {result.Stopped}.");
        else if (result.Kept < settings.Max)
            lines.Add("Fewer products than asked for: the candidates or the page budget ran out (raise --max-pages).");
        if (result.NotTouched.Count > 0)
            lines.Add($"Imported earlier, not touched by this run ({result.NotTouched.Count}): {string.Join(", ", result.NotTouched.Take(60))}{(result.NotTouched.Count > 60 ? ", …" : "")}.");

        foreach (var line in lines)
            output.Line(line);
        output.Summary(title + string.Join("\n", lines.Select(l => "- " + l)) + "\n");
    }

    private static IReadOnlyList<string> Row(VakkoSitemapEntry candidate, VakkoProduct? product, VakkoMapped? mapped, string outcome) =>
    [
        candidate.Code,
        mapped?.Input.Category.ToString() ?? VakkoCandidatePicker.CategoryOf(candidate.CategorySlug)?.ToString() ?? candidate.CategorySlug,
        mapped?.Input.Name?["tr"] ?? (product is null ? candidate.NameSlug : VakkoCatalogMapper.TitleCase(product.Name)),
        mapped is null ? "" : Money(mapped.Input.PriceMinor) + (mapped.StrikePriceMinor is { } list ? $" (list {Money(list)})" : ""),
        mapped is null ? "" : mapped.Input.Sizes is { Count: > 0 } sizes ? string.Join(' ', sizes) : "one size",
        outcome,
    ];

    private static string Money(long minor) => (minor / 100m).ToString(minor % 100 == 0 ? "#,0" : "#,0.00", CultureInfo.InvariantCulture) + " TRY";

    private static string SkipText(VakkoSkip skip) => skip switch
    {
        VakkoSkip.NotWomen => "not women",
        VakkoSkip.OtherBrand => "other brand",
        VakkoSkip.UnknownCategory => "unknown category",
        VakkoSkip.OutOfStock => "out of stock",
        VakkoSkip.NoPrice => "no price in TRY",
        _ => "no image",
    };
}
