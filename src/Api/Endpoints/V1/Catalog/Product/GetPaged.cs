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

public class GetPaged : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromQuery] string? category,
        [FromQuery] string? brand,
        [FromQuery] string? color,
        [FromQuery(Name = "size")] string? sizeFilter,
        [FromQuery] string? q,
        [FromQuery] string? priceBand,
        [FromQuery] string? sort,
        [FromQuery] string? pageToken,
        [FromQuery] int? limit,
        [FromServices] ICatalogService catalog,
        [FromServices] IOptionsMonitor<CatalogOptions> options,
        CancellationToken cancellationToken)
    {

        if (!QueryParsing.TryEnum<ProductCategory>(category, out var categoryValue)
            || !QueryParsing.TryEnum<PriceBand>(priceBand, out var bandValue)
            || !QueryParsing.TryEnum<ProductSort>(sort, out var sortValue)
            || q is { Length: > 80 })
            return StoreResults.BadQuery();

        var settings = options.CurrentValue;
        var pageSize = Math.Clamp(limit ?? settings.PageSize, 1, settings.MaxPageSize);
        var query = new CatalogQuery(categoryValue, brand, color, sizeFilter, q, bandValue, sortValue ?? ProductSort.Newest);
        var page = CatalogRules.Query(await catalog.GetProductsAsync(cancellationToken), query, pageToken, pageSize, await catalog.GetBrandNamesAsync(cancellationToken));

        var items = new List<ProductDto>(page.Items.Count);
        foreach (var product in page.Items)
            items.Add(await catalog.ToDtoAsync(product, cancellationToken));
        return Results.Ok(new GetPagedResponse<ProductDto>(items, page.PageToken, page.Total));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/catalog/product", Handler)
            .Produces<GetPagedResponse<ProductDto>>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Products (paged)")
            .WithDescription("Filters: category, brand (id), color, size, priceBand, q (name / brand, every language, Turkish letters folded). sort = newest (default) | priceAsc | priceDesc. Cursor paging with pageToken; count = total matches.")
            .WithTags("Catalog");
    }
}
