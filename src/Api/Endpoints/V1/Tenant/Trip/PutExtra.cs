using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Context;
using Domain.Domain;
using Domain.Services;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.Trip;

public class PutExtra : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromRoute] string extraId,
        [FromBody] PutTripExtraCommand request,
        [FromServices] IApiContext apiContext,
        [FromServices] ITripService trips,
        [FromServices] IValidator<PutTripExtraCommand> validator,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        return (await trips.PutExtraAsync(apiContext.TenantId, id, extraId, request, cancellationToken)).ToHttp();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPut("v1/tenant/trip/{id}/extra/{extraId}", Handler)
            .Produces<TripDetailDto>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status404NotFound)
            .Validated()
            .Tenant("Tenant Trip", "Write or tick a free-text row", "A free-text row of the suitcase (passport, charger): created or replaced as a whole. extraId is a ULID from the device.");
    }
}
