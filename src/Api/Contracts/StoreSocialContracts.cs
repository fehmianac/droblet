using System.Globalization;
using System.Text.Json;
using Domain.Domain;
using Domain.Enum;
using Domain.Extensions;
using Domain.Services;
using Domain.Validation;
using FluentValidation;

namespace Api.Contracts;

// ── Store ───────────────────────────────────────────────────────────────────────────────────────────────────────

public record LookRefRequest(LookRefKind Kind, string Id)
{
    public LookRefDto ToDto() => new(Kind, Id);
    public static bool IsValid(LookRefRequest? look) => look is null || (System.Enum.IsDefined(look.Kind) && look.Id is { Length: >= 1 and <= 64 } && !look.Id.Contains('#'));
}

public record CartLineRequest(string? ClientMutationId, string ProductId, string? Size, LookRefRequest? Look);

public record AddCartLinesRequest(IReadOnlyList<CartLineRequest>? Lines);

public class AddCartLinesRequestValidator : AbstractValidator<AddCartLinesRequest>
{
    public const int MaxLines = 20;

    public AddCartLinesRequestValidator()
    {
        RuleFor(x => x.Lines).Must(l => l is { Count: >= 1 and <= MaxLines }).WithErrorCode("lines_invalid");
        RuleForEach(x => x.Lines).ChildRules(line =>
        {
            line.RuleFor(l => l.ProductId).Must(StoreInputRules.IsId).WithErrorCode("product_id_invalid");
            line.RuleFor(l => l.Size).Must(s => string.IsNullOrEmpty(s) || StoreInputRules.IsSize(s)).WithErrorCode("size_invalid");
            line.RuleFor(l => l.ClientMutationId).Must(id => id is null || Ulid.IsValid(id)).WithErrorCode("client_mutation_id_invalid");
            line.RuleFor(l => l.Look).Must(LookRefRequest.IsValid).WithErrorCode("look_invalid");
        });
    }
}

public record ProductCheckoutRequest(LookRefRequest? Look);

public class ProductCheckoutRequestValidator : AbstractValidator<ProductCheckoutRequest>
{
    public ProductCheckoutRequestValidator() => RuleFor(x => x.Look).Must(LookRefRequest.IsValid).WithErrorCode("look_invalid");
}

public record WatchRequest(string? Size, LookRefRequest? Look, bool? Notify = null);

public class WatchRequestValidator : AbstractValidator<WatchRequest>
{
    public WatchRequestValidator()
    {
        RuleFor(x => x.Size).Must(s => string.IsNullOrEmpty(s) || StoreInputRules.IsSize(s)).WithErrorCode("size_invalid");
        RuleFor(x => x.Look).Must(LookRefRequest.IsValid).WithErrorCode("look_invalid");
    }
}

public record PurchasePromptAnswerRequest(bool Accepted);

/// <summary>Items = one result per purchased product when accepted (empty when dismissed).</summary>
public record PurchasePromptAnswerResponse(Domain.Enum.WardrobePromptStatus Status, IReadOnlyList<Domain.Domain.ItemCreateResultDto> Items);

public record CompleteLookRequest(IReadOnlyList<string>? ItemIds, PriceBand? PriceBand, string? Size);

public class CompleteLookRequestValidator : AbstractValidator<CompleteLookRequest>
{
    public CompleteLookRequestValidator()
    {
        RuleFor(x => x.ItemIds).Must(i => i is null || (i.Count <= 10 && i.All(id => id is { Length: >= 1 and <= 64 }))).WithErrorCode("item_ids_invalid");
        RuleFor(x => x.PriceBand).Must(b => b is null || System.Enum.IsDefined(b.Value)).WithErrorCode("price_band_invalid");
        RuleFor(x => x.Size).Must(s => string.IsNullOrEmpty(s) || StoreInputRules.IsSize(s)).WithErrorCode("size_invalid");
    }
}

public record PostbackRequest(string ClickId, string OrderId, long AmountMinor, string? Currency, AffiliateConversionStatus Status)
{
    public PostbackInput ToInput() => new(ClickId, OrderId, AmountMinor, Currency, Status);
}

public class PostbackRequestValidator : AbstractValidator<PostbackRequest>
{
    public PostbackRequestValidator()
    {
        RuleFor(x => x.ClickId).Must(Ulid.IsValid).WithErrorCode("click_id_invalid");
        RuleFor(x => x.OrderId).Must(o => o is { Length: >= 1 and <= 100 } && !o.Contains('#') && !o.Any(char.IsWhiteSpace)).WithErrorCode("order_id_invalid");
        RuleFor(x => x.AmountMinor).InclusiveBetween(0, StoreInputRules.MaxPriceMinor).WithErrorCode("amount_invalid");
        RuleFor(x => x.Currency).Must(c => c is null or "TRY").WithErrorCode("currency_unsupported");
        RuleFor(x => x.Status).IsInEnum().WithErrorCode("status_invalid");
    }
}

