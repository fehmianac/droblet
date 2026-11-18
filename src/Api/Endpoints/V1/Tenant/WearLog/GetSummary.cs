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

namespace Api.Endpoints.V1.Tenant.WearLog;

public class GetSummary : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromQuery] string? month,
        [FromServices] IApiContext apiContext,
        [FromServices] IPlanService plan,
        CancellationToken cancellationToken)
    {
        if (!CalendarDay.TryParseMonth(month, out var first))
            return ApiResults.Problem(StatusCodes.Status400BadRequest, ErrorCodes.ValidationFailed);
        return Results.Ok(await plan.GetWearSummaryAsync(apiContext.TenantId, first, cancellationToken));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/tenant/wear-log/summary", Handler)
            .Produces<WearSummaryDto>(StatusCodes.Status200OK)
            .Problems(StatusCodes.Status400BadRequest)
            .Tenant("Tenant WearLog", "Get the month summary", "Logged days, total wears and the most worn pieces of the month (month = yyyy-MM).");
    }
}
