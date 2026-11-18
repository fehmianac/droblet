using Api.Infrastructure.Contract;
using Domain.Constant;
using Domain.Context;
using Domain.Services;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Auth;

public class DeleteMe : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromServices] IApiContext apiContext,
        [FromServices] IAccountDeletionService deletionService,
        CancellationToken cancellationToken)
    {
        await deletionService.DeleteAccountAsync(apiContext.UserId, apiContext.TenantId, cancellationToken);
        return Results.NoContent();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapDelete("v1/auth/me", Handler)
            .Produces(StatusCodes.Status204NoContent)
            .Produces(StatusCodes.Status401Unauthorized)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Delete my account")
            .WithDescription("Deletes the user, the tenant, every tenant partition and the tenant's S3 prefixes. An active store subscription is not cancelled — the app tells the user.")
            .WithTags("Auth");
    }
}
