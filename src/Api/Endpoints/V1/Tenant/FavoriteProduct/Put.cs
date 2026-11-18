using Api.Contracts;
using Api.Infrastructure.Contract;
using Domain.Constant;
using Domain.Context;
using Domain.Services;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.FavoriteProduct;

public class Put : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string productId,
        [FromServices] IApiContext apiContext,
        [FromServices] ICartService cart,
        CancellationToken cancellationToken)
    {
        var outcome = await cart.AddFavoriteProductAsync(apiContext.TenantId, productId, cancellationToken);
        return StoreResults.CartError(outcome) ?? Results.NoContent();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPut("v1/tenant/favorite/product/{productId}", Handler)
            .Produces(StatusCodes.Status204NoContent)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .Produces<ProblemDetails>(StatusCodes.Status422UnprocessableEntity)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Favourite a product")
            .WithDescription("Idempotent: marking a favourite again changes nothing.")
            .WithTags("Tenant Favorite Product");
    }
}
