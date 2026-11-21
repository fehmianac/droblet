using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Context;
using Domain.Domain;
using Domain.Entity;
using Domain.Enum;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.Extensions.Options;

namespace Api.Endpoints.V1.Tenant.Profile;

/// <summary>
/// The age step after the first Apple / Google sign-in (e-mail sign-up asks on the form) — docs/api/teen.md §3. Body
/// { birthYear, birthMonth? }; an empty body is the old "18 yaşından büyüğüm" confirmation (transition). Once: when the age
/// is already set the profile comes back unchanged. Under 16 → the account the provider sign-in created is deleted.
/// </summary>
public class PostAgeConfirmation : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] AgeConfirmationRequest? request,
        [FromServices] IApiContext apiContext,
        [FromServices] IAvatarService avatars,
        [FromServices] IRepository repository,
        [FromServices] ITeenService teens,
        [FromServices] IAccountDeletionService deletion,
        [FromServices] IOptionsMonitor<TeenOptions> teenOptions,
        [FromServices] TimeProvider timeProvider,
        CancellationToken cancellationToken)
    {
        var user = await repository.GetAsync<UserEntity>(UserEntity.GetPk(), UserEntity.GetSk(apiContext.UserId), cancellationToken);
        var tenant = await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(apiContext.TenantId), cancellationToken);
        if (user is null || tenant is null)
            return Results.NotFound();

        if (user.AgeConfirmedAt is null)
        {
            var now = timeProvider.GetUtcNow().UtcDateTime;
            var age = AgeStep.Evaluate(request?.BirthYear, request?.BirthMonth, legacyAdultConfirmed: request?.BirthYear is null, teenOptions.CurrentValue,
                DateOnly.FromDateTime(now));
            if (age.UnderMinimum)
            {
                // Nothing of a child under 16 is kept: the account the provider sign-in just created goes.
                await deletion.DeleteAccountAsync(user.Id, user.TenantId, cancellationToken);
                return TeenGuard.Problem(StatusCodes.Status422UnprocessableEntity, Domain.Constant.ErrorCodes.AgeUnderMinimum, "accountDeleted", true);
            }
            if (age.Problem is not null)
                return age.Problem;

            if (age.Age is { Band: AgeBand.Teen, BirthYear: { } year })
            {
                await teens.BecomeTeenAsync(user, year, age.Age.BirthMonth, cancellationToken);
                tenant = await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(apiContext.TenantId), cancellationToken) ?? tenant;
            }
            else
            {
                user.AgeConfirmedAt = now;
                user.AgeBand = AgeBand.Adult;
                await repository.SaveAsync(user, cancellationToken);
            }
        }

        return Results.Ok(await tenant.ToProfileDtoAsync(user, avatars, teens, cancellationToken));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPost("v1/tenant/profile/age-confirmation", Handler)
            .Produces<ProfileDto>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status404NotFound)
            .Produces<ProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<ProblemDetails>(StatusCodes.Status422UnprocessableEntity)
            .Tenant("Tenant Profile", "Confirm my age (Apple / Google sign-in)",
                "The age step after the first Apple / Google sign-in (docs/api/teen.md §3). Body { birthYear, birthMonth? } → adult, or teen in " +
                "pendingParentalConsent (422 teen_not_available while Teen:Enabled is off; 422 birth_month_required when the year is ambiguous). " +
                "Under 16: the new account is deleted and 422 age_under_minimum with accountDeleted: true. An empty body is the old 18+ confirmation " +
                "(Teen:LegacyAgeCheckbox). Once only: when ageConfirmedAt is already set the profile is returned unchanged.");
}

public record AgeConfirmationRequest(int? BirthYear = null, int? BirthMonth = null);
