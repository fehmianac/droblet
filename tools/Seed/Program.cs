using Domain.Options;
using Domain.Services;
using Domain.Validation;
using Infrastructure;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

// Global data seeding (BACKEND_ENGINEER.md §Global veri / seed): files in seed/ are validated and written through the
// same services as the admin API — never by hand in the console.
//
//   dotnet run --project tools/Seed -- validate [seedDir]        schema, duplicate ids, references, translations
//   dotnet run --project tools/Seed -- apply    [seedDir]        validate, then upsert into TABLE_NAME (AWS credentials required)
//
// The files in the repo are PLACEHOLDER data (no real prices or links).

var command = args.Length > 0 ? args[0] : "validate";
var seedDirectory = args.Length > 1 ? args[1] : Path.Combine(Directory.GetCurrentDirectory(), "seed");
if (command is not ("validate" or "apply") || !Directory.Exists(seedDirectory))
{
    Console.Error.WriteLine("Usage: Seed <validate|apply> [seedDir]   (seedDir defaults to ./seed)");
    return 2;
}

var localization = new LocalizationOptions();
var bundle = SeedData.Load(seedDirectory);
var errors = SeedData.Validate(bundle, localization);
Console.WriteLine($"{bundle.Brands.Count} brands, {bundle.Products.Count} products, {bundle.Edits.Count} weekly edits, " +
                  $"{bundle.Posts.Count} feed posts, {bundle.Stories.Count} feed stories in {seedDirectory}");
if (errors.Count > 0)
{
    foreach (var error in errors)
        Console.Error.WriteLine("  " + error);
    Console.Error.WriteLine($"{errors.Count} problem(s). Nothing was written.");
    return 1;
}
if (command == "validate")
{
    Console.WriteLine("Seed files are valid.");
    return 0;
}

var tableName = Environment.GetEnvironmentVariable("TABLE_NAME");
if (string.IsNullOrWhiteSpace(tableName))
{
    Console.Error.WriteLine("Set TABLE_NAME (e.g. droblet-dev-table) before 'apply' — the target table is never guessed.");
    return 2;
}

var services = new ServiceCollection();
services.AddLogging(logging => logging.AddSimpleConsole().SetMinimumLevel(LogLevel.Warning));
services.AddDrobletCore(new ConfigurationBuilder().Build());
await using var provider = services.BuildServiceProvider();
var catalog = provider.GetRequiredService<ICatalogService>();
var content = provider.GetRequiredService<IContentService>();
var feed = provider.GetRequiredService<IFeedService>();

foreach (var brand in bundle.Brands)
    await catalog.UpsertBrandAsync(brand, CancellationToken.None);

var products = await catalog.BulkUpsertProductsAsync(bundle.Products, CancellationToken.None);
foreach (var row in products.Rows.Where(r => r.Outcome is not ("created" or "updated")))
    Console.Error.WriteLine($"  product {row.Id}: {row.Outcome}");

var editFailures = 0;
foreach (var edit in bundle.Edits)
{
    var (outcome, _, missing) = await content.UpsertEditAsync(edit, CancellationToken.None);
    if (outcome == CatalogWriteOutcome.ProductNotFound)
    {
        editFailures++;
        Console.Error.WriteLine($"  edit {edit.Id}: product_not_found ({string.Join(", ", missing)})");
    }
}

var feedFailures = 0;
foreach (var post in bundle.Posts)
{
    var (outcome, _, missing) = await feed.UpsertPostAsync(post, CancellationToken.None);
    if (outcome == CatalogWriteOutcome.ProductNotFound)
    {
        feedFailures++;
        Console.Error.WriteLine($"  feed post {post.Id}: product_not_found ({string.Join(", ", missing)})");
    }
}
foreach (var story in bundle.Stories)
{
    var (outcome, _, missing) = await feed.UpsertStoryAsync(story, CancellationToken.None);
    if (outcome == CatalogWriteOutcome.ProductNotFound)
    {
        feedFailures++;
        Console.Error.WriteLine($"  feed story {story.Id}: product_not_found ({string.Join(", ", missing)})");
    }
}

Console.WriteLine($"Applied to {tableName}: {bundle.Brands.Count} brands, {products.Created} products created, {products.Updated} updated, {products.Failed} failed, " +
                  $"{bundle.Edits.Count - editFailures} weekly edits, {bundle.Posts.Count + bundle.Stories.Count - feedFailures} feed posts / stories.");
return products.Failed == 0 && editFailures == 0 && feedFailures == 0 ? 0 : 1;
