using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Services;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Auth;

public class Login : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] LoginRequest request,
        [FromServices] IAuthService authService,
        [FromServices] IValidator<LoginRequest> validator,
        HttpContext httpContext,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        var result = await authService.LoginAsync(request.Email, request.Password, httpContext.ClientIp(), cancellationToken);
        return result.Outcome switch
        {
            AuthOutcome.Success => Results.Ok(AuthResponse.From(result.Tokens!)),
            AuthOutcome.TooManyAttempts => ApiResults.Problem(StatusCodes.Status429TooManyRequests, ErrorCodes.TooManyAttempts),
            // Wrong e-mail and wrong password answer the same.
            _ => ApiResults.Problem(StatusCodes.Status401Unauthorized, ErrorCodes.InvalidCredentials),
        };
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/auth/login", Handler)
            .Produces<AuthResponse>(StatusCodes.Status200OK)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<ProblemDetails>(StatusCodes.Status401Unauthorized)
            .Produces<ProblemDetails>(StatusCodes.Status429TooManyRequests)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .AllowAnonymous()
            .WithSummary("Sign in with e-mail and password")
            .WithDescription("Rate limited per e-mail and per IP.")
            .WithTags("Auth");
    }
}

public record LoginRequest(string Email, string Password);

public class LoginRequestValidator : AbstractValidator<LoginRequest>
{
    public LoginRequestValidator()
    {
        RuleFor(x => x.Email).NotEmpty().WithErrorCode("email_required").MaximumLength(254).WithErrorCode("email_too_long");
        RuleFor(x => x.Password).NotEmpty().WithErrorCode("password_required").MaximumLength(PasswordRules.MaxLength).WithErrorCode("password_too_long");
    }
}
