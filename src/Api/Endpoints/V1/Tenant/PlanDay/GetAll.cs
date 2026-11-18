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

namespace Api.Endpoints.V1.Tenant.PlanDay;

public class GetAll : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromQuery] string? from,
        [FromQuery] string? to,
        [FromServices] IApiContext apiContext,
        [FromServices] IPlanService plan,
        CancellationToken cancellationToken)
    {
        if (!CalendarDay.TryParse(from, out var start) || !CalendarDay.TryParse(to, out var end) || end < start || end.DayNumber - start.DayNumber > 62)
            return ApiResults.Problem(StatusCodes.Status400BadRequest, ErrorCodes.ValidationFailed);
        return Results.Ok(await plan.GetPlanDaysAsync(apiContext.TenantId, start, end, cancellationToken));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/tenant/plan-day", Handler)
            .Produces<List<PlanDayDto>>(StatusCodes.Status200OK)
            .Problems(StatusCodes.Status400BadRequest)
            .Tenant("Tenant PlanDay", "Get plan days", "Plan days between from and to (inclusive, yyyy-MM-dd, at most 62 days) with their looks and a worn flag.");
    }
}
