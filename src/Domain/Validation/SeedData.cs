using System.Text.Json;
using System.Text.Json.Serialization;
using Domain.Options;
using FluentValidation;
using Microsoft.Extensions.Options;

namespace Domain.Validation;

/// <summary>
/// seed/catalog/brands.json, seed/catalog/products.json, seed/content/weekly-edits.json, seed/content/feed.json (Akış posts
/// and stories) — same shapes as the admin API bodies.
/// </summary>
public sealed record SeedBundle(
    IReadOnlyList<BrandInput> Brands,
    IReadOnlyList<ProductInput> Products,
    IReadOnlyList<WeeklyEditInput> Edits,
    IReadOnlyList<FeedPostInput>? FeedPosts = null,
    IReadOnlyList<FeedStoryInput>? FeedStories = null)
{
    public IReadOnlyList<FeedPostInput> Posts => FeedPosts ?? [];
    public IReadOnlyList<FeedStoryInput> Stories => FeedStories ?? [];
}

/// <summary>
/// Seed validation shared by tools/Seed and the test that guards the files in the repo: schema (the admin validators),
/// duplicate ids, references (product → brand, edit → product) and a translation for EVERY supported language.
/// </summary>
public static class SeedData
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase, allowIntegerValues: false) },
        ReadCommentHandling = JsonCommentHandling.Skip,
    };

    public static SeedBundle Load(string seedDirectory)
    {
        T Read<T>(string relative) where T : new()
        {
            var path = Path.Combine(seedDirectory, relative);
            return File.Exists(path) ? JsonSerializer.Deserialize<T>(File.ReadAllText(path), Json) ?? new T() : new T();
        }

        var feed = Read<FeedFile>(Path.Combine("content", "feed.json"));
        return new SeedBundle(
            Read<BrandFile>(Path.Combine("catalog", "brands.json")).Brands ?? [],
            Read<ProductFile>(Path.Combine("catalog", "products.json")).Products ?? [],
            Read<EditFile>(Path.Combine("content", "weekly-edits.json")).Edits ?? [],
            feed.Posts ?? [],
            feed.Stories ?? []);
    }

    public static IReadOnlyList<string> Validate(SeedBundle bundle, LocalizationOptions localization)
    {
        var options = Microsoft.Extensions.Options.Options.Create(localization);
        var errors = new List<string>();

        void Schema<T>(IValidator<T> validator, T item, string label) =>
            errors.AddRange(validator.Validate(item).Errors.Select(e => $"{label}: {e.PropertyName} {e.ErrorCode}"));

        void Duplicates(IEnumerable<string?> ids, string label) =>
            errors.AddRange(ids.GroupBy(i => i).Where(g => g.Count() > 1).Select(g => $"{label} {g.Key}: duplicate_id"));

        void Translations(IReadOnlyDictionary<string, string>? text, string label)
        {
            if (text is null)
                return;
            errors.AddRange(localization.Languages.Where(l => !text.TryGetValue(l, out var value) || string.IsNullOrWhiteSpace(value))
                .Select(l => $"{label}: translation_missing ({l})"));
        }

        var brandValidator = new BrandInputValidator();
        var productValidator = new ProductInputValidator(options);
        var editValidator = new WeeklyEditInputValidator(options);

        Duplicates(bundle.Brands.Select(b => b.Id), "brand");
        Duplicates(bundle.Products.Select(p => p.Id), "product");
        Duplicates(bundle.Edits.Select(e => e.Id), "edit");

        foreach (var brand in bundle.Brands)
            Schema(brandValidator, brand, $"brand {brand.Id}");

        var brandIds = bundle.Brands.Select(b => b.Id).ToHashSet(StringComparer.Ordinal);
        foreach (var product in bundle.Products)
        {
            var label = $"product {product.Id}";
            Schema(productValidator, product, label);
            if (!brandIds.Contains(product.BrandId))
                errors.Add($"{label}: brand_not_found ({product.BrandId})");
            Translations(product.Name, $"{label} name");
            Translations(product.Description, $"{label} description");
        }

        var productIds = bundle.Products.Select(p => p.Id).ToHashSet(StringComparer.Ordinal);
        foreach (var edit in bundle.Edits)
        {
            var label = $"edit {edit.Id}";
            Schema(editValidator, edit, label);
            Translations(edit.Title, $"{label} title");
            Translations(edit.Subtitle, $"{label} subtitle");
            Translations(edit.SponsorName, $"{label} sponsorName");
            foreach (var look in edit.Looks ?? [])
            {
                Translations(look.Title, $"{label} day {look.Day} title");
                Translations(look.StyleNote, $"{label} day {look.Day} styleNote");
                errors.AddRange((look.Variants ?? []).SelectMany(v => v.ProductIds ?? []).Where(id => !productIds.Contains(id))
                    .Select(id => $"{label} day {look.Day}: product_not_found ({id})"));
            }
        }

        var postValidator = new FeedPostInputValidator(options);
        var storyValidator = new FeedStoryInputValidator(options);
        Duplicates(bundle.Posts.Select(p => p.Id), "feed post");
        Duplicates(bundle.Stories.Select(s => s.Id), "feed story");
        foreach (var post in bundle.Posts)
        {
            var label = $"feed post {post.Id}";
            Schema(postValidator, post, label);
            Translations(post.Author?.Name, $"{label} author name");
            Translations(post.Title, $"{label} title");
            Translations(post.Note, $"{label} note");
            errors.AddRange((post.ProductIds ?? []).Where(id => !productIds.Contains(id)).Select(id => $"{label}: product_not_found ({id})"));
        }
        foreach (var story in bundle.Stories)
        {
            var label = $"feed story {story.Id}";
            Schema(storyValidator, story, label);
            Translations(story.Author?.Name, $"{label} author name");
            Translations(story.Headline, $"{label} headline");
            if (!string.IsNullOrEmpty(story.ProductId) && !productIds.Contains(story.ProductId))
                errors.Add($"{label}: product_not_found ({story.ProductId})");
        }

        return errors;
    }

    private sealed class FeedFile
    {
        public List<FeedPostInput>? Posts { get; set; }
        public List<FeedStoryInput>? Stories { get; set; }
    }

    private sealed class BrandFile { public List<BrandInput>? Brands { get; set; } }
    private sealed class ProductFile { public List<ProductInput>? Products { get; set; } }
    private sealed class EditFile { public List<WeeklyEditInput>? Edits { get; set; } }
}
