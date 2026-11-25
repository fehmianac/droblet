using System.Text.RegularExpressions;
using Domain.Enum;
using Domain.Options;
using Domain.Services;
using FluentValidation;
using Microsoft.Extensions.Options;

namespace Domain.Validation;

// Admin API bodies and seed files share these shapes and validators (BACKEND_ENGINEER.md §Global veri / seed).
// Text shown to users is a per-language map { "tr": "…", "en": "…" }; the default language is mandatory where the
// text is required, keys must be supported languages (Localization config).

public record BrandInput(
    string Id,
    string Name,
    string? WebsiteUrl,
    string? LogoUrl,
    AffiliateSource Source,
    string? Network,
    string? CheckoutUrl,
    string? ClickIdParameter,
    int? CommissionRateBps,
    bool Retired = false);

public record ProductInput(
    string Id,
    string BrandId,
    IReadOnlyDictionary<string, string>? Name,
    IReadOnlyDictionary<string, string>? Description,
    ProductCategory Category,
    IReadOnlyList<string>? Colors,
    IReadOnlyList<string>? Sizes,
    long PriceMinor,
    string? Currency,
    PriceBand PriceBand,
    IReadOnlyList<string>? Images,
    string? AffiliateUrl,
    AffiliateSource? AffiliateSource,
    bool Retired = false,
    CatalogSegment? Segment = null,
    // The source has no size list (not a one-size product): the app says "sizes on the brand's site". Omitted = unchanged on an update.
    bool? SizesOnBrandSite = null);

public record EditLookVariantInput(PriceBand PriceBand, IReadOnlyList<string>? ProductIds);

public record EditLookInput(string? Id, int Day, IReadOnlyDictionary<string, string>? Title, IReadOnlyDictionary<string, string>? StyleNote, string? ImageUrl, IReadOnlyList<EditLookVariantInput>? Variants);

public record WeeklyEditInput(
    string Id,
    Segment Segment,
    string WeekStart,
    IReadOnlyDictionary<string, string>? Title,
    IReadOnlyDictionary<string, string>? Subtitle,
    string? CoverImageUrl,
    IReadOnlyList<EditLookInput>? Looks,
    string? SponsorBrandId,
    IReadOnlyDictionary<string, string>? SponsorName,
    bool Published,
    bool Retired = false);

public record ContentCollectionInput(
    string Id,
    ContentCollectionKind Kind,
    IReadOnlyDictionary<string, string>? Title,
    IReadOnlyDictionary<string, string>? Subtitle,
    string? ImageUrl,
    int SortOrder,
    IReadOnlyDictionary<string, string>? SponsorName,
    bool Retired = false,
    string? Handle = null);

public record ContentLookInput(string Id, IReadOnlyDictionary<string, string>? Title, IReadOnlyDictionary<string, string>? Note, string? ImageUrl, IReadOnlyList<string>? ProductIds, int SortOrder, bool Retired = false);

public static partial class StoreInputRules
{
    public const long MaxPriceMinor = 100_000_000_00; // 100M TRY — guards against a major/minor unit mix-up in feeds

    [GeneratedRegex("^[a-z0-9][a-z0-9-]{1,62}$")]
    private static partial Regex IdPattern();

    [GeneratedRegex("^[a-z][a-z0-9-]{1,23}$")]
    private static partial Regex ColorPattern();

    [GeneratedRegex(@"^[A-Za-z0-9./\- ]{1,12}$")]
    private static partial Regex SizePattern();

    [GeneratedRegex("^[A-Za-z][A-Za-z0-9_]{0,31}$")]
    private static partial Regex ParameterPattern();

    public static bool IsId(string? value) => value is not null && IdPattern().IsMatch(value);
    public static bool IsColor(string? value) => value is not null && ColorPattern().IsMatch(value.Trim().ToLowerInvariant());
    public static bool IsSize(string? value) => value is not null && SizePattern().IsMatch(value.Trim());
    public static bool IsParameterName(string? value) => value is not null && ParameterPattern().IsMatch(value);
    public static bool IsOptionalHttps(string? url) => string.IsNullOrEmpty(url) || (url.Length <= 2000 && AffiliateLinkBuilder.IsHttpsUrl(url));

    public static IRuleBuilderOptions<T, string> EntityId<T>(this IRuleBuilder<T, string> rule) =>
        rule.Must(IsId).WithErrorCode("id_invalid");

