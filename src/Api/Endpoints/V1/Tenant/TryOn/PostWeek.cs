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

namespace Api.Endpoints.V1.Tenant.TryOn;

public class PostWeek : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] TryOnWeekCommand request,
        [FromServices] IApiContext apiContext,
        [FromServices] ITryOnService tryOn,
        [FromServices] IValidator<TryOnWeekCommand> validator,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        return (await tryOn.StartWeekAsync(apiContext.TenantId, request, cancellationToken)).ToHttp();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/tenant/tryon/plan-week", Handler)
            .Produces<TryOnBatchDto>(StatusCodes.Status202Accepted)
            .Problems(StatusCodes.Status402PaymentRequired, StatusCodes.Status403Forbidden, StatusCodes.Status409Conflict, StatusCodes.Status422UnprocessableEntity)
            .Validated()
            .Tenant("Tenant TryOn", "Generate try-ons for the planned week", "Starts one job per planned look that has no image yet. expectedCredits must equal the quoted requiredCredits (409 credit_quote_changed otherwise). All or nothing: 402 credits_exhausted charges nothing.");
    }
}
