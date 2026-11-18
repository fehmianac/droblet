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

namespace Api.Endpoints.V1.Admin.Product;

public class Delete : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromServices] ICatalogService catalog,
        CancellationToken cancellationToken)
    {

        return await catalog.RetireProductAsync(id, cancellationToken) ? Results.NoContent() : StoreResults.NotFound(StoreSocialErrorCodes.ProductNotFound);
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapDelete("v1/admin/product/{id}", Handler)
            .Produces(StatusCodes.Status204NoContent)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(AdminOptions.Policy)
            .WithSummary("Retire a product")
            .WithDescription("Never deleted: carts, looks and wardrobe items reference it. Retired products show as unavailable.")
            .WithTags("Admin Catalog");
    }
}
