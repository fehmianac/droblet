using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Context;
using Domain.Domain;
using Domain.Enum;
using Domain.Services;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.Item;

public class PostFromLibrary : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] AddLibraryItemsCommand request,
        [FromServices] IApiContext apiContext,
        [FromServices] IWardrobeService wardrobe,
        [FromServices] IValidator<AddLibraryItemsCommand> validator,
        HttpContext httpContext,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        return Results.Ok(await wardrobe.AddFromLibraryAsync(apiContext.TenantId, request.Items, httpContext.RequestLanguage(), cancellationToken));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/tenant/item/from-library", Handler)
            .Produces<ItemCreateResultsDto>(StatusCodes.Status200OK)
            .Validated()
            .Tenant("Tenant Item", "Add pieces from the ready library", "Adds up to 30 library pieces without a photo. One result per row (created | alreadyApplied | rejected); idempotent by clientMutationId.");
    }
}
