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

namespace Api.Endpoints.V1.Tenant.Profile;

public class PutVisibility : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] UpdateVisibilityRequest request,
        [FromServices] IValidator<UpdateVisibilityRequest> validator,
        [FromServices] IApiContext apiContext,
        [FromServices] IRepository repository,
        [FromServices] ISettingsService settings,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        var (outcome, tenant) = await settings.SetVisibilityAsync(apiContext.TenantId, request.ClosetVisibility, request.BaseVersion, cancellationToken);
        if (tenant is null)
            return Results.NotFound();

        var user = await repository.GetAsync<UserEntity>(UserEntity.GetPk(), UserEntity.GetSk(apiContext.UserId), cancellationToken);
        return outcome == SettingsOutcome.Conflict ? Results.Conflict(tenant.ToDto(user?.Email)) : Results.Ok(tenant.ToDto(user?.Email));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPut("v1/tenant/profile/visibility", Handler)
            .Produces<ProfileDto>(StatusCodes.Status200OK)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status404NotFound)
            .Produces<ProfileDto>(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Change closet visibility")
            .WithDescription("closetVisibility = public | followersOnly | private (default private until A-6). Versioned: baseVersion must match, otherwise 409 with the current profile. Takes effect immediately; discovery index updated in the same transaction. Available in every plan.")
            .WithTags("Tenant Profile");
    }
}
