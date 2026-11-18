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

public class GetAll : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromServices] IApiContext apiContext,
        [FromServices] IWardrobeService wardrobe,
        CancellationToken cancellationToken)
    {
        await Task.CompletedTask;
        return Results.Ok(await wardrobe.GetItemsAsync(apiContext.TenantId, cancellationToken));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/tenant/item", Handler)
            .Produces<List<ItemDto>>(StatusCodes.Status200OK)
            .Tenant("Tenant Item", "Get wardrobe items", "All pieces of the wardrobe, newest first, each with a short-lived image URL. Filtering and sorting happen on the device.");
    }
}
