using Api.Infrastructure.Contract;
using Domain.Constant;
using Domain.Context;
using Domain.Domain;
using Domain.Services;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.FavoriteProduct;

public class Get : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromServices] IApiContext apiContext,
        [FromServices] ICartService cart,
        CancellationToken cancellationToken)
    {
        return Results.Ok(await cart.GetFavoriteProductsAsync(apiContext.TenantId, cancellationToken));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/tenant/favorite/product", Handler)
            .Produces<FavoriteProductsDto>(StatusCodes.Status200OK)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Favourite products")
            .WithDescription("Ids of the products the user marked with the heart, newest first. Separate from the watch list.")
            .WithTags("Tenant Favorite Product");
    }
}
