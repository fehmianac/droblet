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

public class Put : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string date,
        [FromBody] PutPlanDayCommand request,
        [FromServices] IApiContext apiContext,
        [FromServices] IPlanService plan,
        [FromServices] IValidator<PutPlanDayCommand> validator,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        if (!CalendarDay.IsValid(date))
            return Results.NotFound();
        return (await plan.PutPlanDayAsync(apiContext.TenantId, date, request, cancellationToken)).ToHttp();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPut("v1/tenant/plan-day/{date}", Handler)
            .Produces<PlanDayDto>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status404NotFound)
            .Produces<PlanDayDto>(StatusCodes.Status409Conflict)
            .Problems(StatusCodes.Status422UnprocessableEntity)
            .Validated()
            .Tenant("Tenant PlanDay", "Create or update a plan day", "Occasion and look of a calendar day. baseVersion 0 creates; 409 carries the current day.");
    }
}
