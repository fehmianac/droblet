using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Context;
using Domain.Enum;
using Domain.Services;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace Api.Endpoints.V1.Tenant.Consent;

// docs/legal consents 1–6 (landing /consents). The app shows each text just in time; the server records and enforces.

public class Get : IEndpoint
{
    private static async Task<IResult> Handler([FromServices] IApiContext apiContext, [FromServices] IConsentService consents, HttpContext httpContext,
        CancellationToken cancellationToken)
    {
        var all = await consents.GetAsync(apiContext.TenantId, cancellationToken);
        // teenTryOn (docs/api/teen.md §6) is a teen's own consent: listed for teen accounts only.
        var teen = (await TeenGuard.AccessAsync(httpContext)).IsTeen;
        return Results.Ok(teen ? all : all with { Consents = all.Consents.Where(c => c.Type != ConsentType.TeenTryOn).ToList() });
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapGet("v1/tenant/consents", Handler)
            .Produces<ConsentsDto>(StatusCodes.Status200OK)
            .Tenant("Tenant Consent", "Get my consents",
                "All seven types (bodyPhotoAi, facePhotoPalette, weight, contacts, marketingNotifications, crossBorderTransfer, facePhotoTryOn; teen accounts also teenTryOn) with the stored decision, " +
                "the text version it was made on, the current text version (Consents:Versions) and `valid` = granted on the current version — what the guards enforce.");
}

public class GetHistory : IEndpoint
{
    private static async Task<IResult> Handler([FromServices] IApiContext apiContext, [FromServices] IConsentService consents, CancellationToken cancellationToken) =>
        Results.Ok(await consents.GetHistoryAsync(apiContext.TenantId, cancellationToken));

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapGet("v1/tenant/consents/history", Handler)
            .Produces<ConsentHistoryDto>(StatusCodes.Status200OK)
            .Tenant("Tenant Consent", "My consent history",
                "Append-only audit log of every grant and withdrawal (type, granted, text version, time, locale, source), newest first.");
}

public sealed record ConsentDecisionInput(ConsentType Type, bool Granted, string? Version);

public sealed record PutConsentsRequest(IReadOnlyList<ConsentDecisionInput>? Consents, string? Source, string? Locale);

public class PutConsentsRequestValidator : AbstractValidator<PutConsentsRequest>
{
    public PutConsentsRequestValidator(IOptionsMonitor<Domain.Options.LocalizationOptions> localization)
    {
        RuleFor(x => x.Consents).Must(c => c is { Count: > 0 } && c.Count <= 12).WithErrorCode("consents_required");
        RuleForEach(x => x.Consents).ChildRules(c =>
        {
            c.RuleFor(d => d.Type).IsInEnum().WithErrorCode("consent_type_invalid");
            c.RuleFor(d => d.Version).NotEmpty().When(d => d.Granted).WithErrorCode("consent_version_required")
                .MaximumLength(32).WithErrorCode("consent_version_invalid");
        });
        RuleFor(x => x.Source).MaximumLength(ConsentRules.MaxSourceLength).WithErrorCode("consent_source_invalid")
            .Matches("^[a-z0-9_]*$").WithErrorCode("consent_source_invalid");
        RuleFor(x => x.Locale).Must(l => l is null || localization.CurrentValue.IsSupported(l)).WithErrorCode("language_unsupported");
    }
}

public class Put : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] PutConsentsRequest request,
        [FromServices] IApiContext apiContext,
        [FromServices] IConsentService consents,
        [FromServices] IValidator<PutConsentsRequest> validator,
        [FromServices] IRequestLanguage requestLanguage,
        HttpContext httpContext,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        // Teen rules (docs/api/teen.md §4): a teen cannot give marketing / contacts; teenTryOn is for teens only.
        var teen = (await TeenGuard.AccessAsync(httpContext)).IsTeen;
        foreach (var grant in request.Consents!.Where(d => d.Granted))
        {
            if (teen && TeenRules.ConsentClosedToTeens(grant.Type) is { } feature)
                return TeenGuard.Restricted(feature);
            if (!teen && grant.Type == ConsentType.TeenTryOn)
                return TeenGuard.Problem(StatusCodes.Status403Forbidden, ErrorCodes.TeenRestricted, "feature", "teenTryOn");
        }

        // An adult's "no" to teenTryOn (e.g. the all-in-one step sending every type) is not a decision worth recording.
        var decisions = request.Consents!.Where(d => teen || d.Type != ConsentType.TeenTryOn)
            .Select(d => new ConsentDecision(d.Type, d.Granted, d.Version?.Trim() ?? "")).ToList();
        var locale = request.Locale ?? await requestLanguage.GetAsync(cancellationToken);
        var (outcome, result) = await consents.SetAsync(apiContext.TenantId, apiContext.UserId, decisions, request.Source, locale, cancellationToken);
        return outcome == ConsentUpdateOutcome.Ok
            ? Results.Ok(result)
            : ApiResults.Problem(StatusCodes.Status409Conflict, ErrorCodes.ConsentVersionOutdated);
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPut("v1/tenant/consents", Handler)
            .Produces<ConsentsDto>(StatusCodes.Status200OK)
            .Validated()
            .Problems(StatusCodes.Status403Forbidden, StatusCodes.Status409Conflict)
            .Tenant("Tenant Consent", "Give or withdraw consents",
                "Each decision { type, granted, version } is appended to the audit log and becomes the current state. A grant must carry the CURRENT text " +
                "version (409 consent_version_outdated otherwise; nothing is written). source = where it happened (snake_case, e.g. tryon, body_photo, settings); " +
                "locale defaults to the profile language. Withdrawing marketingNotifications switches the weekly edit and price-drop pushes off; withdrawing " +
                "weight clears the stored weight. Teen accounts: marketingNotifications / contacts → 403 teen_restricted; teenTryOn is a teen's own try-on " +
                "consent (adults: 403 teen_restricted). Returns the same shape as GET.");
}
