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

namespace Api.Endpoints.V1.Catalog.Product;

public class Get : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromServices] ICatalogService catalog,
        CancellationToken cancellationToken)
    {

        var product = await catalog.GetProductAsync(id, cancellationToken);
        return product is null ? StoreResults.NotFound(StoreSocialErrorCodes.ProductNotFound) : Results.Ok(await catalog.ToDtoAsync(product, cancellationToken));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/catalog/product/{id}", Handler)
            .Produces<ProductDto>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Product detail")
            .WithDescription("A retired product still resolves (carts and looks point at it) with available=false. The affiliate link is only returned by checkout.")
            .WithTags("Catalog");
    }
}
