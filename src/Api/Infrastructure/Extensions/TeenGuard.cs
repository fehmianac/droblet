using Domain.Constant;
using Domain.Context;
using Domain.Options;
using Domain.Services;
using Microsoft.AspNetCore.Mvc;

namespace Api.Infrastructure.Extensions;

/// <summary>
/// Server-side enforcement of the teen rules (docs/api/teen.md §4): one endpoint filter on every endpoint, driven by the
/// route table <see cref="TeenRouteRules"/>. Routes outside the table cost nothing; for a listed route the user's teen state
/// is read (once per request) and a teen gets 403 teen_restricted (feature) or 403 parental_consent_required (status)
/// before the handler runs.
/// </summary>
public static class TeenGuard
{
    private const string ItemKey = "droblet.teen-access";

    public static RouteHandlerBuilder AddTeenGuard(this RouteHandlerBuilder builder) =>
        builder.AddEndpointFilter(async (context, next) =>
        {
            var http = context.HttpContext;
            var endpoint = http.GetEndpoint() as RouteEndpoint;
            var rule = TeenRouteRules.Classify(http.Request.Method, endpoint?.RoutePattern.RawText);
            if (rule is null || http.User.Identity?.IsAuthenticated != true)
                return await next(context);

            var access = await AccessAsync(http);
            if (!access.IsTeen)
                return await next(context);
            if (rule.Feature is { } feature)
                return Restricted(feature);
            if (rule.LimitedMode && !access.ConsentActive)
                return ConsentRequired(access);
            return await next(context);
        });

    /// <summary>
    /// Teen try-on (docs/api/teen.md §6): the outfit-photo try-on is never for teens (403 teen_restricted outfitPhotoTryOn); any
    /// other target needs all three conditions — Teen:TryOnEnabled, the parent's try-on box, the teen's own consent
    /// (403 teen_try_on_not_available with reason). Adults pass untouched. The worker checks again before the image call.
    /// </summary>
    public static RouteHandlerBuilder RequireTeenTryOn(this RouteHandlerBuilder builder) =>
        builder.AddEndpointFilter(async (context, next) =>
        {
            var http = context.HttpContext;
            if (!(await AccessAsync(http)).IsTeen)
                return await next(context);
            if (context.Arguments.OfType<StartTryOnCommand>().FirstOrDefault() is { Target: { } target } && TeenRules.IsOutfitPhotoTarget(target.Kind))
                return Restricted(TeenFeature.OutfitPhotoTryOn);
            var tenantId = http.RequestServices.GetRequiredService<IApiContext>().TenantId;
            var (_, reason) = await http.RequestServices.GetRequiredService<Domain.Manager.IRepository>().TeenTryOnAsync(tenantId,
                http.RequestServices.GetRequiredService<Microsoft.Extensions.Options.IOptionsMonitor<TeenOptions>>().CurrentValue,
                http.RequestServices.GetRequiredService<Microsoft.Extensions.Options.IOptionsMonitor<ConsentOptions>>().CurrentValue, http.RequestAborted);
            return reason is null ? await next(context) : TryOnNotAvailable(reason);
        }).Produces<ProblemDetails>(StatusCodes.Status403Forbidden);

    /// <summary>The signed-in user's teen state, read once per request.</summary>
    public static async Task<TeenAccess> AccessAsync(HttpContext http)
    {
        if (http.Items.TryGetValue(ItemKey, out var cached) && cached is TeenAccess known)
            return known;
        var userId = http.RequestServices.GetRequiredService<IApiContext>().UserId;
        var access = string.IsNullOrEmpty(userId)
            ? TeenAccess.Adult
            : await http.RequestServices.GetRequiredService<ITeenService>().AccessAsync(userId, http.RequestAborted);
        http.Items[ItemKey] = access;
        return access;
    }

    public static string WireName(TeenFeature feature) => StartupExtensions.EnumNaming.ConvertName(feature.ToString());

    public static IResult Restricted(TeenFeature feature) => Problem(StatusCodes.Status403Forbidden, ErrorCodes.TeenRestricted, "feature", WireName(feature));

    public static IResult ConsentRequired(TeenAccess access) =>
        Problem(StatusCodes.Status403Forbidden, ErrorCodes.ParentalConsentRequired, "status",
            StartupExtensions.EnumNaming.ConvertName((access.Status ?? Domain.Enum.ParentalConsentStatus.PendingParentalConsent).ToString()));

    public static IResult TryOnNotAvailable(string reason) =>
        Problem(StatusCodes.Status403Forbidden, ErrorCodes.TeenTryOnNotAvailable, "reason", reason);

    public static IResult Problem(int status, string code, string? extraKey = null, object? extraValue = null)
    {
        var problem = new ProblemDetails
        {
            Status = status,
            Title = code,
            Type = $"https://droblet.alatech.co/errors/{code}",
            Extensions = { ["code"] = code },
        };
        if (extraKey is not null)
            problem.Extensions[extraKey] = extraValue;
        return TypedResults.Problem(problem);
    }
}

/// <summary>
/// The age step of the sign-up and of the Apple / Google confirmation (docs/api/teen.md §3): birth year (+ month) → the band,
/// or the problem to answer. Legacy: no birth year but the old 18+ box → adult while Teen:LegacyAgeCheckbox is on.
/// </summary>
public static class AgeStep
{
    public sealed record Result(RegisterAge? Age, IResult? Problem, bool UnderMinimum = false);

    public static Result Evaluate(int? birthYear, int? birthMonth, bool legacyAdultConfirmed, TeenOptions teen, DateOnly today)
    {
        if (birthYear is null)
        {
            return legacyAdultConfirmed && teen.LegacyAgeCheckbox
                ? new Result(new RegisterAge(Domain.Enum.AgeBand.Adult), null)
                : new Result(null, ApiResults.Problem(StatusCodes.Status400BadRequest, ErrorCodes.AgeConfirmationRequired));
        }

        var evaluation = AgeRules.Evaluate(birthYear.Value, birthMonth, today);
        return evaluation.Outcome switch
        {
            AgeOutcome.Adult => new Result(new RegisterAge(Domain.Enum.AgeBand.Adult), null),
            AgeOutcome.Teen when teen.Enabled => new Result(new RegisterAge(Domain.Enum.AgeBand.Teen, birthYear, birthMonth), null),
            AgeOutcome.Teen => new Result(null, ApiResults.Problem(StatusCodes.Status422UnprocessableEntity, ErrorCodes.TeenNotAvailable)),
            AgeOutcome.UnderMinimum => new Result(null, ApiResults.Problem(StatusCodes.Status422UnprocessableEntity, ErrorCodes.AgeUnderMinimum), UnderMinimum: true),
            AgeOutcome.NeedsMonth => new Result(null, ApiResults.Problem(StatusCodes.Status422UnprocessableEntity, ErrorCodes.BirthMonthRequired)),
            AgeOutcome.InvalidMonth => new Result(null, ApiResults.Problem(StatusCodes.Status400BadRequest, ErrorCodes.BirthMonthInvalid)),
            _ => new Result(null, ApiResults.Problem(StatusCodes.Status400BadRequest, ErrorCodes.BirthYearInvalid)),
        };
    }
}
