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

public class Get : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromQuery] string? cityId,
        [FromQuery] double? lat,
        [FromQuery] double? lon,
        [FromQuery] int? days,
        [FromServices] IWeatherService weather,
        CancellationToken cancellationToken)
    {

        if (days is < 1 or > IWeatherService.HorizonDays)
            return StoreResults.BadQuery();

        try
        {
            if (!string.IsNullOrEmpty(cityId))
            {
                if (cityId.Length > 32)
                    return StoreResults.BadQuery();
                var byCity = await weather.GetForecastByCityAsync(cityId, WeatherRules.ClampDays(days), cancellationToken);
                return byCity is null ? StoreResults.NotFound(StoreSocialErrorCodes.CityNotFound) : Results.Ok(byCity);
            }

            if (lat is not { } latitude || lon is not { } longitude || !WeatherRules.IsValidCoordinate(latitude, longitude))
                return StoreResults.BadQuery();
            return Results.Ok(await weather.GetForecastByLocationAsync(latitude, longitude, WeatherRules.ClampDays(days), cancellationToken));
        }
        catch (WeatherUnavailableException)
        {
            return ApiResults.Problem(StatusCodes.Status503ServiceUnavailable, StoreSocialErrorCodes.WeatherUnavailable);
        }
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/weather", Handler)
            .Produces<WeatherForecast>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .Produces<ProblemDetails>(StatusCodes.Status503ServiceUnavailable)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Weather forecast")
            .WithDescription("cityId (from the city search) or lat + lon (rounded to 0.1° server side; never stored with the user). days = 1–16 (default 7; the provider forecasts 16 days ahead). Daily min / max °C, condition code and rain probability from a shared cache.")
            .WithTags("Weather");
    }
}
