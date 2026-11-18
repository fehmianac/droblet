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

public class Delete : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string deviceId,
        [FromServices] IApiContext apiContext,
        [FromServices] ISettingsService settings,
        CancellationToken cancellationToken)
    {

        if (!DeviceRules.IsValidId(deviceId))
            return StoreResults.BadQuery();

        await settings.RemoveDeviceAsync(apiContext.TenantId, deviceId, cancellationToken);
        return Results.NoContent();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapDelete("v1/tenant/user/me/device/{deviceId}", Handler)
            .Produces(StatusCodes.Status204NoContent)
            .Produces<ProblemDetails>(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Remove a device")
            .WithDescription("Idempotent. Sign-out also removes the device.")
            .WithTags("Tenant Settings");
    }
}