public record BulkProductsRequest(IReadOnlyList<ProductInput>? Products);

// ── Social ──────────────────────────────────────────────────────────────────────────────────────────────────────

public record RateLookRequest(int Score, string? ClientMutationId);

public class RateLookRequestValidator : AbstractValidator<RateLookRequest>
{
    public RateLookRequestValidator()
    {
        RuleFor(x => x.Score).InclusiveBetween(1, 5).WithErrorCode("score_invalid");
        RuleFor(x => x.ClientMutationId).Must(id => id is null || Ulid.IsValid(id)).WithErrorCode("client_mutation_id_invalid");
    }
}

public record ShareRequest(string ClientMutationId, ShareChannel Channel, ShareTargetKind TargetKind, string? TargetId, string? OwnerHandle);

public class ShareRequestValidator : AbstractValidator<ShareRequest>
{
    public ShareRequestValidator()
    {
        RuleFor(x => x.ClientMutationId).Must(Ulid.IsValid).WithErrorCode("client_mutation_id_invalid");
        RuleFor(x => x.Channel).IsInEnum().WithErrorCode("channel_invalid");
        RuleFor(x => x.TargetKind).IsInEnum().WithErrorCode("target_kind_invalid");
        RuleFor(x => x.TargetId).Must(id => id is null || (id.Length is >= 1 and <= 64 && id.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_')))
            .WithErrorCode("target_id_invalid");
        RuleFor(x => x.TargetId).NotEmpty().When(x => x.TargetKind is ShareTargetKind.Look or ShareTargetKind.Product or ShareTargetKind.Edit)
            .WithErrorCode("target_id_required");
        RuleFor(x => x.OwnerHandle).Must(h => h is null || HandleRules.IsValidFormat(HandleRules.Normalize(h))).WithErrorCode("owner_handle_invalid");
    }
}

public record InviteAttributionRequest(string Code);

public class InviteAttributionRequestValidator : AbstractValidator<InviteAttributionRequest>
{
    public InviteAttributionRequestValidator() => RuleFor(x => x.Code).Must(InviteCodeRules.IsValid).WithErrorCode("code_invalid");
}

public record ReportRequest(ReportTargetKind TargetKind, string? TargetId, ReportReason Reason, string? Note);

public class ReportRequestValidator : AbstractValidator<ReportRequest>
{
    public ReportRequestValidator()
    {
        RuleFor(x => x.TargetKind).IsInEnum().WithErrorCode("target_kind_invalid");
        RuleFor(x => x.Reason).IsInEnum().WithErrorCode("reason_invalid");
        RuleFor(x => x.TargetId).MaximumLength(64).WithErrorCode("target_id_invalid");
        RuleFor(x => x.TargetId).NotEmpty().When(x => x.TargetKind != ReportTargetKind.Profile).WithErrorCode("target_id_required");
        RuleFor(x => x.Note).MaximumLength(500).WithErrorCode("note_too_long");
    }
}

public record ResolveReportRequest(ReportResolution Resolution, string? Note);

public class ResolveReportRequestValidator : AbstractValidator<ResolveReportRequest>
{
    public ResolveReportRequestValidator()
    {
        RuleFor(x => x.Resolution).IsInEnum().WithErrorCode("resolution_invalid");
        RuleFor(x => x.Note).MaximumLength(500).WithErrorCode("note_too_long");
    }
}

// ── Settings ────────────────────────────────────────────────────────────────────────────────────────────────────

public record UpdateVisibilityRequest(ClosetVisibility ClosetVisibility, long BaseVersion);

public class UpdateVisibilityRequestValidator : AbstractValidator<UpdateVisibilityRequest>
{
    public UpdateVisibilityRequestValidator()
    {
        RuleFor(x => x.ClosetVisibility).IsInEnum().WithErrorCode("closet_visibility_invalid");
        RuleFor(x => x.BaseVersion).GreaterThanOrEqualTo(1).WithErrorCode("base_version_invalid");
    }
}

/// <summary>PriceDrop / FollowRequests are optional: omitted (null) keeps the stored value, so older clients do not switch them off.</summary>
public record UpdateNotificationPrefsRequest(bool MorningOutfit, string MorningOutfitLocalTime, bool WeeklyEdit, bool FriendRatings, string TimeZone, long BaseVersion,
    bool? PriceDrop = null, bool? FollowRequests = null)
{
    public NotificationPrefsInput ToInput() => new(MorningOutfit, MorningOutfitLocalTime, WeeklyEdit, FriendRatings, TimeZone, BaseVersion, PriceDrop, FollowRequests);
}

public class UpdateNotificationPrefsRequestValidator : AbstractValidator<UpdateNotificationPrefsRequest>
{
    public UpdateNotificationPrefsRequestValidator()
    {
        RuleFor(x => x.MorningOutfitLocalTime).Must(ReminderRules.IsValidLocalTime).WithErrorCode("local_time_invalid");
        RuleFor(x => x.TimeZone).Must(ReminderRules.IsValidTimeZone).WithErrorCode("time_zone_invalid");
        RuleFor(x => x.BaseVersion).GreaterThanOrEqualTo(0).WithErrorCode("base_version_invalid");
    }
}

public record RegisterDeviceRequest(string DeviceId, DevicePlatform Platform, string? PushToken, string? TimeZone);

public class RegisterDeviceRequestValidator : AbstractValidator<RegisterDeviceRequest>
{
    public RegisterDeviceRequestValidator()
    {
        RuleFor(x => x.DeviceId).Must(DeviceRules.IsValidId).WithErrorCode("device_id_invalid");
        RuleFor(x => x.Platform).IsInEnum().WithErrorCode("platform_invalid");
        RuleFor(x => x.PushToken).MaximumLength(4096).WithErrorCode("push_token_invalid");
        RuleFor(x => x.TimeZone).Must(tz => tz is null || ReminderRules.IsValidTimeZone(tz)).WithErrorCode("time_zone_invalid");
    }
}

public static class DeviceRules
{
    public static bool IsValidId(string? id) =>
        id is { Length: >= 8 and <= 100 } && id.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_' or '.' or ':');
}

// ── Analytics ───────────────────────────────────────────────────────────────────────────────────────────────────

public record AnalyticsEventRequest(string? Name, DateTime? OccurredAt, Dictionary<string, JsonElement>? Props)
{
    /// <summary>Scalars only: strings, numbers and booleans become strings; anything else becomes null and is rejected by the rules.</summary>
    public AnalyticsEventInput ToInput() => new(Name, OccurredAt?.ToUniversalTime(), Props?.ToDictionary(p => p.Key, p => p.Value.ValueKind switch
    {
        JsonValueKind.String => p.Value.GetString(),
        JsonValueKind.Number => p.Value.TryGetInt64(out var n) ? n.ToString(CultureInfo.InvariantCulture) : null,
        JsonValueKind.True => "true",
        JsonValueKind.False => "false",
        _ => null,
    }));
}

public record AnalyticsBatchRequest(IReadOnlyList<AnalyticsEventRequest>? Events, string? Platform, string? AppVersion);

public class AnalyticsBatchRequestValidator : AbstractValidator<AnalyticsBatchRequest>
{
    public AnalyticsBatchRequestValidator()
    {
        RuleFor(x => x.Events).Must(e => e is { Count: >= 1 and <= AnalyticsRules.MaxBatch }).WithErrorCode("events_invalid");
        RuleFor(x => x.Platform).Must(p => p is null or "ios" or "android").WithErrorCode("platform_invalid");
        RuleFor(x => x.AppVersion).Must(v => v is null || AnalyticsRules.IsSafeValue(v)).WithErrorCode("app_version_invalid");
    }
}

/// <summary>Shared query parsing: enums and days arrive as strings; an unparsable value is a 400, never a silent default.</summary>
public static class QueryParsing
{
    public static bool TryEnum<T>(string? value, out T? result) where T : struct, System.Enum
    {
        result = null;
        if (string.IsNullOrEmpty(value))
            return true;
        if (System.Enum.TryParse<T>(value, ignoreCase: true, out var parsed) && System.Enum.IsDefined(parsed) && !int.TryParse(value, out _))
        {
            result = parsed;
            return true;
        }
        return false;
    }

    /// <summary>from/to (yyyy-MM-dd, inclusive). Defaults: the last 30 days. False when malformed, reversed or longer than maxDays.</summary>
    public static bool TryRange(string? from, string? to, DateOnly today, int maxDays, out DateOnly start, out DateOnly end)
    {
        end = today;
        start = today.AddDays(-29);
        if (!string.IsNullOrEmpty(to) && !WeeklyEditRules.TryParseDay(to, out end))
            return false;
        if (string.IsNullOrEmpty(from))
            start = end.AddDays(-29);
        else if (!WeeklyEditRules.TryParseDay(from, out start))
            return false;
        return start <= end && end.DayNumber - start.DayNumber < maxDays;
    }
}
