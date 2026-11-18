using System.Text.Json;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Infrastructure.Services.Purchases;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.StoreNotifications;

public class PostGoogle : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] JsonElement body,
        HttpRequest httpRequest,
        [FromServices] IPubSubPushVerifier pushVerifier,
        [FromServices] IStoreSyncService store,
        CancellationToken cancellationToken)
    {
        // Pub/Sub push with authentication: a Google-signed OIDC token for our audience and service account.
        if (!pushVerifier.IsConfigured)
            return ApiResults.Problem(StatusCodes.Status503ServiceUnavailable, ErrorCodes.ProviderNotConfigured);
        if (!await pushVerifier.VerifyAsync(httpRequest.Headers.Authorization.ToString(), cancellationToken))
            return ApiResults.Problem(StatusCodes.Status401Unauthorized, StoreNotificationCodes.InvalidPushToken);

        if (body.ValueKind != JsonValueKind.Object || PubSubEnvelope.Parse(body) is not { } message)
            return ApiResults.Problem(StatusCodes.Status400BadRequest, StoreNotificationCodes.InvalidNotification);

        // Non-2xx makes Pub/Sub redeliver: used while the Play Developer API cannot be read yet.
        return await store.HandleGoogleAsync(message.MessageId, message.Data, cancellationToken) switch
        {
            StoreNotificationOutcome.Invalid => ApiResults.Problem(StatusCodes.Status400BadRequest, StoreNotificationCodes.InvalidNotification),
            StoreNotificationOutcome.NotConfigured => ApiResults.Problem(StatusCodes.Status503ServiceUnavailable, ErrorCodes.ProviderNotConfigured),
            _ => Results.NoContent(),
        };
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/store/google/notifications", Handler)
            .Produces(StatusCodes.Status204NoContent)
            .Produces<ProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<ProblemDetails>(StatusCodes.Status401Unauthorized)
            .Produces<ProblemDetails>(StatusCodes.Status503ServiceUnavailable)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .AllowAnonymous()
            .WithSummary("Google Play Real-time developer notifications (Pub/Sub push)")
            .WithDescription("Pub/Sub push envelope { message: { data (base64 RTDN), messageId }, subscription }. Authorization: Bearer <Google OIDC token> " +
                             "with aud = Store:GooglePubSubAudience and email = Store:GooglePubSubServiceAccount. The purchase is re-read from the Play Developer API " +
                             "(subscriptionsv2 / products); voided purchases end access or remove the pack's remaining credits. Deduplicated by messageId.")
            .WithTags("Store Notifications");
    }
}
