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

namespace Api.Endpoints.V1.Tenant.Today;

public class Get : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromQuery] string? date,
        [FromQuery] double? latitude,
        [FromQuery] double? longitude,
        [FromServices] IApiContext apiContext,
        [FromServices] IPlanService plan,
        CancellationToken cancellationToken)
    {
        if (!CalendarDay.TryParse(date, out var day) || latitude is < -90 or > 90 || longitude is < -180 or > 180)
            return ApiResults.Problem(StatusCodes.Status400BadRequest, ErrorCodes.ValidationFailed);
        return Results.Ok(await plan.GetTodayAsync(apiContext.TenantId, day, latitude, longitude, cancellationToken));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/tenant/today", Handler)
            .Produces<TodayDto>(StatusCodes.Status200OK)
            .Problems(StatusCodes.Status400BadRequest)
            .Tenant("Tenant Today", "Get the Today snapshot", "One call for screen 06: date, season, weather (coordinates when the user shared a location, else the profile city; null when neither is known or the provider is unavailable), planned occasion, the look of the day with missing-piece flags, worn flag and the 7-day strip. date = the user local day (yyyy-MM-dd).");
    }
}
