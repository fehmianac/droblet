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

namespace Api.Endpoints.V1.Tenant.Stylist;

public class PostWeekAccept : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string jobId,
        [FromBody] AcceptWeekCommand request,
        [FromServices] IApiContext apiContext,
        [FromServices] IStylistService stylist,
        [FromServices] IValidator<AcceptWeekCommand> validator,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        return (await stylist.AcceptWeekAsync(apiContext.TenantId, jobId, request, cancellationToken)).ToHttp();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/tenant/stylist/week/{jobId}/accept", Handler)
            .Produces<AcceptedWeekDto>(StatusCodes.Status200OK)
            .Problems(StatusCodes.Status404NotFound, StatusCodes.Status409Conflict)
            .Validated()
            .Tenant("Tenant Stylist", "Accept a week plan", "Writes the drafted days (all, or the given dates) as Looks + PlanDays. Idempotent by clientMutationId.");
    }
}
