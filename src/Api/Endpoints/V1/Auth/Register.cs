using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Services;
using FluentValidation;
using Domain.Options;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace Api.Endpoints.V1.Auth;

public class Register : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] RegisterRequest request,
        [FromServices] IAuthService authService,
        [FromServices] IValidator<RegisterRequest> validator,
        [FromServices] IOptionsMonitor<TeenOptions> teen,
        [FromServices] TimeProvider timeProvider,
        HttpContext httpContext,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        // Birth year (+ month when ambiguous) → age band; old clients' 18+ box during the transition (docs/api/teen.md §3).
        var age = AgeStep.Evaluate(request.BirthYear, request.BirthMonth, request.AgeConfirmed, teen.CurrentValue,
            DateOnly.FromDateTime(timeProvider.GetUtcNow().UtcDateTime));
        if (age.Problem is not null)
            return age.Problem;

        var result = await authService.RegisterAsync(request.Name, request.Email, request.Password, httpContext.Language(), httpContext.ClientIp(), cancellationToken, age.Age);
        return result.Outcome switch
        {
            AuthOutcome.Success => Results.Created("/v1/tenant/profile", AuthResponse.From(result.Tokens!)),
            AuthOutcome.EmailTaken => ApiResults.Problem(StatusCodes.Status409Conflict, ErrorCodes.EmailTaken),
            AuthOutcome.TooManyAttempts => ApiResults.Problem(StatusCodes.Status429TooManyRequests, ErrorCodes.TooManyAttempts),
            _ => ApiResults.Problem(StatusCodes.Status400BadRequest, ErrorCodes.ValidationFailed),
        };
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/auth/register", Handler)
            .Produces<AuthResponse>(StatusCodes.Status201Created)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<ProblemDetails>(StatusCodes.Status409Conflict)
            .Produces<ProblemDetails>(StatusCodes.Status422UnprocessableEntity)
            .Produces<ProblemDetails>(StatusCodes.Status429TooManyRequests)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .AllowAnonymous()
            .WithSummary("Register with e-mail and password")
            .WithDescription("Creates the user and their personal tenant, returns a JWT + refresh token. Age (docs/api/teen.md §3): birthYear (+ birthMonth when " +
                             "the year is ambiguous: 422 birth_month_required) → 18+ adult; 16–17 teen in pendingParentalConsent (422 teen_not_available while Teen:Enabled is off); " +
                             "under 16 → 422 age_under_minimum, nothing stored. Old clients: ageConfirmed: true without birthYear = adult (Teen:LegacyAgeCheckbox). " +
                             "Neither → 400 age_confirmation_required. The confirmation time is stored (profile ageConfirmedAt).")
            .WithTags("Auth");
    }
}

/// <param name="AgeConfirmed">Old clients' "I am 18 or older" box (transition). New clients send BirthYear (+ BirthMonth).</param>
public record RegisterRequest(string Name, string Email, string Password, bool AgeConfirmed = false, int? BirthYear = null, int? BirthMonth = null);

public class RegisterRequestValidator : AbstractValidator<RegisterRequest>
{
    public RegisterRequestValidator()
    {
        RuleFor(x => x.Name).NotEmpty().WithErrorCode("name_required").MaximumLength(60).WithErrorCode("name_too_long");
        RuleFor(x => x.Email).Email();
        RuleFor(x => x.Password).Password();
        RuleFor(x => x.AgeConfirmed).Equal(true).When(x => x.BirthYear is null).WithErrorCode(ErrorCodes.AgeConfirmationRequired);
    }
}
