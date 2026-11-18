using Api.Infrastructure.Contract;
using Domain.Constant;
using Domain.Context;
using Domain.Domain;
using Infrastructure.Services.Integration;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.Profile;

public class GetStats : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromServices] IApiContext apiContext,
        [FromServices] IProfileStatsService stats,
        CancellationToken cancellationToken)
    {
        return Results.Ok(await stats.GetAsync(apiContext.TenantId, cancellationToken));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/tenant/profile/stats", Handler)
            .Produces<ProfileStatsDto>(StatusCodes.Status200OK)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Get my profile counters")
            .WithDescription("Screen 28: number of wardrobe pieces, looks, trips, followers and following of the signed-in account.")
            .WithTags("Tenant Profile");
    }
}
