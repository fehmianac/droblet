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

public class Put : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromBody] UpdateTripCommand request,
        [FromServices] IApiContext apiContext,
        [FromServices] ITripService trips,
        [FromServices] IValidator<UpdateTripCommand> validator,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        try
        {
            return (await trips.UpdateAsync(apiContext.TenantId, id, request, cancellationToken)).ToHttp();
        }
        catch (WeatherUnavailableException)
        {
            return ApiResults.Problem(StatusCodes.Status503ServiceUnavailable, StoreSocialErrorCodes.WeatherUnavailable);
        }
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPut("v1/tenant/trip/{id}", Handler)
            .Produces<TripDto>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status404NotFound)
            .Produces<TripDto>(StatusCodes.Status409Conflict)
            .Produces<ProblemDetails>(StatusCodes.Status422UnprocessableEntity)
            .Produces<ProblemDetails>(StatusCodes.Status503ServiceUnavailable)
            .Validated()
            .Tenant("Tenant Trip", "Update trip", "Trip fields if baseVersion matches; 409 carries the current trip. Without cityId the cityName is geocoded (422 trip_city_not_found / 503 weather_unavailable).");
    }
}
