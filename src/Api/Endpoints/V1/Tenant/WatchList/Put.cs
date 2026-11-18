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

namespace Api.Endpoints.V1.Tenant.WatchList;

public class Put : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string productId,
        [FromBody] WatchRequest? request,
        [FromServices] IApiContext apiContext,
        [FromServices] ICartService cart,
        [FromServices] IValidator<WatchRequest> validator,
        CancellationToken cancellationToken)
    {

        if (request is not null)
        {
            var validation = await validator.ValidateAsync(request, cancellationToken);
            if (!validation.IsValid)
                return Results.BadRequest(validation.Errors.ToProblemDetails());
        }

        var (outcome, item) = await cart.WatchAsync(apiContext.TenantId, productId, request?.Size, request?.Look?.ToDto(), request?.Notify, cancellationToken);
        return StoreResults.CartError(outcome) ?? Results.Ok(item);
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPut("v1/tenant/watch-list/{productId}", Handler)
            .Produces<WatchItemDto>(StatusCodes.Status200OK)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .Produces<ProblemDetails>(StatusCodes.Status422UnprocessableEntity)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Watch a product")
            .WithDescription("Idempotent: watching again keeps the original price reference.")
            .WithTags("Tenant Watch List");
    }
}
