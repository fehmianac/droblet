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

namespace Api.Endpoints.V1.Tenant.Settings;

public class Get : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromServices] IApiContext apiContext,
        [FromServices] ISettingsService settings,
        CancellationToken cancellationToken)
    {

        var result = await settings.GetSettingsAsync(apiContext.TenantId, apiContext.UserId, cancellationToken);
        return result is null ? Results.NotFound() : Results.Ok(result);
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/tenant/settings", Handler)
            .Produces<SettingsDto>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Settings (screen 29) in one call")
            .WithDescription("Closet visibility, language, city, notification preferences and registered devices. Language and city are changed with PUT v1/tenant/profile.")
            .WithTags("Tenant Settings");
    }
}
