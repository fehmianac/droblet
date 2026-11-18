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

namespace Api.Endpoints.V1.Admin.Brand;

public class GetAll : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromServices] ICatalogService catalog,
        CancellationToken cancellationToken)
    {

        var brands = await catalog.GetBrandsAsync(cancellationToken);
        return Results.Ok(brands.OrderBy(b => b.Id, StringComparer.Ordinal).Select(b => b.ToAdminDto()).ToList());
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/admin/brand", Handler)
            .Produces<List<AdminBrandDto>>(StatusCodes.Status200OK)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAdmin(AdminPermissions.CatalogManage)
            .WithSummary("Brands (admin)")
            .WithDescription("Every brand, retired included.")
            .WithTags("Admin Catalog");
    }
}
