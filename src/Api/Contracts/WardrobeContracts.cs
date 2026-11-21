using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Enum;
using Domain.Extensions;
using Domain.Options;
using Domain.Services;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace Api.Contracts;

// Request bodies of the E2–E7 endpoints are the service commands (Domain.Services); their validators live here.
// Every failure carries a stable snake_case code — the client owns the sentences.

public record TryOnWeekQuoteRequest(string WeekStart);

public static class WardrobeApi
{
    /// <summary>ServiceResult -> HTTP, in one place. 409 carries the current record (version conflict) or a coded problem.</summary>
    public static IResult ToHttp<T>(this ServiceResult<T> result, string? location = null) => result.Kind switch
    {
        ResultKind.Ok => Results.Ok(result.Value),
        ResultKind.Created => Results.Created(location, result.Value),
        ResultKind.Accepted => Results.Accepted(location, result.Value),
        ResultKind.NoContent => Results.NoContent(),
        ResultKind.NotFound => result.Code is null ? Results.NotFound() : ApiResults.Problem(StatusCodes.Status404NotFound, result.Code),
        ResultKind.Conflict => result.Value is not null
            ? Results.Conflict(result.Value)
            : ApiResults.Problem(StatusCodes.Status409Conflict, result.Code ?? ErrorCodes.VersionConflict),
        ResultKind.Invalid => ApiResults.Problem(StatusCodes.Status422UnprocessableEntity, result.Code ?? ErrorCodes.ValidationFailed),
        ResultKind.Forbidden => WithExtensions(ApiResults.Problem(StatusCodes.Status403Forbidden, result.Code ?? ErrorCodes.PremiumRequired), result.Extensions),
        // 402: the client opens the credit-pack sheet (not the paywall) on credits_exhausted.
        ResultKind.PaymentRequired => ApiResults.Problem(StatusCodes.Status402PaymentRequired, result.Code ?? ErrorCodes.CreditsExhausted),
        ResultKind.TooManyRequests => WithExtensions(ApiResults.Problem(StatusCodes.Status429TooManyRequests, result.Code ?? ErrorCodes.TooManyRequests), result.Extensions),
        _ => ApiResults.Problem(StatusCodes.Status500InternalServerError, "internal_error"),
    };

    private static IResult WithExtensions(Microsoft.AspNetCore.Http.HttpResults.ProblemHttpResult problem, IReadOnlyDictionary<string, object?>? extensions)
    {
        foreach (var (key, value) in extensions ?? new Dictionary<string, object?>())
            problem.ProblemDetails.Extensions[key] = value;
        return problem;
    }

    /// <summary>Raw Accept-Language (or null): the fallback when the profile has no supported language.</summary>
    public static string? RequestLanguage(this HttpContext context) =>
        context.Request.Headers.AcceptLanguage.ToString() is { Length: > 0 } header ? header : null;

    /// <summary>Standard declarations shared by every tenant endpoint of this module.</summary>
    public static RouteHandlerBuilder Tenant(this RouteHandlerBuilder builder, string tag, string summary, string description) =>
        builder
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary(summary)
            .WithDescription(description)
            .WithTags(tag);

    public static RouteHandlerBuilder Validated(this RouteHandlerBuilder builder) =>
        builder.Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest);

    public static RouteHandlerBuilder Problems(this RouteHandlerBuilder builder, params int[] statusCodes)
    {
        foreach (var status in statusCodes)
            builder.Produces<ProblemDetails>(status);
        return builder;
    }

    internal static bool OptionalUlid(string? value) => value is null || Ulid.IsValid(value);

    internal static bool InClockWindow(DateTime occurredAt, TimeProvider time)
    {
        // An offline event may wait for days but cannot come from the future (5 min clock skew).
        var now = time.GetUtcNow().UtcDateTime;
        var utc = occurredAt.ToUniversalTime();
        return utc <= now.AddMinutes(5) && utc >= now.AddDays(-30);
    }
}

// ── E2 ────────────────────────────────────────────────────────────────────────────────────────────────────────────

public class UpdateItemCommandValidator : AbstractValidator<UpdateItemCommand>
{
    public UpdateItemCommandValidator()
    {
        RuleFor(x => x.BaseVersion).GreaterThan(0).WithErrorCode("base_version_invalid");
        RuleFor(x => x).Custom((command, context) =>
        {
            foreach (var code in ItemRules.Validate(new ItemFields(command.Name, command.Category, command.ColorIds, command.Fabric, command.Seasons, command.Size, command.Brand,
                         Clean(command.Subcategory), Clean(command.FabricText), command.ColorHex)))
                context.AddFailure(new FluentValidation.Results.ValidationFailure(ItemFieldOf(code), code) { ErrorCode = code });
        });
    }

