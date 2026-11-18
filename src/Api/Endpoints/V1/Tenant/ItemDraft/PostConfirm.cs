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

namespace Api.Endpoints.V1.Tenant.ItemDraft;

public class PostConfirm : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] ConfirmDraftsCommand request,
        [FromServices] IApiContext apiContext,
        [FromServices] IWardrobeService wardrobe,
        [FromServices] IValidator<ConfirmDraftsCommand> validator,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        return Results.Ok(await wardrobe.ConfirmDraftsAsync(apiContext.TenantId, request.Items, cancellationToken));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/tenant/item-draft/confirm", Handler)
            .Produces<ItemCreateResultsDto>(StatusCodes.Status200OK)
            .Validated()
            .Tenant("Tenant ItemDraft", "Confirm drafts into wardrobe items", "Up to 30 drafts with the user final values (category, >= 1 colour, >= 1 season). A draft flagged needsReview requires reviewed = true. One result per draft; idempotent by clientMutationId.");
    }
}