    public static IRuleBuilderOptions<T, IReadOnlyDictionary<string, string>?> Localized<T>(
        this IRuleBuilder<T, IReadOnlyDictionary<string, string>?> rule, LocalizationOptions languages, bool required, int maxLength, string code) =>
        rule.Must(text => LocalizedText.IsValid(text, required, maxLength, languages.Languages, languages.DefaultLanguage)).WithErrorCode(code);

    public static IRuleBuilderOptions<T, string?> OptionalHttps<T>(this IRuleBuilder<T, string?> rule, string code) =>
        rule.Must(IsOptionalHttps).WithErrorCode(code);
}

public class BrandInputValidator : AbstractValidator<BrandInput>
{
    public BrandInputValidator()
    {
        RuleFor(x => x.Id).EntityId();
        RuleFor(x => x.Name).NotEmpty().WithErrorCode("name_required").MaximumLength(80).WithErrorCode("name_too_long");
        RuleFor(x => x.WebsiteUrl).OptionalHttps("website_url_invalid");
        RuleFor(x => x.LogoUrl).OptionalHttps("logo_url_invalid");
        RuleFor(x => x.CheckoutUrl).OptionalHttps("checkout_url_invalid");
        RuleFor(x => x.Source).IsInEnum().WithErrorCode("source_invalid");
        RuleFor(x => x.Network).MaximumLength(40).WithErrorCode("network_invalid");
        RuleFor(x => x.ClickIdParameter).Must(p => p is null || StoreInputRules.IsParameterName(p)).WithErrorCode("click_id_parameter_invalid");
        RuleFor(x => x.CommissionRateBps).Must(r => r is null or (>= 0 and <= 5000)).WithErrorCode("commission_rate_invalid");
    }
}

public class ProductInputValidator : AbstractValidator<ProductInput>
{
    public ProductInputValidator(IOptions<LocalizationOptions> localization)
    {
        var languages = localization.Value;
        RuleFor(x => x.Id).EntityId();
        RuleFor(x => x.BrandId).Must(StoreInputRules.IsId).WithErrorCode("brand_id_invalid");
        RuleFor(x => x.Name).Localized(languages, required: true, 160, "name_invalid");
        RuleFor(x => x.Description).Localized(languages, required: false, 2000, "description_invalid");
        RuleFor(x => x.Category).IsInEnum().WithErrorCode("category_invalid");
        RuleFor(x => x.PriceBand).IsInEnum().WithErrorCode("price_band_invalid");
        RuleFor(x => x.PriceMinor).GreaterThan(0).WithErrorCode("price_invalid")
            .LessThanOrEqualTo(StoreInputRules.MaxPriceMinor).WithErrorCode("price_invalid");
        RuleFor(x => x.Currency).Must(c => c is null or "TRY").WithErrorCode("currency_unsupported");
        RuleFor(x => x.Colors).Must(c => c is null || (c.Count <= 8 && c.All(StoreInputRules.IsColor))).WithErrorCode("colors_invalid");
        RuleFor(x => x.Sizes).Must(s => s is null || (s.Count <= 30 && s.All(StoreInputRules.IsSize))).WithErrorCode("sizes_invalid");
        RuleFor(x => x.Images).Must(i => i is null || (i.Count <= 12 && i.All(u => !string.IsNullOrEmpty(u) && StoreInputRules.IsOptionalHttps(u))))
            .WithErrorCode("images_invalid");
        RuleFor(x => x.AffiliateUrl).OptionalHttps("affiliate_url_invalid");
        RuleFor(x => x.AffiliateSource).Must(s => s is null || System.Enum.IsDefined(s.Value)).WithErrorCode("affiliate_source_invalid");
        RuleFor(x => x.Segment).Must(s => s is null || System.Enum.IsDefined(s.Value)).WithErrorCode("segment_invalid");
    }
}

