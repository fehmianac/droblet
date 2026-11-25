using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Context;
using Domain.Domain;
using Domain.Services;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.Trip;

public class PostItems : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromBody] AddTripItemsCommand request,
        [FromServices] IApiContext apiContext,
        [FromServices] ITripService trips,
        [FromServices] IValidator<AddTripItemsCommand> validator,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        return (await trips.AddItemsAsync(apiContext.TenantId, id, request, cancellationToken)).ToHttp();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/tenant/trip/{id}/items", Handler)
            .Produces<TripDetailDto>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status404NotFound)
            .Validated()
            .Tenant("Tenant Trip", "Add own pieces to the packing list", "Pieces of the caller's wardrobe put on the list by hand. A piece already on the list stays as it is. No AI call, no credit.");
    }
}
