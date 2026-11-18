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
        CancellationToken cancellationToken)
    {
        if (!PhotoKindRoute.TryParse(kind, out var photoKind))
            return ApiResults.Problem(StatusCodes.Status404NotFound, ErrorCodes.NotFound);

        return await photoService.DeleteAsync(apiContext.TenantId, photoKind, photoId, cancellationToken)
            ? Results.NoContent()
            : ApiResults.Problem(StatusCodes.Status404NotFound, ErrorCodes.NotFound);
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
            .WithDescription("Screen 29: removes the active photo of one kind. Body: the try-on images generated with it go too. Face: the palette result goes too. 404 not_found when photoId is not the active photo of that kind.")
            .WithTags("Tenant Photo");
    }
}
