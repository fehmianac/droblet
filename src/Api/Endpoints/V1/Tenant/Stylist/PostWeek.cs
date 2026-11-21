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

public class PostWeek : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] StartWeekCommand request,
        [FromServices] IApiContext apiContext,
        [FromServices] IStylistService stylist,
        [FromServices] IValidator<StartWeekCommand> validator,
        HttpContext httpContext,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        return (await stylist.StartWeekAsync(apiContext.TenantId, request, httpContext.RequestLanguage(), cancellationToken)).ToHttp($"/v1/tenant/job/{request.RequestId}");
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/tenant/stylist/week", Handler)
            .Produces<JobDto>(StatusCodes.Status202Accepted)
            .Problems(StatusCodes.Status403Forbidden, StatusCodes.Status409Conflict, StatusCodes.Status429TooManyRequests)
            .Validated()
            .Tenant("Tenant Stylist", "Plan my week", "Queues a job that drafts one look per day for the 7 days from weekStart. Nothing is written to the plan until the week is accepted. Membership required — an approved teen uses the Teen:Stylist weekly allowance (429 teen_stylist_weekly_limit with resetsAt, 403 teen_stylist_unavailable).");
    }
}
