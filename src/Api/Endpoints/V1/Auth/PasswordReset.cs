using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Services;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Auth;

public class PasswordReset : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] PasswordResetRequest request,
        [FromServices] IAuthService authService,
        [FromServices] IValidator<PasswordResetRequest> validator,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        var outcome = await authService.ResetPasswordAsync(request.Token, request.NewPassword, cancellationToken);
        return outcome == AuthOutcome.Success
            ? Results.NoContent()
            : ApiResults.Problem(StatusCodes.Status400BadRequest, ErrorCodes.InvalidOrExpiredToken);
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/auth/password/reset", Handler)
            .Produces(StatusCodes.Status204NoContent)
            .Produces<ProblemDetails>(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .AllowAnonymous()
            .WithSummary("Set a new password with a reset token")
            .WithDescription("Token is single use; every refresh token of the user is revoked.")
            .WithTags("Auth");
    }
}

public record PasswordResetRequest(string Token, string NewPassword);

public class PasswordResetRequestValidator : AbstractValidator<PasswordResetRequest>
{
    public PasswordResetRequestValidator()
    {
        RuleFor(x => x.Token).NotEmpty().WithErrorCode("token_required").MaximumLength(200).WithErrorCode("token_invalid");
        RuleFor(x => x.NewPassword).Password();
    }
}
