using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Infrastructure.Services.Purchases;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.StoreNotifications;

public class PostApple : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] AppleNotificationRequest request,
        [FromServices] IStoreSyncService store,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.SignedPayload) || request.SignedPayload.Length > 200_000)
            return ApiResults.Problem(StatusCodes.Status400BadRequest, ErrorCodes.ValidationFailed);

        // Apple retries anything but 200, so only a payload that fails verification is refused.
        return await store.HandleAppleAsync(request.SignedPayload, cancellationToken) == StoreNotificationOutcome.Invalid
            ? ApiResults.Problem(StatusCodes.Status400BadRequest, StoreNotificationCodes.InvalidNotification)
            : Results.Ok();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/store/apple/notifications", Handler)
            .Produces(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .AllowAnonymous()
            .WithSummary("App Store Server Notifications v2")
            .WithDescription("Body { signedPayload }: JWS verified against Apple Root CA - G3 (x5c chain + Apple OIDs + ES256), bundle id and environment checked, " +
                             "deduplicated by notificationUUID. Renew / expire / grace period / billing retry / upgrade / downgrade apply the signed transaction + renewal info; " +
                             "REFUND / REVOKE end access (consumables: the pack's remaining credits are removed, never below zero). Set the same URL for Sandbox and Production in App Store Connect.")
            .WithTags("Store Notifications");
    }
}

public record AppleNotificationRequest(string? SignedPayload);

public static class StoreNotificationCodes
{
    public const string InvalidNotification = "invalid_notification";
    public const string InvalidPushToken = "invalid_push_token";
}
