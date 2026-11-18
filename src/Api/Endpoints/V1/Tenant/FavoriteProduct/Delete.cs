using Api.Infrastructure.Contract;
using Domain.Constant;
using Domain.Context;
using Domain.Services;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.FavoriteProduct;

public class Delete : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string productId,
        [FromServices] IApiContext apiContext,
        [FromServices] ICartService cart,
        CancellationToken cancellationToken)
    {
        await cart.RemoveFavoriteProductAsync(apiContext.TenantId, productId, cancellationToken);
        return Results.NoContent();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapDelete("v1/tenant/favorite/product/{productId}", Handler)
            .Produces(StatusCodes.Status204NoContent)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Remove a favourite product")
            .WithDescription("Idempotent: 204 also when the product was not a favourite.")
            .WithTags("Tenant Favorite Product");
    }
}
