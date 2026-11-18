using Api.Infrastructure.Contract;
using Domain.Constant;
using Domain.Context;
using Domain.Domain;
using Domain.Services;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.Photo;

public class Get : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromServices] IApiContext apiContext,
        [FromServices] IPhotoService photoService,
        CancellationToken cancellationToken)
    {
        var photos = await photoService.GetActiveAsync(apiContext.TenantId, cancellationToken);
        return Results.Ok(photos.ToDto());
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/tenant/photo", Handler)
            .Produces<PhotosDto>(StatusCodes.Status200OK)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Get my body and face photos")
            .WithDescription("Metadata + short-lived presigned GET URL per photo (owner only). null when not uploaded.")
            .WithTags("Tenant Photo");
    }
}
