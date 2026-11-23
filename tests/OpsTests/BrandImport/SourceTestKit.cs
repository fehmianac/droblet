using Domain.Enum;
using Domain.Services;
using Domain.Services.Admin;
using Domain.Validation;
using FluentValidation;
using Ops;
using Ops.Commands.BrandImport;
using Tests.Shared;

namespace OpsTests.BrandImport;

/// <summary>What the tests of the sitemap-and-page sources (Gap, Sarar, Beymen) share: saved pages, a fake site, the real catalog service in memory.</summary>
internal static class SourceTestKit
{
    public static string Fixture(string brand, string name) => File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", brand, name));

    public static string Sitemap(params string[] urls) =>
        $"""<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{string.Concat(urls.Select(u => $"<url><loc>{u}</loc></url>"))}</urlset>""";

    public static string SitemapIndex(params string[] urls) =>
        $"""<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{string.Concat(urls.Select(u => $"<sitemap><loc>{u}</loc></sitemap>"))}</sitemapindex>""";

    public sealed class FakeSite : ISiteClient
    {
        public Dictionary<string, SourceResponse> Pages { get; } = new(StringComparer.Ordinal);
        public List<string> Requests { get; } = [];

        public void Add(string url, string body) => Pages[url] = new SourceResponse(200, body);

        public Task<SourceResponse> GetAsync(string url, TimeSpan timeout, CancellationToken ct)
        {
            Requests.Add(url);
            return Task.FromResult(Pages.TryGetValue(url, out var page) ? page : new SourceResponse(404, null, "HTTP 404"));
        }
    }

    public sealed class Harness(IBrandCatalogSource source)
    {
        public WorkerTestHost Host { get; } = new();
        public FakeSite Site { get; } = new();
        public OpsOutput Output { get; } = new(Path.Combine(Path.GetTempPath(), "ops-import-brand-test-" + source.BrandId));

        public ICatalogService Catalog => Host.Get<ICatalogService>();

        public Task<(int Exit, ImportBrandResult Result)> RunAsync(CatalogSegment segment, int max = 100, int maxPages = 400, bool dryRun = false) =>
            new ImportBrandCommand(source, Site, Catalog, Host.Get<IValidator<ProductInput>>(), Host.Get<IValidator<BrandInput>>(), Host.Get<IAuditLog>(), Output,
                    (_, _) => Task.CompletedTask)
                .RunAsync(new ImportBrandSettings(segment, max, maxPages, 1200, dryRun), CancellationToken.None);
    }
}
