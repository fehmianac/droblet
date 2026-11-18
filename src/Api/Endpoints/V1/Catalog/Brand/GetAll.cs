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

namespace Api.Endpoints.V1.Catalog.Brand;

public class GetAll : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromServices] ICatalogService catalog,
        CancellationToken cancellationToken)
    {

        var brands = await catalog.GetBrandsAsync(cancellationToken);
        return Results.Ok(brands.Where(b => !b.Retired).OrderBy(b => b.Name, StringComparer.OrdinalIgnoreCase).Select(b => b.ToDto()).ToList());
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/catalog/brand", Handler)
            .Produces<List<BrandDto>>(StatusCodes.Status200OK)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Brands")
            .WithDescription("Active brands for the brand filter.")
            .WithTags("Catalog");
    }
}
