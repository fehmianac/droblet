using System.Text.Json;
using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Context;
using Domain.Domain;
using Domain.Entity;
using Domain.Enum;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Domain.Validation;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace Api.Endpoints.V1.Weather;

public class GetCities : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromQuery] string? q,
        [FromServices] IWeatherService weather,
        CancellationToken cancellationToken)
    {

        if (q is null || q.Trim().Length is < 2 or > 60)
            return StoreResults.BadQuery();

        try
        {
            return Results.Ok(await weather.SearchCitiesAsync(q, cancellationToken));
        }
        catch (WeatherUnavailableException)
        {
            return ApiResults.Problem(StatusCodes.Status503ServiceUnavailable, StoreSocialErrorCodes.WeatherUnavailable);
        }
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/weather/city", Handler)
            .Produces<List<CityDto>>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<ProblemDetails>(StatusCodes.Status503ServiceUnavailable)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("City autocomplete")
            .WithDescription("q = at least 2 characters. Names in the request language. The returned id is the cityId for the profile and the forecast.")
            .WithTags("Weather");
    }
}
