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

public class GetPaged : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromQuery] string? brand,
        [FromQuery] string? q,
        [FromQuery] bool? includeRetired,
        [FromQuery] string? pageToken,
        [FromQuery] int? limit,
        [FromServices] ICatalogService catalog,
        CancellationToken cancellationToken)
    {

        var text = CatalogRules.NormalizeText(q);
        var products = (await catalog.GetProductsAsync(cancellationToken))
            .Where(p => includeRetired != false || !p.Retired)
            .Where(p => string.IsNullOrEmpty(brand) || p.BrandId == brand)
            .Where(p => text.Length == 0 || CatalogRules.NormalizeText($"{p.Id} {string.Join(' ', p.Name.Values)}").Contains(text, StringComparison.Ordinal));

        var page = CatalogRules.Page(CatalogRules.Sort(products, ProductSort.Newest), pageToken, Math.Clamp(limit ?? 50, 1, 200));
        return Results.Ok(new GetPagedResponse<AdminProductDto>(page.Items.Select(p => p.ToAdminDto()).ToList(), page.PageToken, page.Total));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/admin/product", Handler)
            .Produces<GetPagedResponse<AdminProductDto>>(StatusCodes.Status200OK)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAdmin(AdminPermissions.CatalogManage)
            .WithSummary("Products (admin, paged)")
            .WithDescription("Newest first, retired included unless includeRetired=false. Filters: brand, q (id or any-language name).")
            .WithTags("Admin Catalog");
    }
}
