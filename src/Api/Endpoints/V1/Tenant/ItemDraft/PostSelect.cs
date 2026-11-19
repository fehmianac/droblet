using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Context;
using Domain.Domain;
using Domain.Services;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.ItemDraft;

public class PostSelect : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromBody] SelectDraftsCommand request,
        [FromServices] IApiContext apiContext,
        [FromServices] IWardrobeService wardrobe,
        [FromServices] IValidator<SelectDraftsCommand> validator,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        return (await wardrobe.SelectDraftsAsync(apiContext.TenantId, id, request, cancellationToken)).ToHttp("/v1/tenant/item-draft");
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/tenant/item-draft/{id}/select", Handler)
            .Produces<StartDraftsDto>(StatusCodes.Status202Accepted)
            .Validated()
            .Problems(StatusCodes.Status403Forbidden, StatusCodes.Status404NotFound, StatusCodes.Status409Conflict, StatusCodes.Status422UnprocessableEntity)
            .Tenant("Tenant ItemDraft", "Choose the pieces of a draft group to keep",
                "\"N parçayı ekle\" after a multi-item photo: draftIds = the detected pieces (kind piece, parentDraftId = {id}) to keep. Each kept piece goes to " +
                "processing with one background-removal job (kind itemClean, never counted against the recognition allowance); every other detected piece " +
                "of the group is discarded with its crop. edits = the user's values for pieces edited before selecting (replace the suggestion; edited = reviewed). " +
                "Idempotent. 202 = the kept pieces + their jobs. 404 draft_not_found · 409 draft_not_group (not a ready group) · 422 draft_not_in_group.");
    }
}
