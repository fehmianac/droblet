using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Context;
using Domain.Domain;
using Domain.Services;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.Trip;

public class DeleteItem : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromRoute] string itemId,
        [FromServices] IApiContext apiContext,
        [FromServices] ITripService trips,
        CancellationToken cancellationToken)
    {
        return (await trips.RemoveItemAsync(apiContext.TenantId, id, itemId, cancellationToken)).ToHttp();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapDelete("v1/tenant/trip/{id}/item/{itemId}", Handler)
            .Produces<TripDetailDto>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status404NotFound)
            .Tenant("Tenant Trip", "Remove a piece from the packing list", "The piece leaves the list and every day that wears it. Idempotent.");
    }
}
