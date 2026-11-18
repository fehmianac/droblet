using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace ApiTests;

/// <summary>docs/api/README.md lists every endpoint the Api really maps (method + path) and nothing that does not exist.</summary>
public class ApiIndexTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static string Readme()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "docs", "api", "README.md")))
            directory = directory.Parent;
        Assert.NotNull(directory);
        return File.ReadAllText(Path.Combine(directory.FullName, "docs", "api", "README.md"));
    }

    [Fact]
    public void Readme_ListsEveryMappedEndpoint_AndOnlyThose()
    {
        _ = factory.CreateClient(); // builds the host
        var mapped = factory.Services.GetRequiredService<EndpointDataSource>().Endpoints
            .OfType<RouteEndpoint>()
            .Where(e => e.RoutePattern.RawText?.StartsWith("v1/", StringComparison.Ordinal) == true)
            .SelectMany(e => (e.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods ?? []).Select(m => $"| {m} | `{e.RoutePattern.RawText}` |"))
            .ToHashSet(StringComparer.Ordinal);
        var listed = Readme().Split('\n')
            .Where(line => line.StartsWith("| GET |") || line.StartsWith("| POST |") || line.StartsWith("| PUT |") || line.StartsWith("| DELETE |") || line.StartsWith("| PATCH |"))
            .Select(line => string.Join(" | ", line.Split(" | ").Take(2)) + " |")
            .ToHashSet(StringComparer.Ordinal);

        Assert.True(mapped.Count > 100);
        Assert.Empty(mapped.Except(listed).Order());   // mapped but missing from the index
        Assert.Empty(listed.Except(mapped).Order());   // listed but not mapped
    }

    [Fact]
    public void Readme_PointsEveryDocumentedRow_ToAnExistingContractDocument()
    {
        var readme = Readme();
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !Directory.Exists(Path.Combine(directory.FullName, "docs", "api")))
            directory = directory.Parent;

        foreach (var document in new[] { "wardrobe-looks-plan-stylist.md", "store-social-settings.md" })
        {
            Assert.Contains($"]({document})", readme);
            Assert.True(File.Exists(Path.Combine(directory!.FullName, "docs", "api", document)));
        }
    }
}
