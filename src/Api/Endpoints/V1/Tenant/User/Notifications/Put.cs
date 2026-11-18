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

namespace Api.Endpoints.V1.Tenant.User.Notifications;

public class Put : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] UpdateNotificationPrefsRequest request,
        [FromServices] IValidator<UpdateNotificationPrefsRequest> validator,
        [FromServices] IApiContext apiContext,
        [FromServices] ISettingsService settings,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        var (outcome, prefs) = await settings.SetNotificationPrefsAsync(apiContext.TenantId, apiContext.UserId, request.ToInput(), cancellationToken);
        return outcome == SettingsOutcome.Conflict ? Results.Conflict(prefs) : Results.Ok(prefs);
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPut("v1/tenant/user/me/notifications", Handler)
            .Produces<NotificationPrefsDto>(StatusCodes.Status200OK)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<NotificationPrefsDto>(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Update notification preferences")
            .WithDescription("morningOutfitLocalTime = HH:mm on a quarter hour, in the user's local time; timeZone = IANA id. Versioned (baseVersion 0 for the first save): 409 with the current preferences.")
            .WithTags("Tenant Settings");
    }
}
