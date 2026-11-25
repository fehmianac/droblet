using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Context;
using Domain.Domain;
using Domain.Services;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.Trip;

public class DeleteExtra : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromRoute] string extraId,
        [FromServices] IApiContext apiContext,
        [FromServices] ITripService trips,
        CancellationToken cancellationToken)
    {
        return (await trips.RemoveExtraAsync(apiContext.TenantId, id, extraId, cancellationToken)).ToHttp();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapDelete("v1/tenant/trip/{id}/extra/{extraId}", Handler)
            .Produces<TripDetailDto>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status404NotFound)
            .Tenant("Tenant Trip", "Remove a free-text row", "Idempotent.");
    }
}
