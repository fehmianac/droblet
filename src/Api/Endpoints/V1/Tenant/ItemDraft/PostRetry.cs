using Api.Contracts;
using Api.Infrastructure.Contract;
using Domain.Context;
using Domain.Domain;
using Domain.Services;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.ItemDraft;

public class PostRetry : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromServices] IApiContext apiContext,
        [FromServices] IWardrobeService wardrobe,
        HttpContext httpContext,
        CancellationToken cancellationToken)
    {
        return (await wardrobe.RetryDraftAsync(apiContext.TenantId, id, httpContext.RequestLanguage(), cancellationToken)).ToHttp("/v1/tenant/item-draft");
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/tenant/item-draft/{id}/retry", Handler)
            .Produces<StartDraftsDto>(StatusCodes.Status202Accepted)
            .Problems(StatusCodes.Status402PaymentRequired, StatusCodes.Status403Forbidden, StatusCodes.Status404NotFound, StatusCodes.Status409Conflict, StatusCodes.Status422UnprocessableEntity)
            .Tenant("Tenant ItemDraft", "Retry AI processing of a failed draft", "Queues a new ItemProcessor job for a failed draft on the photo it already has (no new upload). Same body as POST item-draft with one draft and one job. Only failed drafts: 409 draft_not_failed otherwise. The recognition allowance applies as for a new photo: 402 item_recognition_limit_reached (limit 0 -> 403 premium_required). 422 upload_missing when the photo is gone.");
    }
}
