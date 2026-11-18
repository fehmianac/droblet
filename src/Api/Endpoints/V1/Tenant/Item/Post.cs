using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Context;
using Domain.Domain;
using Domain.Services;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.Item;

public class Post : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] CreateItemCommand request,
        [FromServices] IApiContext apiContext,
        [FromServices] IWardrobeService wardrobe,
        [FromServices] IValidator<CreateItemCommand> validator,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        var result = await wardrobe.CreateItemAsync(apiContext.TenantId, request, cancellationToken);
        return result.Outcome switch
        {
            ItemCreateOutcome.Created => Results.Created($"/v1/tenant/item/{result.Item!.Id}", result),
            ItemCreateOutcome.AlreadyApplied => Results.Ok(result),
            _ => ApiResults.Problem(result.Code == ErrorCodes.PremiumRequired ? StatusCodes.Status403Forbidden : StatusCodes.Status422UnprocessableEntity, result.Code ?? ErrorCodes.ValidationFailed),
        };
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/tenant/item", Handler)
            .Produces<ItemCreateResultDto>(StatusCodes.Status200OK)
            .Produces<ItemCreateResultDto>(StatusCodes.Status201Created)
            .Problems(StatusCodes.Status403Forbidden, StatusCodes.Status422UnprocessableEntity)
            .Validated()
            .Tenant("Tenant Item", "Add a piece without a photo", "Manual entry (no photo, no AI): category, at least one colour and at least one season are required; subcategory, free-text fabric and colour \"other\" + colorHex are kept. Creates an item with source = manual and no image. Idempotent by clientMutationId (201 created, 200 replay).");
    }
}