    internal static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    internal static string ItemFieldOf(string code) => code switch
    {
        ErrorCodes.CategoryRequired => "category",
        ErrorCodes.ColorRequired or ErrorCodes.ColorUnknown => "colorIds",
        ErrorCodes.FabricUnknown => "fabric",
        ErrorCodes.SeasonRequired => "seasons",
        ErrorCodes.SubcategoryInvalid => "subcategory",
        ErrorCodes.FabricTextTooLong => "fabricText",
        ErrorCodes.ColorHexInvalid => "colorHex",
        _ => "item",
    };
}

public class ItemUploadsCommandValidator : AbstractValidator<ItemUploadsCommand>
{
    public ItemUploadsCommandValidator(IOptionsMonitor<PhotoOptions> photos, IOptionsMonitor<WardrobeOptions> wardrobe)
    {
        RuleFor(x => x.Count).Must(c => c >= 1 && c <= wardrobe.CurrentValue.MaxBatchUpload).WithErrorCode("count_out_of_range");
        RuleFor(x => x.ContentType).NotEmpty().WithErrorCode("content_type_required")
            .Must(ct => photos.CurrentValue.AllowedContentTypes.Contains(ct)).WithErrorCode("content_type_unsupported");
    }
}

public class StartDraftsCommandValidator : AbstractValidator<StartDraftsCommand>
{
    public StartDraftsCommandValidator(IOptionsMonitor<WardrobeOptions> wardrobe)
    {
        RuleFor(x => x.RequestId).Must(Ulid.IsValid).WithErrorCode("request_id_invalid");
        RuleFor(x => x.UploadIds).NotNull().WithErrorCode("upload_ids_required")
            .Must(ids => ids is null || (ids.Count >= 1 && ids.Count <= wardrobe.CurrentValue.MaxBatchUpload)).WithErrorCode("upload_ids_out_of_range")
            .Must(ids => ids is null || ids.All(Ulid.IsValid)).WithErrorCode("upload_id_invalid");
    }
}

public class ConfirmDraftsCommandValidator : AbstractValidator<ConfirmDraftsCommand>
{
    public ConfirmDraftsCommandValidator()
    {
        RuleFor(x => x.Items).NotNull().WithErrorCode("items_required")
            .Must(i => i is null || (i.Count >= 1 && i.Count <= ItemDraftRules.MaxBulk)).WithErrorCode("items_out_of_range")
            .Must(i => i is null || i.Select(d => d.DraftId).Distinct().Count() == i.Count).WithErrorCode("draft_duplicate")
            .Must(i => i is null || i.Select(d => d.ClientMutationId).Distinct().Count() == i.Count).WithErrorCode("client_mutation_id_duplicate");
        RuleForEach(x => x.Items).ChildRules(item =>
        {
            item.RuleFor(i => i.DraftId).Must(Ulid.IsValid).WithErrorCode("draft_id_invalid");
            item.RuleFor(i => i.ClientMutationId).Must(Ulid.IsValid).WithErrorCode("client_mutation_id_invalid");
            item.RuleFor(i => i.ItemId).Must(WardrobeApi.OptionalUlid).WithErrorCode("item_id_invalid");
        });
    }
}

public class SelectDraftsCommandValidator : AbstractValidator<SelectDraftsCommand>
{
    /// <summary>A group never holds more pieces than this (Wardrobe:MaxDetectedItems is capped well below it).</summary>
    public const int MaxPieces = 30;

    public SelectDraftsCommandValidator()
    {
        // An empty list is allowed: "none of them" discards every detected piece of the group.
        RuleFor(x => x.DraftIds).NotNull().WithErrorCode("draft_ids_required")
            .Must(ids => ids is null || ids.Count <= MaxPieces).WithErrorCode("draft_ids_out_of_range")
            .Must(ids => ids is null || ids.All(Ulid.IsValid)).WithErrorCode("draft_id_invalid");
        RuleFor(x => x.Edits)
            .Must(e => e is null || e.Count <= MaxPieces).WithErrorCode("edits_out_of_range")
            .Must(e => e is null || e.All(edit => Ulid.IsValid(edit.DraftId))).WithErrorCode("draft_id_invalid");
    }
}

