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

namespace Api.Endpoints.V1.Tenant.Catalog;

public class PostProductCheckout : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromBody] ProductCheckoutRequest? request,
        [FromServices] IApiContext apiContext,
        [FromServices] IAffiliateService affiliate,
        [FromServices] IValidator<ProductCheckoutRequest> validator,
        CancellationToken cancellationToken)
    {

        if (request is not null)
        {
            var validation = await validator.ValidateAsync(request, cancellationToken);
            if (!validation.IsValid)
                return Results.BadRequest(validation.Errors.ToProblemDetails());
        }

        return StoreResults.Checkout(await affiliate.CheckoutProductAsync(apiContext.TenantId, id, request?.Look?.ToDto(), cancellationToken));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/tenant/catalog/product/{id}/checkout", Handler)
            .Produces<CheckoutDto>(StatusCodes.Status200OK)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .Produces<ProblemDetails>(StatusCodes.Status422UnprocessableEntity)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Open one product on the brand site")
            .WithDescription("Creates a click (click_id → user, product, look, source) and returns the affiliate URL with the click id appended. No payment data is ever accepted.")
            .WithTags("Tenant Catalog");
    }
}
