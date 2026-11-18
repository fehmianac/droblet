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

namespace Api.Endpoints.V1.Tenant.Catalog;

public class GetProductMatch : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromServices] IApiContext apiContext,
        [FromServices] ICatalogService catalog,
        [FromServices] IWardrobeMatcher matcher,
        CancellationToken cancellationToken)
    {

        var product = await catalog.GetProductAsync(id, cancellationToken);
        if (product is null)
            return StoreResults.NotFound(StoreSocialErrorCodes.ProductNotFound);

        var match = await matcher.MatchProductAsync(apiContext.TenantId, product, cancellationToken);
        return Results.Ok(new ProductMatchDto(id, match.CompatibleItems.Count, match.CompatibleItems.Select(i => i.ToDto()).ToList()));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/tenant/catalog/product/{id}/match", Handler)
            .Produces<ProductMatchDto>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Wardrobe pieces compatible with a product")
            .WithDescription("\"Gardırobundaki N parçayla uyumlu\": rule based (different outfit slot + harmonising colours) over the caller's own wardrobe.")
            .WithTags("Tenant Catalog");
    }
}
