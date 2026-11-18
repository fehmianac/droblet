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

public class PostBulk : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] BulkProductsRequest request,
        [FromServices] ICatalogService catalog,
        [FromServices] IOptionsMonitor<CatalogOptions> options,
        CancellationToken cancellationToken)
    {

        if (request.Products is not { Count: > 0 } products || products.Count > options.CurrentValue.BulkUpsertMax)
            return StoreResults.BadQuery();

        return Results.Ok(await catalog.BulkUpsertProductsAsync(products, cancellationToken));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/admin/product/bulk", Handler)
            .Produces<BulkUpsertResult>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(AdminOptions.Policy)
            .WithSummary("Bulk upsert products (feeds)")
            .WithDescription("Up to Catalog:BulkUpsertMax rows per call. Each row is validated on its own; valid rows are written, invalid rows are reported per index (outcome + field error codes).")
            .WithTags("Admin Catalog");
    }
}
