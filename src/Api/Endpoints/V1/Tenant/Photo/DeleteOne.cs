using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Context;
using Domain.Services;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.Photo;

public class DeleteOne : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string kind,
        [FromRoute] string photoId,
        [FromServices] IApiContext apiContext,
        [FromServices] IPhotoService photoService,
        [FromServices] IConsentService consents,
        CancellationToken cancellationToken)
    {
        if (!PhotoKindRoute.TryParse(kind, out var photoKind))
            return ApiResults.Problem(StatusCodes.Status404NotFound, ErrorCodes.NotFound);

        if (!await photoService.DeleteAsync(apiContext.TenantId, photoKind, photoId, cancellationToken))
            return ApiResults.Problem(StatusCodes.Status404NotFound, ErrorCodes.NotFound);

        // Legal text (consents, "withdrawing"): deleting the photo counts as withdrawing its consent.
        var consent = photoKind == Domain.Enum.PhotoKind.Body ? Domain.Enum.ConsentType.BodyPhotoAi : Domain.Enum.ConsentType.FacePhotoPalette;
        await consents.WithdrawAsync(apiContext.TenantId, apiContext.UserId, consent, "photo_deleted", cancellationToken);
        // The face photo also carries the face try-on consent (consent 7).
        if (photoKind == Domain.Enum.PhotoKind.Face)
            await consents.WithdrawAsync(apiContext.TenantId, apiContext.UserId, Domain.Enum.ConsentType.FacePhotoTryOn, "photo_deleted", cancellationToken);
        return Results.NoContent();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapDelete("v1/tenant/photo/{kind}/{photoId}", Handler)
            .Produces(StatusCodes.Status204NoContent)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Delete my body or face photo")
            .WithDescription("Screen 29: removes the active photo of one kind. Body: the try-on images generated with it go too. Face: the palette result goes too. Records the withdrawal of that kind's consent (bodyPhotoAi / facePhotoPalette). 404 not_found when photoId is not the active photo of that kind.")
            .WithTags("Tenant Photo");
    }
}
