using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Context;
using Domain.Domain;
using Domain.Manager;
using Domain.Services;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Catalog.Color;

public class GetAll : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromServices] ICatalogService catalog,
        [FromServices] IApiContext apiContext,
        [FromServices] IRepository repository,
        HttpContext httpContext,
        CancellationToken cancellationToken)
    {
        var segment = await repository.UserSegmentAsync(apiContext.TenantId, cancellationToken);
        return Results.Ok(CatalogRules.ColorFacets(await catalog.GetProductsAsync(cancellationToken), segment, httpContext.RequestLanguage()));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/catalog/color", Handler)
            .Produces<List<CatalogColorDto>>(StatusCodes.Status200OK)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Colours in the catalog")
            .WithDescription("The colours the user's products actually come in (their segment and unisex, retired left out), most products first. Feeds the colour filter, so a new colour in the catalog appears without an app release. name is in the request language.")
            .WithTags("Catalog");
    }
}
