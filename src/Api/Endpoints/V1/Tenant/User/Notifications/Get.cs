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

public class Get : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromServices] IApiContext apiContext,
        [FromServices] ISettingsService settings,
        CancellationToken cancellationToken)
    {

        return Results.Ok(await settings.GetNotificationPrefsAsync(apiContext.TenantId, apiContext.UserId, cancellationToken));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/tenant/user/me/notifications", Handler)
            .Produces<NotificationPrefsDto>(StatusCodes.Status200OK)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Notification preferences")
            .WithDescription("The three switches of screen 29, the morning time (local HH:mm) and time zone. version 0 = never saved (everything off).")
            .WithTags("Tenant Settings");
    }
}
