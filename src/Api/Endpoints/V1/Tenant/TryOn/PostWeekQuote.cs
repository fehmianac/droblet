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

public class PostWeekQuote : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] TryOnWeekQuoteRequest request,
        [FromServices] IApiContext apiContext,
        [FromServices] ITryOnService tryOn,
        [FromServices] IValidator<TryOnWeekQuoteRequest> validator,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        return (await tryOn.QuoteWeekAsync(apiContext.TenantId, request.WeekStart, cancellationToken)).ToHttp();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/tenant/tryon/plan-week/quote", Handler)
            .Produces<TryOnQuoteDto>(StatusCodes.Status200OK)
            .Problems(StatusCodes.Status422UnprocessableEntity)
            .Validated()
            .Tenant("Tenant TryOn", "Quote the credits for a week of try-ons", "Screen 07b: how many credits Uzerimde gor would cost for the planned looks of the week (cached images and repeated outfits are free), and the remaining balance. Charges nothing.");
    }
}
