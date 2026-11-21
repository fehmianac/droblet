using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Context;
using Domain.Services;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.Teen;

// Teen mode, the teen's side (docs/api/teen.md §5): the status and the parental consent request.

internal static class TeenResults
{
    public static IResult From(TeenResult result, int successStatus = StatusCodes.Status200OK) => result.Outcome switch
    {
        TeenOutcome.Ok => successStatus == StatusCodes.Status202Accepted ? Results.Accepted(null, result.Status) : Results.Ok(result.Status),
        TeenOutcome.NotTeen => ApiResults.Problem(StatusCodes.Status409Conflict, ErrorCodes.NotATeenAccount),
        TeenOutcome.AlreadyGiven => ApiResults.Problem(StatusCodes.Status409Conflict, ErrorCodes.ParentalConsentAlreadyGiven),
        TeenOutcome.NotRequested => ApiResults.Problem(StatusCodes.Status409Conflict, ErrorCodes.ParentalConsentNotRequested),
        TeenOutcome.InvalidEmail => ApiResults.Problem(StatusCodes.Status400BadRequest, ErrorCodes.ParentEmailInvalid),
        TeenOutcome.SameAsTeen => ApiResults.Problem(StatusCodes.Status400BadRequest, ErrorCodes.ParentEmailSameAsTeen),
        _ => ApiResults.Problem(StatusCodes.Status429TooManyRequests, ErrorCodes.TooManyAttempts),
    };
}

public class GetStatus : IEndpoint
{
    private static async Task<IResult> Handler([FromServices] IApiContext apiContext, [FromServices] ITeenService teens, CancellationToken cancellationToken) =>
        Results.Ok(await teens.StatusAsync(apiContext.UserId, cancellationToken));

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapGet("v1/tenant/teen", Handler)
            .Produces<TeenStatusDto>(StatusCodes.Status200OK)
            .Tenant("Tenant Teen", "My age band and teen status",
                "{ ageBand, teen }: adult → teen null. Teen → status (pendingParentalConsent | active | declined | withdrawn), the request " +
                "(state none | sent | expired, masked parent e-mail, sent / expires / resend-available times), parentAllowedTryOn, ownTryOnConsent, " +
                "tryOn { available, reason }, adultFrom and restrictions (docs/api/teen.md §5).");
}

public sealed record ParentalConsentRequest(string? ParentEmail);

public class PostParentalConsent : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] ParentalConsentRequest request,
        [FromServices] IApiContext apiContext,
        [FromServices] ITeenService teens,
        CancellationToken cancellationToken) =>
        TeenResults.From(await teens.RequestConsentAsync(apiContext.UserId, request.ParentEmail ?? "", cancellationToken), StatusCodes.Status202Accepted);

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPost("v1/tenant/teen/parental-consent", Handler)
            .Produces<TeenStatusDto>(StatusCodes.Status202Accepted)
            .Problems(StatusCodes.Status400BadRequest, StatusCodes.Status409Conflict, StatusCodes.Status429TooManyRequests)
            .Tenant("Tenant Teen", "Ask a parent for approval",
                "Teen accounts only (409 not_a_teen_account). Sends the parent an e-mail (TR / EN, profile language) with a signed link to " +
                "/parent-consent/?token=… valid Teen:ConsentLinkDays (7); replaces an open request. 400 parent_email_invalid / parent_email_same_as_teen; " +
                "409 parental_consent_already_given; 429 too_many_attempts (1 per minute, Teen:ConsentRequestsPerDay, Teen:ConsentRequestsPerParentPerDay).");
}

public class PostResend : IEndpoint
{
    private static async Task<IResult> Handler([FromServices] IApiContext apiContext, [FromServices] ITeenService teens, CancellationToken cancellationToken) =>
        TeenResults.From(await teens.ResendAsync(apiContext.UserId, cancellationToken), StatusCodes.Status202Accepted);

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPost("v1/tenant/teen/parental-consent/resend", Handler)
            .Produces<TeenStatusDto>(StatusCodes.Status202Accepted)
            .Problems(StatusCodes.Status409Conflict, StatusCodes.Status429TooManyRequests)
            .Tenant("Tenant Teen", "Send the parent e-mail again",
                "The same e-mail to the stored parent address with a fresh link (the previous link stops working). 409 parental_consent_not_requested " +
                "when nothing was sent yet, parental_consent_already_given when approved; same rate limits as the first request.");
}
