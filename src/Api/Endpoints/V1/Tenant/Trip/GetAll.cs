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

public class GetAll : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromServices] IApiContext apiContext,
        [FromServices] ITripService trips,
        CancellationToken cancellationToken)
    {
        return Results.Ok(await trips.GetAllAsync(apiContext.TenantId, cancellationToken));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/tenant/trip", Handler)
            .Produces<List<TripDto>>(StatusCodes.Status200OK)
            .Tenant("Tenant Trip", "Get trips", "Suitcases and the trip archive (archived = explicitly archived or already over), newest first.");
    }
}
