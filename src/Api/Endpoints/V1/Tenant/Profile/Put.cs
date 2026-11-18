using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Context;
using Domain.Domain;
using Domain.Entity;
using Domain.Manager;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.Profile;

public class Put : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] UpdateProfileRequest request,
        [FromServices] IApiContext apiContext,
        [FromServices] IRepository repository,
        [FromServices] IValidator<UpdateProfileRequest> validator,
        [FromServices] TimeProvider timeProvider,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        var user = await repository.GetAsync<UserEntity>(UserEntity.GetPk(), UserEntity.GetSk(apiContext.UserId), cancellationToken);
        var tenant = await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(apiContext.TenantId), cancellationToken);
        if (tenant is null)
            return Results.NotFound();
        if (tenant.Version != request.BaseVersion)
            return Results.Conflict(tenant.ToDto(user?.Email));

        tenant.DisplayName = request.DisplayName.Trim();
        tenant.Language = request.Language;
        tenant.CityId = string.IsNullOrWhiteSpace(request.CityId) ? null : request.CityId;
        tenant.UpdatedAt = timeProvider.GetUtcNow().UtcDateTime;

        if (!await repository.SaveIfVersionAsync(tenant, request.BaseVersion, cancellationToken))
        {
            var current = await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(apiContext.TenantId), cancellationToken);
            return current is null ? Results.NotFound() : Results.Conflict(current.ToDto(user?.Email));
        }

        return Results.Ok(tenant.ToDto(user?.Email));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPut("v1/tenant/profile", Handler)
            .Produces<ProfileDto>(StatusCodes.Status200OK)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status404NotFound)
            .Produces<ProfileDto>(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Update profile")
            .WithDescription("Versioned: baseVersion must match, otherwise 409 with the current profile. Handle and visibility have their own endpoints.")
            .WithTags("Tenant Profile");
    }
}

public record UpdateProfileRequest(string DisplayName, string Language, string? CityId, long BaseVersion);

public class UpdateProfileRequestValidator : AbstractValidator<UpdateProfileRequest>
{
    // Languages come from the Localization config list (tr, en today) — adding one is a config + data change.
    public UpdateProfileRequestValidator(Microsoft.Extensions.Options.IOptionsMonitor<Domain.Options.LocalizationOptions> localization)
    {
        RuleFor(x => x.DisplayName).NotEmpty().WithErrorCode("name_required").MaximumLength(60).WithErrorCode("name_too_long");
        RuleFor(x => x.Language).Must(l => localization.CurrentValue.IsSupported(l)).WithErrorCode("language_unsupported");
        RuleFor(x => x.CityId).MaximumLength(64).WithErrorCode("city_invalid");
        RuleFor(x => x.BaseVersion).GreaterThanOrEqualTo(0).WithErrorCode("base_version_invalid");
    }
}
