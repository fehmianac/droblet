using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Services;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Auth;

public class Register : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] RegisterRequest request,
        [FromServices] IAuthService authService,
        [FromServices] IValidator<RegisterRequest> validator,
        HttpContext httpContext,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        var result = await authService.RegisterAsync(request.Name, request.Email, request.Password, httpContext.Language(), httpContext.ClientIp(), cancellationToken);
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
            .Produces<ProblemDetails>(StatusCodes.Status429TooManyRequests)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .AllowAnonymous()
            .WithSummary("Register with e-mail and password")
            .WithDescription("Creates the user and their personal tenant, returns a JWT + refresh token. ageConfirmed must be true (\"I am 18 or older\", Terms §3): 400 age_confirmation_required otherwise; the confirmation time is stored (profile ageConfirmedAt).")
            .WithTags("Auth");
    }
}

public record RegisterRequest(string Name, string Email, string Password, bool AgeConfirmed = false);

public class RegisterRequestValidator : AbstractValidator<RegisterRequest>
{
    public RegisterRequestValidator()
    {
        RuleFor(x => x.Name).NotEmpty().WithErrorCode("name_required").MaximumLength(60).WithErrorCode("name_too_long");
        RuleFor(x => x.Email).Email();
        RuleFor(x => x.Password).Password();
        RuleFor(x => x.AgeConfirmed).Equal(true).WithErrorCode(ErrorCodes.AgeConfirmationRequired);
    }
}