public class AddLibraryItemsCommandValidator : AbstractValidator<AddLibraryItemsCommand>
{
    public AddLibraryItemsCommandValidator()
    {
        RuleFor(x => x.Items).NotNull().WithErrorCode("items_required")
            .Must(i => i is null || (i.Count >= 1 && i.Count <= ItemDraftRules.MaxBulk)).WithErrorCode("items_out_of_range")
            .Must(i => i is null || i.Select(d => d.ClientMutationId).Distinct().Count() == i.Count).WithErrorCode("client_mutation_id_duplicate");
        RuleForEach(x => x.Items).ChildRules(item =>
        {
            item.RuleFor(i => i.ClientMutationId).Must(Ulid.IsValid).WithErrorCode("client_mutation_id_invalid");
            item.RuleFor(i => i.LibraryItemId).NotEmpty().MaximumLength(64).WithErrorCode("library_item_id_invalid");
            item.RuleFor(i => i.ItemId).Must(WardrobeApi.OptionalUlid).WithErrorCode("item_id_invalid");
            item.RuleFor(i => i.Size).MaximumLength(ItemRules.MaxSizeLength).WithErrorCode("size_too_long");
        });
    }
}

public class CreateItemCommandValidator : AbstractValidator<CreateItemCommand>
{
    public CreateItemCommandValidator()
    {
        RuleFor(x => x.ClientMutationId).Must(Ulid.IsValid).WithErrorCode("client_mutation_id_invalid");
        RuleFor(x => x.ItemId).Must(WardrobeApi.OptionalUlid).WithErrorCode("item_id_invalid");
        RuleFor(x => x).Custom((command, context) =>
        {
            foreach (var code in ItemRules.Validate(new ItemFields(command.Name, command.Category, command.ColorIds, command.Fabric, command.Seasons, command.Size, command.Brand,
                         UpdateItemCommandValidator.Clean(command.Subcategory), UpdateItemCommandValidator.Clean(command.FabricText), command.ColorHex)))
                context.AddFailure(new FluentValidation.Results.ValidationFailure(UpdateItemCommandValidator.ItemFieldOf(code), code) { ErrorCode = code });
        });
    }
}

public class AddProductItemCommandValidator : AbstractValidator<AddProductItemCommand>
{
    public AddProductItemCommandValidator()
    {
        RuleFor(x => x.ClientMutationId).Must(Ulid.IsValid).WithErrorCode("client_mutation_id_invalid");
        RuleFor(x => x.ProductId).NotEmpty().MaximumLength(64).WithErrorCode("product_id_invalid");
        RuleFor(x => x.ItemId).Must(WardrobeApi.OptionalUlid).WithErrorCode("item_id_invalid");
        RuleFor(x => x.Size).MaximumLength(ItemRules.MaxSizeLength).WithErrorCode("size_too_long");
    }
}

// ── E3 ────────────────────────────────────────────────────────────────────────────────────────────────────────────

public class CreateLookCommandValidator : AbstractValidator<CreateLookCommand>
{
    public const int MaxNameLength = 60;

    public CreateLookCommandValidator()
    {
        RuleFor(x => x.Id).Must(Ulid.IsValid).WithErrorCode("id_invalid");
        RuleFor(x => x.Name).MaximumLength(MaxNameLength).WithErrorCode("name_too_long");
        RuleFor(x => x.Occasion).IsInEnum().WithErrorCode("occasion_invalid");
        RuleFor(x => x.Source).IsInEnum().WithErrorCode("source_invalid");
        RuleFor(x => x.Slots).NotNull().WithErrorCode("slots_required")
            .Must(s => s is null || s.Count <= OutfitSlotRules.Slots.Count).WithErrorCode("slots_out_of_range");
        RuleForEach(x => x.Slots).ChildRules(slot => slot.RuleFor(s => s.Slot).IsInEnum().WithErrorCode("slot_invalid"));
    }
}

public class UpdateLookCommandValidator : AbstractValidator<UpdateLookCommand>
{
    public UpdateLookCommandValidator()
    {
        RuleFor(x => x.Name).MaximumLength(CreateLookCommandValidator.MaxNameLength).WithErrorCode("name_too_long");
        RuleFor(x => x.Occasion).IsInEnum().WithErrorCode("occasion_invalid");
        RuleFor(x => x.BaseVersion).GreaterThan(0).WithErrorCode("base_version_invalid");
        RuleFor(x => x.Slots).NotNull().WithErrorCode("slots_required")
            .Must(s => s is null || s.Count <= OutfitSlotRules.Slots.Count).WithErrorCode("slots_out_of_range");
        RuleForEach(x => x.Slots).ChildRules(slot => slot.RuleFor(s => s.Slot).IsInEnum().WithErrorCode("slot_invalid"));
    }
}

