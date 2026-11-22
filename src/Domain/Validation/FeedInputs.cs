using Domain.Enum;
using Domain.Options;
using Domain.Services;
using FluentValidation;
using Microsoft.Extensions.Options;

namespace Domain.Validation;

// Akış F1 admin bodies (PUT v1/admin/feed-post/{id}, PUT v1/admin/feed-story/{id}) and seed/content/feed.json.

public record FeedAuthorInput(FeedAuthorKind Kind, IReadOnlyDictionary<string, string>? Name, string? Handle, string? ImageUrl);

public record FeedPostInput(
    string Id,
    Segment? Segment,
    FeedAuthorInput? Author,
    Occasion Occasion,
    IReadOnlyDictionary<string, string>? Title,
    IReadOnlyDictionary<string, string>? Note,
    IReadOnlyList<string>? ImageUrls,
    IReadOnlyList<string>? ProductIds,
    DateTime PublishAt,
    int SortOrder,
    bool Published,
    bool Retired = false);

public record FeedStoryAuthorInput(IReadOnlyDictionary<string, string>? Name, string? ImageUrl);

public record FeedStoryInput(
    string Id,
    Segment? Segment,
    FeedStoryAuthorInput? Author,
    string? ImageUrl,
    IReadOnlyDictionary<string, string>? Headline,
    string? ProductId,
    DateTime PublishAt,
    DateTime? ExpiresAt,
    int SortOrder,
    bool Published,
    bool Retired = false);

public static class FeedInputRules
{
    public const int MaxImages = 4;
    public const int MaxProducts = 8;

    /// <summary>A content id (lower-case slug) or a ULID (what the admin panel generates for new posts / stories).</summary>
    public static bool IsId(string? id) => StoreInputRules.IsId(id) || global::Domain.Extensions.Ulid.IsValid(id);

    /// <summary>Women / men or null (= every segment). Teen is never a target of its own: teens see the posts of their segment.</summary>
    public static bool IsSegment(Segment? segment) => segment is null or Segment.Women or Segment.Men;

    public static bool IsHttps(string? url) => !string.IsNullOrEmpty(url) && StoreInputRules.IsOptionalHttps(url);
}

public class FeedPostInputValidator : AbstractValidator<FeedPostInput>
{
    public FeedPostInputValidator(IOptions<LocalizationOptions> localization)
    {
        var languages = localization.Value;
        RuleFor(x => x.Id).Must(FeedInputRules.IsId).WithErrorCode("id_invalid");
        RuleFor(x => x.Segment).Must(FeedInputRules.IsSegment).WithErrorCode("segment_invalid");
        RuleFor(x => x.Author).NotNull().WithErrorCode("author_required");
        RuleFor(x => x.Author!.Kind).IsInEnum().WithErrorCode("author_kind_invalid").When(x => x.Author is not null);
        RuleFor(x => x.Author!.Name).Localized(languages, required: true, 60, "author_name_invalid").When(x => x.Author is not null);
        RuleFor(x => x.Author!.Handle)
            .Must(h => string.IsNullOrWhiteSpace(h) || HandleRules.IsValidFormat(HandleRules.Normalize(h)))
            .WithErrorCode("author_handle_invalid").When(x => x.Author is not null);
        RuleFor(x => x.Author!.ImageUrl).OptionalHttps("author_image_url_invalid").When(x => x.Author is not null);
        RuleFor(x => x.Occasion).IsInEnum().WithErrorCode("occasion_invalid");
        RuleFor(x => x.Title).Localized(languages, required: true, 120, "title_invalid");
        RuleFor(x => x.Note).Localized(languages, required: false, 600, "note_invalid");
        RuleFor(x => x.ImageUrls)
            .Must(i => i is { Count: >= 1 and <= FeedInputRules.MaxImages } && i.All(FeedInputRules.IsHttps))
            .WithErrorCode("image_urls_invalid");
        RuleFor(x => x.ProductIds)
            .Must(p => p is null || (p.Count <= FeedInputRules.MaxProducts && p.All(StoreInputRules.IsId) && p.Distinct().Count() == p.Count))
            .WithErrorCode("product_ids_invalid");
        RuleFor(x => x.PublishAt).Must(d => d != default).WithErrorCode("publish_at_invalid");
        RuleFor(x => x.SortOrder).InclusiveBetween(0, 100_000).WithErrorCode("sort_order_invalid");
    }
}

public class FeedStoryInputValidator : AbstractValidator<FeedStoryInput>
{
    public FeedStoryInputValidator(IOptions<LocalizationOptions> localization)
    {
        var languages = localization.Value;
        RuleFor(x => x.Id).Must(FeedInputRules.IsId).WithErrorCode("id_invalid");
        RuleFor(x => x.Segment).Must(FeedInputRules.IsSegment).WithErrorCode("segment_invalid");
        RuleFor(x => x.Author).NotNull().WithErrorCode("author_required");
        RuleFor(x => x.Author!.Name).Localized(languages, required: true, 60, "author_name_invalid").When(x => x.Author is not null);
        RuleFor(x => x.Author!.ImageUrl).OptionalHttps("author_image_url_invalid").When(x => x.Author is not null);
        RuleFor(x => x.ImageUrl).Must(FeedInputRules.IsHttps).WithErrorCode("image_url_invalid");
        RuleFor(x => x.Headline).Localized(languages, required: true, 120, "headline_invalid");
        RuleFor(x => x.ProductId).Must(p => string.IsNullOrEmpty(p) || StoreInputRules.IsId(p)).WithErrorCode("product_id_invalid");
        RuleFor(x => x.PublishAt).Must(d => d != default).WithErrorCode("publish_at_invalid");
        RuleFor(x => x.ExpiresAt).Must((x, e) => e is null || e > x.PublishAt).WithErrorCode("expires_at_invalid");
        RuleFor(x => x.SortOrder).InclusiveBetween(0, 100_000).WithErrorCode("sort_order_invalid");
    }
}
