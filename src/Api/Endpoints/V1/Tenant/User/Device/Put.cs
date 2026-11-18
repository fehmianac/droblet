using System.Text.Json;
using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Context;
using Domain.Domain;
using Domain.Entity;
using Domain.Enum;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Domain.Validation;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace Api.Endpoints.V1.Tenant.User.Device;

public class Put : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] RegisterDeviceRequest request,
        [FromServices] IValidator<RegisterDeviceRequest> validator,
        [FromServices] IApiContext apiContext,
        [FromServices] ISettingsService settings,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        var (outcome, device) = await settings.RegisterDeviceAsync(apiContext.TenantId, apiContext.UserId, request.DeviceId, request.Platform,
            request.PushToken, request.PushTokenType, request.TimeZone, cancellationToken);
        return outcome == SettingsOutcome.LimitReached
            ? ApiResults.Problem(StatusCodes.Status422UnprocessableEntity, StoreSocialErrorCodes.DeviceLimitReached)
            : Results.Ok(device);
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPut("v1/tenant/user/me/device", Handler)
            .Produces<DeviceDto>(StatusCodes.Status200OK)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<ProblemDetails>(StatusCodes.Status422UnprocessableEntity)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Register / refresh a device")
            .WithDescription("platform = ios | android; pushToken = the device push token (null when push permission is not granted); pushTokenType = fcm (Android FCM registration token) | apns (iOS APNs device token, hex) — inferred from platform + token when omitted. Notifier sends apns tokens through APNs and fcm tokens through FCM. The first registration with a token creates notification preferences with the three types on.")
            .WithTags("Tenant Settings");
    }
}
