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

public class Delete : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromServices] IApiContext apiContext,
        [FromServices] IWardrobeService wardrobe,
        CancellationToken cancellationToken)
    {
        return await wardrobe.DeleteItemAsync(apiContext.TenantId, id, cancellationToken) ? Results.NoContent() : Results.NotFound();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapDelete("v1/tenant/item/{id}", Handler)
            .Produces(StatusCodes.Status204NoContent)
            .Produces(StatusCodes.Status404NotFound)
            .Tenant("Tenant Item", "Delete item", "Deletes the piece and its images. Looks keep the slot and return it as unavailable.");
    }
}
