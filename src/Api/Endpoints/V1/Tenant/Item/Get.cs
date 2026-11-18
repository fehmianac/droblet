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

namespace Api.Endpoints.V1.Tenant.Item;

public class Get : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromServices] IApiContext apiContext,
        [FromServices] IWardrobeService wardrobe,
        CancellationToken cancellationToken)
    {
        var item = await wardrobe.GetItemAsync(apiContext.TenantId, id, cancellationToken);
        return item is null ? Results.NotFound() : Results.Ok(item);
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/tenant/item/{id}", Handler)
            .Produces<ItemDetailDto>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status404NotFound)
            .Tenant("Tenant Item", "Get item detail", "Piece detail with wear count and the looks that contain it.");
    }
}
