using System.Globalization;
using Domain.Entity;
using Domain.Enum;
using Domain.Services;
using Domain.Services.Admin;
using Domain.Validation;
using FluentValidation;
using Microsoft.Extensions.DependencyInjection;

namespace Ops.Commands.BrandImport;

internal sealed record ImportBrandSettings(CatalogSegment Segment, int Max, int MaxPages, int DelayMs, bool DryRun);

/// <summary>What one run did (the tests read it; the operator reads the table and the summary).</summary>
internal sealed class ImportBrandResult
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
    public Dictionary<ImportSkip, int> Skipped { get; } = [];
    public bool BrandCreated { get; set; }
    /// <summary>Null = ran to the end (enough products, or no candidate / page budget left).</summary>
    public string? Stopped { get; set; }
    /// <summary>Products of an earlier run that this run did not write: now out of stock / skipped, or not reached. Reported only.</summary>
    public List<string> NotTouched { get; } = [];
    public int Kept => Imported + Updated + Unchanged;
}

/// <summary>
/// import-brand (dev only) — and import-vakko, its alias for the Vakko source. Puts products of one brand's public
/// site into the catalog so the store shows real products and "Satın al" opens the product on the brand's site.
/// The source discovers candidates → one page at a time through the <see cref="PoliteFetcher"/> (sequential, a pause
/// between requests, hard caps, stops on 403 / 429) → the admin services (ICatalogService: same validation,
/// previous-price and price-drop rules as the admin panel), audited as ops:github-actions. Images are hot-linked,
/// never copied. No AI call. Idempotent: a re-run updates what changed and leaves the rest alone; products imported
/// earlier that are out of stock or no longer picked are reported, not retired.
/// </summary>
internal sealed class ImportBrandCommand(
    IBrandCatalogSource source,
    ISiteClient client,
    ICatalogService catalog,
    IValidator<ProductInput> productValidator,
    IValidator<BrandInput> brandValidator,
    IAuditLog audit,
    OpsOutput output,
    Func<TimeSpan, CancellationToken, Task>? pause = null,
    string commandName = OpsArguments.ImportBrand)
{
    /// <summary>This many unreadable pages in a row means the page format changed: stop instead of fetching hundreds more.</summary>
    public const int MaxConsecutiveParseErrors = 10;

    /// <summary>import-brand --brand … --segment …, or import-vakko (the Vakko source; women unless --segment men).</summary>
    public static async Task<int> RunAsync(IServiceProvider services, OpsArguments args, OpsOutput output, CancellationToken ct)
    {
        var source = BrandSources.Find(args.ImportBrandId)
                     ?? throw new InvalidOperationException($"no source registered for '{args.ImportBrandId}'");   // OpsArguments.Validate refuses it first
        using var http = new HttpSiteClient(source.Access);
        var command = new ImportBrandCommand(
            source,
            http,
            services.GetRequiredService<ICatalogService>(),
            services.GetRequiredService<IValidator<ProductInput>>(),
            services.GetRequiredService<IValidator<BrandInput>>(),
            services.GetRequiredService<IAuditLog>(),
            output,
            commandName: args.Command);
        var (exit, _) = await command.RunAsync(new ImportBrandSettings(args.ImportSegment, args.ImportMaxProducts, args.ImportMaxPages, args.ImportDelayMs, args.DryRun), ct);
        return exit;
    }

    /// <summary>import-brand --list: the registered sources, then the surveyed brands that have no source yet. No network, no AWS.</summary>
    public static int List(OpsOutput output)
    {
        var rows = BrandSources.All
            .Select(s => (IReadOnlyList<string>)[s.BrandId, s.DisplayName, s.WebsiteUrl, string.Join(", ", s.Segments.Select(g => g.Word())), "ready", $"--brand {s.BrandId}"])
            .Concat(BrandSources.Surveyed.Select(b => (IReadOnlyList<string>)[b.Id, b.Name, b.Site, b.Segment, "no source", b.Verdict]))
            .ToList();
        output.Summary("### import-brand --list\n");
        output.Table(["brand", "name", "site", "segments", "status", "note"], rows);
        return 0;
    }

    public async Task<(int Exit, ImportBrandResult Result)> RunAsync(ImportBrandSettings settings, CancellationToken ct)
    {
        var result = new ImportBrandResult();
        var segment = settings.Segment;
        var title = Title(settings);
        if (!source.Supplies(segment))
        {
            output.Error($"{source.BrandId} has no {segment.Word()}'s products");
            output.Summary($"{title}**{source.DisplayName} has no {segment.Word()}'s source**: nothing fetched, nothing written.\n");
            return (1, result);
        }

        var site = new PoliteFetcher(client, source.Access, TimeSpan.FromMilliseconds(settings.DelayMs), source.MaxDiscoveryRequests + settings.MaxPages, pause);
        var discovery = await source.DiscoverAsync(site, segment, ct);
        if (discovery.Error is not null)
        {
            output.Error(discovery.Error);
            output.Summary($"{title}**Discovery failed** (`{discovery.Error}`): no product page fetched, nothing written.\n");
            return (1, result);
        }
        var candidates = CandidatePicker.Pick(source, segment, discovery.Candidates, settings.MaxPages);
        result.Candidates = candidates.Count;
        output.Line($"{discovery.Summary}, {candidates.Count} candidate page(s) ({segment.Word()}'s apparel / shoes / bags, one colour per model); "
                    + $"target {settings.Max} product(s), at most {settings.MaxPages} page(s), {settings.DelayMs} ms between requests.");

        var stored = (await catalog.GetProductsAsync(ct))
            .Where(p => p.BrandId == source.BrandId && p.Segment == segment && p.Id.StartsWith(source.IdPrefix(), StringComparison.Ordinal))
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
        var parseErrors = 0;
        foreach (var candidate in candidates)
        {
            if (result.Kept >= settings.Max)
                break;

            var id = source.ProductId(candidate.Code);
            var page = await site.GetAsync(candidate.Url, source.PageTimeout, ct);   // the fetcher paces, caps and decides when to stop
            result.PagesFetched++;
            if (!page.Ok)
            {
                result.FetchFailed++;
                if (page.Status is not (403 or 429))
                    seenSkipped[id] = "fetch failed";
                rows.Add(Row(segment, candidate, null, null, $"fetch failed: {page.Error ?? "empty"}"));
                if (site.Stopped is not null)
                {
                    result.Stopped = site.Stopped;
                    break;
                }
                continue;
            }

            var product = source.ParseProduct(page.Body!, candidate, out var parseError);
            if (product is null)
            {
                result.ParseErrors++;
                seenSkipped[id] = "parse error";
                rows.Add(Row(segment, candidate, null, null, $"parse error: {parseError}"));
                if (++parseErrors >= MaxConsecutiveParseErrors)
                {
                    result.Stopped = $"{MaxConsecutiveParseErrors} unreadable pages in a row (page format changed?)";
                    break;
                }
                continue;
            }
            parseErrors = 0;

            var (mapped, skip) = SourceCatalogMapper.Map(source, segment, product);
            if (mapped is null)
            {
                result.Skipped[skip!.Value] = result.Skipped.GetValueOrDefault(skip.Value) + 1;
                seenSkipped[id] = SkipText(skip.Value, segment);
                rows.Add(Row(segment, candidate, product, null, $"skipped: {SkipText(skip.Value, segment)}"));
                continue;
            }

            var validation = await productValidator.ValidateAsync(mapped.Input, ct);
            if (!validation.IsValid)
            {
                result.Invalid++;
                seenSkipped[id] = "invalid";
                rows.Add(Row(segment, candidate, product, mapped, "invalid: " + string.Join(", ", validation.Errors.Select(e => e.ErrorCode).Distinct())));
                continue;
            }

            stored.TryGetValue(id, out var existing);
            if (existing is not null && SourceCatalogMapper.SameAsStored(existing, mapped.Input))
            {
                result.Unchanged++;
                written.Add(id);
                rows.Add(Row(segment, candidate, product, mapped, "unchanged"));
                continue;
            }
            if (settings.DryRun)
            {
                if (existing is null) result.Imported++; else result.Updated++;
                written.Add(id);
                rows.Add(Row(segment, candidate, product, mapped, existing is null ? "would import" : "would update"));
                continue;
            }

            try
            {
                var outcome = await WriteAsync(mapped, existing, ct);
                if (existing is null) result.Imported++; else result.Updated++;
                written.Add(id);
                rows.Add(Row(segment, candidate, product, mapped, outcome));
            }
            catch (InvalidOperationException ex)
            {
                result.WriteFailed++;
                rows.Add(Row(segment, candidate, product, mapped, $"write failed: {ex.Message}"));
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

    /// <summary>"### import-vakko (dry run)" for the alias as it always was; the generic command names the brand and the segment.</summary>
    private string Title(ImportBrandSettings settings)
    {
        var what = commandName == OpsArguments.ImportBrand
            ? $"{commandName} {source.BrandId} {settings.Segment.Word()}"
            : commandName + (settings.Segment == CatalogSegment.Women ? "" : $" {settings.Segment.Word()}");
        return $"### {what}{(settings.DryRun ? " (dry run)" : "")}\n\n";
    }

    /// <summary>The brand is created once (admin brand upsert, validated and audited); an existing brand is never rewritten.</summary>
    private async Task<string?> EnsureBrandAsync(bool dryRun, ImportBrandResult result, CancellationToken ct)
    {
        if (await catalog.GetBrandAsync(source.BrandId, ct) is not null)
            return null;
        var input = source.BrandInput();
        var validation = await brandValidator.ValidateAsync(input, ct);
        if (!validation.IsValid)
            return "brand input rejected: " + string.Join(", ", validation.Errors.Select(e => e.ErrorCode).Distinct());
        result.BrandCreated = true;
        if (dryRun)
            return null;
        var (_, brand) = await catalog.UpsertBrandAsync(input, ct);
        await audit.WriteAsync(OpsHost.Actor, "brand.upsert", "brand", brand.Id, null,
            new { brand.Id, brand.Name, brand.WebsiteUrl, source = brand.Source.ToString(), importedBy = "ops " + commandName }, null, ct);
        return null;
    }

    private async Task<string> WriteAsync(MappedProduct mapped, CatalogProductEntity? existing, CancellationToken ct)
    {
        var input = mapped.Input;
        // A new product the site sells below its list price: the list price is written first, so the catalog's own
        // price-change rule stores it as the previous price (no watcher exists yet — nobody is notified).
        if (existing is null && mapped.StrikePriceMinor is { } list)
            Check(await catalog.UpsertProductAsync(input with { PriceMinor = list }, ct));
        var write = Check(await catalog.UpsertProductAsync(input, ct));

        var before = existing is null ? null : new { existing.Id, existing.PriceMinor, existing.Sizes, images = existing.Images.Count };
        await audit.WriteAsync(OpsHost.Actor, "product.upsert", "product", input.Id, before,
            new { input.Id, input.PriceMinor, previousPriceMinor = write.Product!.PreviousPriceMinor, input.Sizes, images = input.Images?.Count ?? 0, importedBy = "ops " + commandName }, null, ct);

        if (existing is null)
            return "imported";
        return write.PriceDropped ? $"updated (price drop, {write.WatchersFlagged} watcher(s) flagged)" : "updated";
    }

    private static ProductWriteResult Check(ProductWriteResult write) =>
        write.Outcome is CatalogWriteOutcome.Created or CatalogWriteOutcome.Updated && write.Product is not null
            ? write
            : throw new InvalidOperationException($"catalog refused the product ({write.Outcome})");

    private void Report(string title, ImportBrandSettings settings, ImportBrandResult result)
    {
        var verb = settings.DryRun ? "would be " : "";
        var skipped = Enum.GetValues<ImportSkip>().Where(s => result.Skipped.ContainsKey(s)).Select(s => $"{SkipText(s, settings.Segment)} {result.Skipped[s]}").ToList();
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
            lines.Add($"Brand '{source.BrandId}' {verb}created.");
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

    private IReadOnlyList<string> Row(CatalogSegment segment, SourceCandidate candidate, SourceProduct? product, MappedProduct? mapped, string outcome) =>
    [
        candidate.Code,
        mapped?.Input.Category.ToString() ?? source.CategoryOf(segment, candidate.CategoryHint, null)?.ToString() ?? candidate.CategoryHint,
        mapped?.Input.Name?["tr"] ?? (product is null ? candidate.NameHint ?? "" : SourceText.DisplayName(product.Name, source.TitleCaseNames)),
        mapped is null ? "" : Money(mapped.Input.PriceMinor) + (mapped.StrikePriceMinor is { } list ? $" (list {Money(list)})" : ""),
        mapped is null ? "" : mapped.Input.Sizes is { Count: > 0 } sizes ? string.Join(' ', sizes) : "one size",
        outcome,
    ];

    private static string Money(long minor) => (minor / 100m).ToString(minor % 100 == 0 ? "#,0" : "#,0.00", CultureInfo.InvariantCulture) + " TRY";

    private static string SkipText(ImportSkip skip, CatalogSegment segment) => skip switch
    {
        ImportSkip.OtherSegment => $"not {segment.Word()}",
        ImportSkip.OtherBrand => "other brand",
        ImportSkip.UnknownCategory => "unknown category",
        ImportSkip.OutOfStock => "out of stock",
        ImportSkip.NoPrice => "no price in TRY",
        _ => "no image",
    };
}