public class WeeklyEditInputValidator : AbstractValidator<WeeklyEditInput>
{
    public WeeklyEditInputValidator(IOptions<LocalizationOptions> localization)
    {
        var languages = localization.Value;
        RuleFor(x => x.Id).EntityId();
        // Women and men edits may be prepared before a segment opens to users (Segments:Available); teen never.
        RuleFor(x => x.Segment).Must(s => s is Segment.Women or Segment.Men).WithErrorCode("segment_not_available");
        RuleFor(x => x.WeekStart).Must(WeeklyEditRules.IsWeekStart).WithErrorCode("week_start_invalid");
        RuleFor(x => x.Title).Localized(languages, required: true, 120, "title_invalid");
        RuleFor(x => x.Subtitle).Localized(languages, required: false, 240, "subtitle_invalid");
        RuleFor(x => x.CoverImageUrl).OptionalHttps("cover_image_url_invalid");
        RuleFor(x => x.SponsorBrandId).Must(b => b is null || StoreInputRules.IsId(b)).WithErrorCode("sponsor_brand_id_invalid");
        RuleFor(x => x.SponsorName).Localized(languages, required: false, 80, "sponsor_name_invalid");
        RuleFor(x => x.Looks).Must(l => (l?.Count ?? 0) <= WeeklyEditRules.LooksPerEdit).WithErrorCode("looks_too_many");
        // A published edit is complete: exactly 7 looks, one per day.
        RuleFor(x => x.Looks)
            .Must(l => l is { Count: WeeklyEditRules.LooksPerEdit } && l.Select(k => k.Day).Distinct().Count() == WeeklyEditRules.LooksPerEdit)
            .When(x => x.Published).WithErrorCode("looks_must_be_seven");
        RuleFor(x => x.Looks).Must(l => l is null || l.Select(k => k.Day).Distinct().Count() == l.Count).WithErrorCode("look_day_duplicate");
        RuleForEach(x => x.Looks).ChildRules(look =>
        {
            look.RuleFor(l => l.Id).Must(i => i is null || StoreInputRules.IsId(i)).WithErrorCode("look_id_invalid");
            look.RuleFor(l => l.Day).InclusiveBetween(1, 7).WithErrorCode("look_day_invalid");
            look.RuleFor(l => l.Title).Localized(languages, required: true, 120, "look_title_invalid");
            look.RuleFor(l => l.StyleNote).Localized(languages, required: false, 600, "style_note_invalid");
            look.RuleFor(l => l.ImageUrl).OptionalHttps("look_image_url_invalid");
            // No variant at all = a photo look (the editor's picture and note, nothing to buy); otherwise 1–2 bands with products.
            look.RuleFor(l => l.Variants)
                .Must(v => v is null or { Count: 0 } || v is { Count: >= 1 and <= 2 } && v.Select(i => i.PriceBand).Distinct().Count() == v.Count
                           && v.All(i => System.Enum.IsDefined(i.PriceBand) && i.ProductIds is { Count: >= 1 and <= 10 } && i.ProductIds.All(StoreInputRules.IsId)))
                .WithErrorCode("look_variants_invalid");
        });
    }
}

public class ContentCollectionInputValidator : AbstractValidator<ContentCollectionInput>
{
    public ContentCollectionInputValidator(IOptions<LocalizationOptions> localization)
    {
        var languages = localization.Value;
        RuleFor(x => x.Id).EntityId();
        RuleFor(x => x.Kind).IsInEnum().WithErrorCode("kind_invalid");
        RuleFor(x => x.Title).Localized(languages, required: true, 120, "title_invalid");
        RuleFor(x => x.Subtitle).Localized(languages, required: false, 240, "subtitle_invalid");
        RuleFor(x => x.ImageUrl).OptionalHttps("image_url_invalid");
        RuleFor(x => x.SponsorName).Localized(languages, required: false, 80, "sponsor_name_invalid");
        RuleFor(x => x.Handle)
            .Must(h => string.IsNullOrWhiteSpace(h) || global::Domain.Services.HandleRules.IsValidFormat(global::Domain.Services.HandleRules.Normalize(h)))
            .WithErrorCode("handle_invalid");
    }
}

public class ContentLookInputValidator : AbstractValidator<ContentLookInput>
{
    public ContentLookInputValidator(IOptions<LocalizationOptions> localization)
    {
        var languages = localization.Value;
        RuleFor(x => x.Id).EntityId();
        RuleFor(x => x.Title).Localized(languages, required: true, 120, "title_invalid");
        RuleFor(x => x.Note).Localized(languages, required: false, 600, "note_invalid");
        RuleFor(x => x.ImageUrl).OptionalHttps("image_url_invalid");
        RuleFor(x => x.ProductIds).Must(p => p is null || (p.Count <= 10 && p.All(StoreInputRules.IsId))).WithErrorCode("product_ids_invalid");
    }
}
