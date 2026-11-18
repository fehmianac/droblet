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

namespace Api.Endpoints.V1.Tenant.Cart;

public class PostCheckout : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string brandId,
        [FromServices] IApiContext apiContext,
        [FromServices] IAffiliateService affiliate,
        CancellationToken cancellationToken)
    {

        return StoreResults.Checkout(await affiliate.CheckoutBrandAsync(apiContext.TenantId, brandId, cancellationToken));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/tenant/cart/checkout/{brandId}", Handler)
            .Produces<CheckoutDto>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .Produces<ProblemDetails>(StatusCodes.Status422UnprocessableEntity)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Check out a brand group")
            .WithDescription("\"[Marka]'da öde\": one click for the brand's cart lines; returns the brand / affiliate URL with click_id. Payment and delivery happen on the brand site. Cart lines are kept.")
            .WithTags("Tenant Cart");
    }
}
