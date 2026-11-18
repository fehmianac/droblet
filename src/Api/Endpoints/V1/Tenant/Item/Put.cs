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

public class Put : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromBody] UpdateItemCommand request,
        [FromServices] IApiContext apiContext,
        [FromServices] IWardrobeService wardrobe,
        [FromServices] IValidator<UpdateItemCommand> validator,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        return (await wardrobe.UpdateItemAsync(apiContext.TenantId, id, request, cancellationToken)).ToHttp();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPut("v1/tenant/item/{id}", Handler)
            .Produces<ItemDto>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status404NotFound)
            .Produces<ItemDto>(StatusCodes.Status409Conflict)
            .Problems(StatusCodes.Status422UnprocessableEntity)
            .Validated()
            .Tenant("Tenant Item", "Update item", "Updates the user fields (name, category, colours, fabric, seasons >= 1, size, brand, useOriginalImage) if baseVersion matches; 409 carries the current item. Wear count is server-computed and cannot be set.");
    }
}
