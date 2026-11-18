using Api.Infrastructure.Contract;
using Domain.Constant;
using Domain.Context;
using Domain.Services;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.Photo;

public class Delete : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromServices] IApiContext apiContext,
        [FromServices] IPhotoService photoService,
        CancellationToken cancellationToken)
    {
        await photoService.DeleteAllAsync(apiContext.TenantId, cancellationToken);
        return Results.NoContent();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapDelete("v1/tenant/photo", Handler)
            .Produces(StatusCodes.Status204NoContent)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Delete my photos and generated images")
            .WithDescription("Screen 29: body + face photos, every try-on image and the palette result. Wardrobe, looks and the account stay.")
            .WithTags("Tenant Photo");
    }
}