// ── E4 ────────────────────────────────────────────────────────────────────────────────────────────────────────────

public class PutPlanDayCommandValidator : AbstractValidator<PutPlanDayCommand>
{
    public PutPlanDayCommandValidator()
    {
        RuleFor(x => x.Occasion).IsInEnum().WithErrorCode("occasion_invalid");
        RuleFor(x => x.LookId).Must(WardrobeApi.OptionalUlid).WithErrorCode("look_id_invalid");
        RuleFor(x => x.BaseVersion).GreaterThanOrEqualTo(0).WithErrorCode("base_version_invalid");
    }
}

public class WearLogCommandValidator : AbstractValidator<WearLogCommand>
{
    public const int MaxItems = 10;

    public WearLogCommandValidator(TimeProvider timeProvider)
    {
        RuleFor(x => x.ClientMutationId).Must(Ulid.IsValid).WithErrorCode("client_mutation_id_invalid");
        RuleFor(x => x.Date).Must(CalendarDay.IsValid).WithErrorCode("date_invalid");
        RuleFor(x => x.OccurredAt).Must(d => WardrobeApi.InClockWindow(d, timeProvider)).WithErrorCode("occurred_at_out_of_range");
        RuleFor(x => x.LookId).Must(WardrobeApi.OptionalUlid).WithErrorCode("look_id_invalid");
        RuleFor(x => x.ItemIds).Must(ids => ids is null || (ids.Count <= MaxItems && ids.All(Ulid.IsValid))).WithErrorCode("item_ids_invalid");
        RuleFor(x => x).Must(x => (x.LookId is not null) != (x.ItemIds is { Count: > 0 })).OverridePropertyName("target").WithErrorCode("look_or_items_required");
    }
}

// ── E5 ────────────────────────────────────────────────────────────────────────────────────────────────────────────

public class StartOutfitCommandValidator : AbstractValidator<StartOutfitCommand>
{
    public StartOutfitCommandValidator(IOptionsMonitor<StylistOptions> options)
    {
        RuleFor(x => x.RequestId).Must(Ulid.IsValid).WithErrorCode("request_id_invalid");
        RuleFor(x => x.Date).Must(CalendarDay.IsValid).WithErrorCode("date_invalid");
        RuleFor(x => x.Occasion).IsInEnum().WithErrorCode("occasion_invalid");
        RuleFor(x => x.FreeText).Must(t => t is null || t.Length <= options.CurrentValue.FreeTextMaxLength).WithErrorCode("free_text_too_long");
        RuleFor(x => x.PinnedItemId).Must(WardrobeApi.OptionalUlid).WithErrorCode("pinned_item_id_invalid");
        RuleFor(x => x.CityId).MaximumLength(64).WithErrorCode("city_id_invalid");
        RuleFor(x => x.Latitude).InclusiveBetween(-90, 90).WithErrorCode("latitude_invalid");
        RuleFor(x => x.Longitude).InclusiveBetween(-180, 180).WithErrorCode("longitude_invalid");
    }
}

public class StartWeekCommandValidator : AbstractValidator<StartWeekCommand>
{
    public StartWeekCommandValidator()
    {
        RuleFor(x => x.RequestId).Must(Ulid.IsValid).WithErrorCode("request_id_invalid");
        RuleFor(x => x.WeekStart).Must(CalendarDay.IsValid).WithErrorCode("week_start_invalid");
        RuleFor(x => x.Days).Must((command, days) => days is null || !CalendarDay.TryParse(command.WeekStart, out var start)
            || (days.Count <= 7 && days.All(d => CalendarDay.TryParse(d.Date, out var day) && day >= start && day <= start.AddDays(6)
                                                 && (d.Occasion is null || Enum.IsDefined(d.Occasion.Value)))))
            .WithErrorCode("days_invalid");
        RuleFor(x => x.CityId).MaximumLength(64).WithErrorCode("city_id_invalid");
        RuleFor(x => x.Latitude).InclusiveBetween(-90, 90).WithErrorCode("latitude_invalid");
        RuleFor(x => x.Longitude).InclusiveBetween(-180, 180).WithErrorCode("longitude_invalid");
    }
}

