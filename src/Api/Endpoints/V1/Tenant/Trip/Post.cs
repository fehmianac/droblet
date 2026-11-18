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

public class Post : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] CreateTripCommand request,
        [FromServices] IApiContext apiContext,
        [FromServices] ITripService trips,
        [FromServices] IValidator<CreateTripCommand> validator,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        return (await trips.CreateAsync(apiContext.TenantId, request, cancellationToken)).ToHttp($"/v1/tenant/trip/{request.Id}");
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/tenant/trip", Handler)
            .Produces<TripDto>(StatusCodes.Status200OK)
            .Produces<TripDto>(StatusCodes.Status201Created)
            .Validated()
            .Tenant("Tenant Trip", "Create trip", "Client-generated id (ULID), city, start and end day, trip types, cabinOnly. Sending the same id again returns the stored trip (200).");
    }
}
