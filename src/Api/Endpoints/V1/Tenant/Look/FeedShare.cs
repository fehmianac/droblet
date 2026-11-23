using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Context;
using Domain.Services;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.Look;

// Akış F2 (owner decision 21): "Akışta paylaş" on one of my looks. Closed to teens by TeenRouteRules (exact route,
// 403 teen_restricted, feature social).

public class PutFeedShare : IEndpoint
{
    private static async Task<IResult> Handler([FromRoute] string id, [FromServices] IApiContext apiContext, [FromServices] IFeedShareService shares, CancellationToken ct) =>
        await shares.ShareAsync(apiContext.TenantId, apiContext.UserId, id, ct) switch
        {
            FeedShareOutcome.Ok => Results.NoContent(),
            FeedShareOutcome.Teen => TeenGuard.Restricted(TeenFeature.Social),
            FeedShareOutcome.EmailNotVerified => ApiResults.Problem(StatusCodes.Status422UnprocessableEntity, StoreSocialErrorCodes.EmailNotVerified),
            FeedShareOutcome.HandleRequired => ApiResults.Problem(StatusCodes.Status422UnprocessableEntity, StoreSocialErrorCodes.HandleRequired),
            FeedShareOutcome.NotShareable => ApiResults.Problem(StatusCodes.Status422UnprocessableEntity, StoreSocialErrorCodes.LookNotShareable),
            FeedShareOutcome.RateLimited => ApiResults.Problem(StatusCodes.Status429TooManyRequests, ErrorCodes.TooManyAttempts),
            _ => StoreResults.NotFound(),
        };

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPut("v1/tenant/look/{id}/feed-share", Handler)
            .Produces(StatusCodes.Status204NoContent)
            .Produces<ProblemDetails>(StatusCodes.Status403Forbidden)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .Produces<ProblemDetails>(StatusCodes.Status422UnprocessableEntity)
            .Produces<ProblemDetails>(StatusCodes.Status429TooManyRequests)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Share my look to the Akış")
            .WithDescription("Published at once, no pre-approval; idempotent (a shared look answers 204 again). Adults with a verified e-mail and a @handle; no membership needed. " +
                             "The post is the look's AI flat-lay cover: it is listed once the cover of the look's current pieces is ready. " +
                             "403 teen_restricted (feature social); 404 not_found; 422 email_not_verified | handle_required | look_not_shareable (an imported look: its cover is the user's own photo; " +
                             "or a look removed by a moderator); 429 too_many_attempts (ContentFeed:MaxSharesPerDay, 0 = unlimited).")
            .WithTags("Tenant Look");
}

public class DeleteFeedShare : IEndpoint
{
    private static async Task<IResult> Handler([FromRoute] string id, [FromServices] IApiContext apiContext, [FromServices] IFeedShareService shares, CancellationToken ct)
    {
        await shares.UnshareAsync(apiContext.TenantId, id, ct);
        return Results.NoContent();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapDelete("v1/tenant/look/{id}/feed-share", Handler)
            .Produces(StatusCodes.Status204NoContent)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Take my look off the Akış")
            .WithDescription("Idempotent: always 204. Removes the post with its likes, saves, hides and report pointers (the like / save numbers start from zero if the look is shared again).")
            .WithTags("Tenant Look");
}
