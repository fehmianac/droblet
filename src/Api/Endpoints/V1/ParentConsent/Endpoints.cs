using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Services;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.ParentConsent;

// Teen mode, the parent's side (docs/api/teen.md §5): anonymous, the e-mailed token is the credential. Rate limited per IP.

internal static class ParentConsentResults
{
    public const int PerIpPerHour = 60;

    public static async Task<IResult?> LimitAsync(HttpContext http, IRateLimiter limiter) =>
        http.ClientIp() is { } ip && !await limiter.TryAcquireAsync("parent-consent-ip", ip, PerIpPerHour, TimeSpan.FromHours(1), http.RequestAborted)
            ? ApiResults.Problem(StatusCodes.Status429TooManyRequests, ErrorCodes.TooManyAttempts)
            : null;

    public static IResult From(ParentConsentResult result) => result.Outcome switch
    {
        ParentConsentOutcome.Ok => Results.Ok(result.View),
        ParentConsentOutcome.Expired => ApiResults.Problem(StatusCodes.Status410Gone, ErrorCodes.ParentalConsentLinkExpired),
        ParentConsentOutcome.AlreadyDecided or ParentConsentOutcome.NotApproved => ApiResults.Problem(StatusCodes.Status409Conflict, ErrorCodes.ParentalConsentAlreadyDecided),
        ParentConsentOutcome.ConfirmationsRequired => ApiResults.Problem(StatusCodes.Status400BadRequest, ErrorCodes.ParentalConsentConfirmationsRequired),
        ParentConsentOutcome.VersionOutdated => ApiResults.Problem(StatusCodes.Status409Conflict, ErrorCodes.ConsentVersionOutdated),
        _ => ApiResults.Problem(StatusCodes.Status404NotFound, ErrorCodes.ParentalConsentLinkInvalid),
    };

    public static RouteHandlerBuilder Parent(this RouteHandlerBuilder builder, string summary, string description) =>
        builder
            .Produces<ParentConsentViewDto>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .Produces<ProblemDetails>(StatusCodes.Status409Conflict)
            .Produces<ProblemDetails>(StatusCodes.Status410Gone)
            .Produces<ProblemDetails>(StatusCodes.Status429TooManyRequests)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .AllowAnonymous()
            .WithSummary(summary)
            .WithDescription(description)
            .WithTags("Parent Consent");
}

public class Get : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromQuery] string? token,
        [FromServices] ITeenService teens,
        [FromServices] IRateLimiter limiter,
        HttpContext httpContext,
        CancellationToken cancellationToken) =>
        await ParentConsentResults.LimitAsync(httpContext, limiter) ?? ParentConsentResults.From(await teens.ParentViewAsync(token ?? "", cancellationToken));

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapGet("v1/parent-consent", Handler)
            .Parent("Open a parental consent link",
                "{ kind (request | manage), status (pending | approved | declined | withdrawn | ended), teenName (first word), language, expiresAt, " +
                "textVersion, tryOnOffered, parentAllowedTryOn, decidedAt }. 404 parental_consent_link_invalid (unknown or replaced by a newer request); " +
                "410 parental_consent_link_expired (undecided request past its lifetime). 60 calls / hour / IP.");
}

public sealed record ParentDecisionRequest(
    string? Token, bool Approve, string? TextVersion, bool ConfirmParent = false, bool ConfirmNotice = false, bool ConfirmProcessing = false, bool AllowTryOn = false);

public class PostDecision : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] ParentDecisionRequest request,
        [FromServices] ITeenService teens,
        [FromServices] IRateLimiter limiter,
        HttpContext httpContext,
        CancellationToken cancellationToken)
    {
        if (await ParentConsentResults.LimitAsync(httpContext, limiter) is { } limited)
            return limited;
        var decision = new ParentDecision(request.Token ?? "", request.Approve, request.TextVersion, request.ConfirmParent, request.ConfirmNotice,
            request.ConfirmProcessing, request.AllowTryOn);
        return ParentConsentResults.From(await teens.DecideAsync(decision, httpContext.ClientIp(), cancellationToken));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPost("v1/parent-consent/decision", Handler)
            .Parent("Approve or decline as a parent",
                "Approve needs confirmParent, confirmNotice and confirmProcessing all true (400 parental_consent_confirmations_required) and the current " +
                "textVersion (409 consent_version_outdated); allowTryOn is a separate box, stored only when Teen:TryOnEnabled. Decline needs only the token. " +
                "One decision per request (409 parental_consent_already_decided). Recorded with time, parent e-mail hash, IP hash, text version and the boxes; " +
                "after an approval the parent gets a confirmation e-mail with the withdrawal link.");
}

public sealed record ParentWithdrawRequest(string? Token);

public class PostWithdraw : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] ParentWithdrawRequest request,
        [FromServices] ITeenService teens,
        [FromServices] IRateLimiter limiter,
        HttpContext httpContext,
        CancellationToken cancellationToken) =>
        await ParentConsentResults.LimitAsync(httpContext, limiter)
        ?? ParentConsentResults.From(await teens.WithdrawAsync(request.Token ?? "", httpContext.ClientIp(), cancellationToken));

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPost("v1/parent-consent/withdraw", Handler)
            .Parent("Withdraw parental consent",
                "With the link of the confirmation e-mail (kind manage) until the teen turns 18. Status withdrawn: photo features off (limited mode) and the " +
                "teen's personal photos deleted (body / face photos, try-on images, palette result, profile picture). Idempotent; 409 when nothing was approved.");
}
