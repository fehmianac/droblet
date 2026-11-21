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

public class PostComplete : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] CompleteLookRequest request,
        [FromServices] IValidator<CompleteLookRequest> validator,
        [FromServices] IApiContext apiContext,
        [FromServices] ICatalogService catalog,
        [FromServices] IWardrobeMatcher matcher,
        [FromServices] IRepository repository,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        var segment = await repository.UserSegmentAsync(apiContext.TenantId, cancellationToken);
        var segmentProducts = CatalogRules.ForSegment(await catalog.GetProductsAsync(cancellationToken), segment).ToList();
        var suggestions = await matcher.CompleteAsync(apiContext.TenantId, request.ItemIds ?? [], segmentProducts,
            request.PriceBand, request.Size, perSlot: 6, cancellationToken);

        var slots = new List<CompleteSlotDto>(suggestions.Count);
        foreach (var suggestion in suggestions)
        {
            var products = new List<ProductDto>(suggestion.Products.Count);
            foreach (var product in suggestion.Products)
                products.Add(await catalog.ToDtoAsync(product, cancellationToken));
            slots.Add(new CompleteSlotDto(suggestion.Slot, products));
        }
        return Results.Ok(new CompleteLookDto(slots));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/tenant/catalog/complete", Handler)
            .Produces<CompleteLookDto>(StatusCodes.Status200OK)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Complete my piece(s)")
            .WithDescription("\"Parçamı tamamla\": products for the outfit slots the selected wardrobe items leave empty, optionally in a price band and size. Synchronous and rule based; costs no credit.")
            .WithTags("Tenant Catalog");
    }
}
