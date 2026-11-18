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

public class Put : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromBody] ProductInput request,
        [FromServices] IValidator<ProductInput> validator,
        [FromServices] ICatalogService catalog,
        CancellationToken cancellationToken)
    {

        request = request with { Id = id };
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        var result = await catalog.UpsertProductAsync(request, cancellationToken);
        if (result.Outcome == CatalogWriteOutcome.BrandNotFound)
            return ApiResults.Problem(StatusCodes.Status422UnprocessableEntity, StoreSocialErrorCodes.BrandNotFound);
        return Results.Ok(new AdminProductWriteDto(result.Product!.ToAdminDto(), result.Outcome == CatalogWriteOutcome.Created, result.PriceDropped, result.WatchersFlagged));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPut("v1/admin/product/{id}", Handler)
            .Produces<AdminProductWriteDto>(StatusCodes.Status200OK)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<ProblemDetails>(StatusCodes.Status422UnprocessableEntity)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAdmin(AdminPermissions.CatalogManage)
            .Audited("product.upsert", "product", "id", AdminAuditBefore.Product)
            .WithSummary("Create or update a product")
            .WithDescription("Upsert by id. name / description are language maps (default language required). A lower price than before flags every watch-list row of the product (priceDropped, watchersFlagged).")
            .WithTags("Admin Catalog");
    }
}
