using Api.Contracts;
using Api.Infrastructure.Contract;
using Domain.Context;
using Domain.Domain;
using Domain.Entity;
using Domain.Manager;
using Domain.Services;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.Profile;

/// <summary>
/// "18 yaşından büyüğüm" after the first Apple / Google sign-in (e-mail sign-up ticks it on the form). Idempotent: the first
/// confirmation time is kept.
/// </summary>
public class PostAgeConfirmation : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromServices] IApiContext apiContext,
        [FromServices] IAvatarService avatars,
        [FromServices] IRepository repository,
        [FromServices] TimeProvider timeProvider,
        CancellationToken cancellationToken)
    {
        var user = await repository.GetAsync<UserEntity>(UserEntity.GetPk(), UserEntity.GetSk(apiContext.UserId), cancellationToken);
        var tenant = await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(apiContext.TenantId), cancellationToken);
        if (user is null || tenant is null)
            return Results.NotFound();

        if (user.AgeConfirmedAt is null)
        {
            user.AgeConfirmedAt = timeProvider.GetUtcNow().UtcDateTime;
            await repository.SaveAsync(user, cancellationToken);
        }

        return Results.Ok(await tenant.ToProfileDtoAsync(user, avatars, cancellationToken));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPost("v1/tenant/profile/age-confirmation", Handler)
            .Produces<ProfileDto>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status404NotFound)
            .Tenant("Tenant Profile", "Confirm I am 18 or older",
                "One-time confirmation after the first Apple / Google sign-in (Terms §3). Stores ageConfirmedAt on the account (kept when already set) " +
                "and returns the profile. Until it is set the app shows the confirmation before anything else.");
}
