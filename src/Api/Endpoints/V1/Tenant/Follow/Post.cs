using Api.Contracts;
using Api.Infrastructure.Contract;
using Domain.Context;
using Domain.Services;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.Follow;

public class Post : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string handle,
        [FromServices] IApiContext apiContext,
        [FromServices] ISocialService social,
        CancellationToken cancellationToken)
    {
        var (outcome, state) = await social.FollowAsync(apiContext.TenantId, handle, cancellationToken);
        return StoreResults.SocialError(outcome) ?? Results.Ok(new FollowResultDto(state));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/tenant/follow/{handle}", Handler)
            .Produces<FollowResultDto>(StatusCodes.Status200OK)
            .Problems(StatusCodes.Status404NotFound, StatusCodes.Status422UnprocessableEntity)
            .Tenant("Tenant Social", "Follow",
                "Decision 8: a public account is followed at once (state following); a followers-only or private account gets a pending request " +
                "(state requested) that the owner approves or declines. Idempotent. 422 follow_limit_reached (follows + pending requests) / cannot_target_self.");
    }
}
