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

public class PostFromProduct : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] AddProductItemCommand request,
        [FromServices] IApiContext apiContext,
        [FromServices] IWardrobeService wardrobe,
        [FromServices] ICatalogProductLookup products,
        [FromServices] IValidator<AddProductItemCommand> validator,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        var product = await products.GetAsync(request.ProductId, cancellationToken);
        if (product is null or { Retired: true })
            return ApiResults.Problem(StatusCodes.Status404NotFound, ErrorCodes.ProductNotFound);

        var result = await wardrobe.AddFromProductAsync(apiContext.TenantId, product, request.ClientMutationId, request.Size, request.ItemId, cancellationToken);
        return result.Outcome switch
        {
            ItemCreateOutcome.Created => Results.Created($"/v1/tenant/item/{result.Item!.Id}", result),
            ItemCreateOutcome.AlreadyApplied => Results.Ok(result),
            _ => ApiResults.Problem(result.Code == ErrorCodes.PremiumRequired ? StatusCodes.Status403Forbidden : StatusCodes.Status422UnprocessableEntity, result.Code ?? ErrorCodes.ValidationFailed),
        };
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/tenant/item/from-product", Handler)
            .Produces<ItemCreateResultDto>(StatusCodes.Status200OK)
            .Produces<ItemCreateResultDto>(StatusCodes.Status201Created)
            .Problems(StatusCodes.Status403Forbidden, StatusCodes.Status404NotFound, StatusCodes.Status422UnprocessableEntity)
            .Validated()
            .Tenant("Tenant Item", "Add a catalog product to the wardrobe", "Screen 22 Gardiroba ekle: creates an item (source = purchase) from the catalog product. Idempotent by clientMutationId.");
    }
}
