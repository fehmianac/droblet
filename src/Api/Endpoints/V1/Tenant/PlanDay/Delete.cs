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

public class Delete : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string date,
        [FromServices] IApiContext apiContext,
        [FromServices] IPlanService plan,
        CancellationToken cancellationToken)
    {
        return CalendarDay.IsValid(date) && await plan.DeletePlanDayAsync(apiContext.TenantId, date, cancellationToken) ? Results.NoContent() : Results.NotFound();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapDelete("v1/tenant/plan-day/{date}", Handler)
            .Produces(StatusCodes.Status204NoContent)
            .Produces(StatusCodes.Status404NotFound)
            .Tenant("Tenant PlanDay", "Remove a plan day", "Screen 07 row menu: kaldir.");
    }
}
