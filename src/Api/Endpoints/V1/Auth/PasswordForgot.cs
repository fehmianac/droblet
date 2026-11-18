using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Services;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Auth;

public class PasswordForgot : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] PasswordForgotRequest request,
        [FromServices] IAuthService authService,
        [FromServices] IValidator<PasswordForgotRequest> validator,
        HttpContext httpContext,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        await authService.RequestPasswordResetAsync(request.Email, httpContext.Language(), cancellationToken);
        return Results.Accepted();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/auth/password/forgot", Handler)
            .Produces(StatusCodes.Status202Accepted)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .AllowAnonymous()
            .WithSummary("Request a password reset e-mail")
            .WithDescription("Always 202, whether or not the account exists. The e-mail carries a deep link with a single-use 30-minute token.")
            .WithTags("Auth");
    }
}

public record PasswordForgotRequest(string Email);

public class PasswordForgotRequestValidator : AbstractValidator<PasswordForgotRequest>
{
    public PasswordForgotRequestValidator() => RuleFor(x => x.Email).Email();
}
