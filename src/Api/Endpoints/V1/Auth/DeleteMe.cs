using Api.Infrastructure.Contract;
using Domain.Constant;
using Domain.Context;
using Domain.Services;
using Infrastructure.Services;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Auth;

public class DeleteMe : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromServices] IApiContext apiContext,
        [FromServices] IAccountDeletionService deletionService,
        [FromServices] IAppleSignInTokenService appleTokens,
        CancellationToken cancellationToken)
    {
        // Sign in with Apple: revoke the user's Apple tokens first (App Store guideline 5.1.1(v)); while the
        // AppleAuth key is CHANGE_ME this only logs and deletion continues.
        await appleTokens.RevokeForUserAsync(apiContext.UserId, cancellationToken);
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
            .WithDescription("Revokes the user's Sign in with Apple token at Apple (when the AppleAuth key is configured), then deletes the user, the tenant, every tenant partition and the tenant's S3 prefixes. " +
                             "An active store subscription is not cancelled — the app tells the user; a later purchase restore can link it to a new account.")
            .WithTags("Auth");
    }
}
