using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Context;
using Domain.Domain;
using Domain.Services;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.Trip;

public class PutDay : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromRoute] string date,
        [FromBody] SetTripDayCommand request,
        [FromServices] IApiContext apiContext,
        [FromServices] ITripService trips,
        [FromServices] IValidator<SetTripDayCommand> validator,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        return (await trips.SetDayAsync(apiContext.TenantId, id, date, request, cancellationToken)).ToHttp();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPut("v1/tenant/trip/{id}/day/{date}", Handler)
            .Produces<TripDetailDto>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status404NotFound)
            .Validated()
            .Tenant("Tenant Trip", "Set the pieces of a trip day", "Replaces the pieces of one trip day with own wardrobe pieces; a piece the list lacks is added to it. The rules of a hand-built look apply. No AI call, no credit.");
    }
}
