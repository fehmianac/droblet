using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Services;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Auth;

public class Refresh : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] RefreshRequest request,
        [FromServices] IAuthService authService,
        [FromServices] IValidator<RefreshRequest> validator,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        var result = await authService.RefreshAsync(request.RefreshToken, cancellationToken);
        return result.Outcome == AuthOutcome.Success
            ? Results.Ok(AuthResponse.From(result.Tokens!))
            : ApiResults.Problem(StatusCodes.Status401Unauthorized, ErrorCodes.InvalidRefreshToken);
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/auth/refresh", Handler)
            .Produces<AuthResponse>(StatusCodes.Status200OK)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<ProblemDetails>(StatusCodes.Status401Unauthorized)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .AllowAnonymous()
            .WithSummary("Rotate the refresh token")
            .WithDescription("Returns a new access + refresh token. A refresh token works once; re-using a rotated token revokes every session.")
            .WithTags("Auth");
    }
}

public record RefreshRequest(string RefreshToken);

public class RefreshRequestValidator : AbstractValidator<RefreshRequest>
{
    public RefreshRequestValidator() =>
        RuleFor(x => x.RefreshToken).NotEmpty().WithErrorCode("refresh_token_required").MaximumLength(200).WithErrorCode("refresh_token_invalid");
}