public class AcceptSuggestionCommandValidator : AbstractValidator<AcceptSuggestionCommand>
{
    public AcceptSuggestionCommandValidator()
    {
        RuleFor(x => x.ClientMutationId).Must(Ulid.IsValid).WithErrorCode("client_mutation_id_invalid");
        RuleFor(x => x.LookId).Must(WardrobeApi.OptionalUlid).WithErrorCode("look_id_invalid");
        RuleFor(x => x.Name).MaximumLength(CreateLookCommandValidator.MaxNameLength).WithErrorCode("name_too_long");
        RuleFor(x => x.PlanDate).Must(d => d is null || CalendarDay.IsValid(d)).WithErrorCode("plan_date_invalid");
    }
}

public class AcceptWeekCommandValidator : AbstractValidator<AcceptWeekCommand>
{
    public AcceptWeekCommandValidator()
    {
        RuleFor(x => x.ClientMutationId).Must(Ulid.IsValid).WithErrorCode("client_mutation_id_invalid");
        RuleFor(x => x.Dates).Must(d => d is null || (d.Count is >= 1 and <= 7 && d.All(CalendarDay.IsValid))).WithErrorCode("dates_invalid");
    }
}

public class DislikeCommandValidator : AbstractValidator<DislikeCommand>
{
    public DislikeCommandValidator() => RuleFor(x => x.Reason).IsInEnum().WithErrorCode("reason_invalid");
}

public abstract class TripFieldsValidator<T> : AbstractValidator<T>
{
    protected void TripRules(
        Func<T, string> cityId, Func<T, string?> cityName, Func<T, string> start, Func<T, string> end,
        Func<T, IReadOnlyList<TripType>?> types, IOptionsMonitor<PackingOptions> options)
    {
        // A city id from the city search, or (older clients, typed cities) only a name the server geocodes.
        RuleFor(x => cityId(x)).MaximumLength(64).OverridePropertyName("cityId").WithErrorCode("city_id_invalid");
        RuleFor(x => x).Must(x => !string.IsNullOrWhiteSpace(cityId(x)) || !string.IsNullOrWhiteSpace(cityName(x)))
            .OverridePropertyName("cityId").WithErrorCode("city_required");
        RuleFor(x => cityName(x)).MaximumLength(80).OverridePropertyName("cityName").WithErrorCode("city_name_too_long");
        RuleFor(x => start(x)).Must(CalendarDay.IsValid).OverridePropertyName("startDate").WithErrorCode("start_date_invalid");
        RuleFor(x => end(x)).Must(CalendarDay.IsValid).OverridePropertyName("endDate").WithErrorCode("end_date_invalid");
        RuleFor(x => x).Must(x => !CalendarDay.TryParse(start(x), out var s) || !CalendarDay.TryParse(end(x), out var e)
                                  || (e >= s && e.DayNumber - s.DayNumber < options.CurrentValue.MaxTripDays))
            .OverridePropertyName("endDate").WithErrorCode("date_range_invalid");
        RuleFor(x => types(x)).Must(t => t is null || (t.All(v => Enum.IsDefined(v)) && t.Distinct().Count() == t.Count))
            .OverridePropertyName("tripTypes").WithErrorCode("trip_types_invalid");
    }
}

public class CreateTripCommandValidator : TripFieldsValidator<CreateTripCommand>
{
    public CreateTripCommandValidator(IOptionsMonitor<PackingOptions> options)
    {
        RuleFor(x => x.Id).Must(Ulid.IsValid).WithErrorCode("id_invalid");
        TripRules(x => x.CityId, x => x.CityName, x => x.StartDate, x => x.EndDate, x => x.TripTypes, options);
    }
}

public class UpdateTripCommandValidator : TripFieldsValidator<UpdateTripCommand>
{
    public UpdateTripCommandValidator(IOptionsMonitor<PackingOptions> options)
    {
        RuleFor(x => x.BaseVersion).GreaterThan(0).WithErrorCode("base_version_invalid");
        TripRules(x => x.CityId, x => x.CityName, x => x.StartDate, x => x.EndDate, x => x.TripTypes, options);
    }
}

public class StartPackCommandValidator : AbstractValidator<StartPackCommand>
{
    public StartPackCommandValidator() => RuleFor(x => x.RequestId).Must(Ulid.IsValid).WithErrorCode("request_id_invalid");
}

