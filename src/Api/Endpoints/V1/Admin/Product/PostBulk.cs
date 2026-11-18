using Domain.Services.Admin;
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
        [FromQuery] bool? dryRun,
        [FromServices] ICatalogService catalog,
        [FromServices] IOptionsMonitor<CatalogOptions> options,
        [FromServices] IAdminContext adminContext,
        [FromServices] IAuditLog audit,
        CancellationToken cancellationToken)
    {
        if (request.Products is not { Count: > 0 } products || products.Count > options.CurrentValue.BulkUpsertMax)
            return StoreResults.BadQuery();

        var result = await catalog.BulkUpsertProductsAsync(products, cancellationToken, dryRun == true);
        if (dryRun != true)
        {
            await audit.WriteAsync(adminContext.Admin, "product.bulk", "product", null, null, new
            {
                result.Created, result.Updated, result.Failed,
                written = result.Rows.Where(r => r.Outcome is "created" or "updated").Select(r => r.Id).ToList(),
            }, adminContext.Ip, cancellationToken);
        }
        return Results.Ok(result);
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/admin/product/bulk", Handler)
            .Produces<BulkUpsertResult>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAdmin(AdminPermissions.CatalogManage)
            .WithSummary("Bulk upsert products (feeds)")
            .WithDescription("Up to Catalog:BulkUpsertMax rows per call. Each row is validated on its own; valid rows are written, invalid rows are reported per index (outcome + field error codes). dryRun=true validates and reports without writing (CSV import preview).")
            .WithTags("Admin Catalog");
    }
}
