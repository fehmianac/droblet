using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Context;
using Domain.Domain;
using Domain.Enum;
using Domain.Services;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.Trip;

public class DeleteArchive : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromServices] IApiContext apiContext,
        [FromServices] ITripService trips,
        CancellationToken cancellationToken)
    {
        return (await trips.ArchiveAsync(apiContext.TenantId, id, false, cancellationToken)).ToHttp();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapDelete("v1/tenant/trip/{id}/archive", Handler)
            .Produces<TripDto>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status404NotFound)
            .Tenant("Tenant Trip", "Unarchive trip", "Takes the trip out of the archive (idempotent).");
    }
}
