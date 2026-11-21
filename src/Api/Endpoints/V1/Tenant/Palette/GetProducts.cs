using Domain.Manager;
using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Context;
using Domain.Domain;
using Domain.Enum;
using Domain.Options;
using Domain.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace Api.Endpoints.V1.Tenant.Palette;

public class GetProducts : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromQuery] string? category,
        [FromQuery] string? priceBand,
        [FromQuery] string? sort,
        [FromQuery] string? pageToken,
        [FromQuery] int? limit,
        [FromServices] IApiContext apiContext,
        [FromServices] IPaletteService palette,
        [FromServices] ICatalogService catalog,
        [FromServices] IOptionsMonitor<CatalogOptions> options,
        [FromServices] IRepository repository,
        CancellationToken cancellationToken)
    {
        if (!QueryParsing.TryEnum<ProductCategory>(category, out var categoryValue)
            || !QueryParsing.TryEnum<PriceBand>(priceBand, out var bandValue)
            || !QueryParsing.TryEnum<ProductSort>(sort, out var sortValue))
            return StoreResults.BadQuery();

        var colors = await palette.GetColorsAsync(apiContext.TenantId, cancellationToken);
        if (colors is not { } tones)
            return ApiResults.Problem(StatusCodes.Status404NotFound, ErrorCodes.PaletteNotFound);

        var settings = options.CurrentValue;
        var pageSize = Math.Clamp(limit ?? settings.PageSize, 1, settings.MaxPageSize);
        var segment = await repository.UserSegmentAsync(apiContext.TenantId, cancellationToken);
        var query = new CatalogQuery(categoryValue, PriceBand: bandValue, Sort: sortValue ?? ProductSort.Newest, Segment: segment);
        var matching = (await catalog.GetProductsAsync(cancellationToken)).Where(p => CatalogRules.MatchesPalette(p, tones.Flattering, tones.Avoid));
        var page = CatalogRules.Query(matching, query, pageToken, pageSize);

        var items = new List<ProductDto>(page.Items.Count);
        foreach (var product in page.Items)
            items.Add(await catalog.ToDtoAsync(product, cancellationToken));
        return Results.Ok(new GetPagedResponse<ProductDto>(items, page.PageToken, page.Total));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/tenant/palette/products", Handler)
            .Produces<GetPagedResponse<ProductDto>>(StatusCodes.Status200OK)
            .Problems(StatusCodes.Status400BadRequest, StatusCodes.Status404NotFound)
            .Tenant("Tenant Palette", "Catalog products that suit my palette", "Paletime uygun urunler: catalog products with at least one of my flattering colours whose main colour is not one to avoid (rule based, no AI). Filters: category, priceBand; sort = newest (default) | priceAsc | priceDesc; cursor paging with pageToken. 404 palette_not_found until a palette exists.");
    }
}