public class AcceptPackCommandValidator : AbstractValidator<AcceptPackCommand>
{
    public AcceptPackCommandValidator() => RuleFor(x => x.ClientMutationId).Must(Ulid.IsValid).WithErrorCode("client_mutation_id_invalid");
}

public class MarkPackedCommandValidator : AbstractValidator<MarkPackedCommand>
{
    public MarkPackedCommandValidator(TimeProvider timeProvider)
    {
        RuleFor(x => x.ClientMutationId).Must(Ulid.IsValid).WithErrorCode("client_mutation_id_invalid");
        RuleFor(x => x.OccurredAt).Must(d => WardrobeApi.InClockWindow(d, timeProvider)).WithErrorCode("occurred_at_out_of_range");
    }
}

// ── E6 / E7 ───────────────────────────────────────────────────────────────────────────────────────────────────────

public class StartTryOnCommandValidator : AbstractValidator<StartTryOnCommand>
{
    public StartTryOnCommandValidator()
    {
        RuleFor(x => x.RequestId).Must(Ulid.IsValid).WithErrorCode("request_id_invalid");
        RuleFor(x => x.Target).NotNull().WithErrorCode("target_required");
        When(x => x.Target is not null, () =>
        {
            RuleFor(x => x.Target.Kind).IsInEnum().WithErrorCode("target_kind_invalid");
            RuleFor(x => x.Target.Id).NotEmpty().MaximumLength(64).WithErrorCode("target_id_invalid");
            RuleFor(x => x.Target.Index).Must((c, i) => c.Target.Kind == TryOnTargetKind.ImportPhoto ? i is >= 1 and <= 100 : i is null or >= 0 and < 20)
                .WithErrorCode("target_index_invalid");
        });
    }
}

public class TryOnWeekQuoteRequestValidator : AbstractValidator<TryOnWeekQuoteRequest>
{
    public TryOnWeekQuoteRequestValidator() => RuleFor(x => x.WeekStart).Must(CalendarDay.IsValid).WithErrorCode("week_start_invalid");
}

public class TryOnWeekCommandValidator : AbstractValidator<TryOnWeekCommand>
{
    public TryOnWeekCommandValidator()
    {
        RuleFor(x => x.RequestId).Must(Ulid.IsValid).WithErrorCode("request_id_invalid");
        RuleFor(x => x.WeekStart).Must(CalendarDay.IsValid).WithErrorCode("week_start_invalid");
        RuleFor(x => x.ExpectedCredits).InclusiveBetween(0, 7).WithErrorCode("expected_credits_invalid");
    }
}

public class StartPaletteCommandValidator : AbstractValidator<StartPaletteCommand>
{
    public StartPaletteCommandValidator() => RuleFor(x => x.RequestId).Must(Ulid.IsValid).WithErrorCode("request_id_invalid");
}

// ── Outfit import ("Kombinlerini içe aktar") ────────────────────────────────────────────────────────────────────────

/// <summary>Shape only: the plan's photo limit (Entitlements:*:OutfitImportMaxPhotos) is enforced by the service.</summary>
public class CreateOutfitImportCommandValidator : AbstractValidator<CreateOutfitImportCommand>
{
    /// <summary>Hard ceiling of one request, whatever the configuration says (the admin panel allows up to 100).</summary>
    public const int MaxCount = 100;

    public CreateOutfitImportCommandValidator()
    {
        RuleFor(x => x.RequestId).Must(Ulid.IsValid).WithErrorCode("request_id_invalid");
        RuleFor(x => x.Count).InclusiveBetween(1, MaxCount).WithErrorCode("count_out_of_range");
    }
}

public class CommitOutfitImportCommandValidator : AbstractValidator<CommitOutfitImportCommand>
{
    public CommitOutfitImportCommandValidator()
    {
        RuleFor(x => x.Looks).Must(l => l is null || l.Count <= CreateOutfitImportCommandValidator.MaxCount).WithErrorCode("looks_out_of_range");
        RuleForEach(x => x.Looks).ChildRules(look =>
        {
            look.RuleFor(l => l.PhotoIndex).InclusiveBetween(1, CreateOutfitImportCommandValidator.MaxCount).WithErrorCode("photo_index_invalid");
            look.RuleFor(l => l.Pieces).Must(p => p is null || p.Count <= 50).WithErrorCode("pieces_out_of_range");
            look.RuleForEach(l => l.Pieces).ChildRules(piece =>
                piece.RuleFor(p => p.Ref).NotEmpty().MaximumLength(16).WithErrorCode("ref_invalid"));
        });
    }
}
