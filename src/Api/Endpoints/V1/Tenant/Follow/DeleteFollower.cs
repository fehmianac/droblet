using Api.Contracts;
using Api.Infrastructure.Contract;
using Domain.Context;
using Domain.Services;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.Follow;

public class DeleteFollower : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string handle,
        [FromServices] IApiContext apiContext,
        [FromServices] ISocialService social,
        CancellationToken cancellationToken) =>
        StoreResults.SocialError(await social.RemoveFollowerAsync(apiContext.TenantId, handle, cancellationToken)) ?? Results.NoContent();

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapDelete("v1/tenant/follower/{handle}", Handler)
            .Produces(StatusCodes.Status204NoContent)
            .Problems(StatusCodes.Status404NotFound, StatusCodes.Status422UnprocessableEntity)
            .Tenant("Tenant Social", "Remove a follower", "Removes that account's follow of the caller (both edges). Idempotent. 404 unknown handle.");
    }
}
