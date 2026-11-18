using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Enum;
using Domain.Services;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Auth;

public class Google : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] GoogleSignInRequest request,
        [FromServices] IGoogleIdentityVerifier verifier,
        [FromServices] IAuthService authService,
        [FromServices] IValidator<GoogleSignInRequest> validator,
        HttpContext httpContext,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        ExternalIdentity? identity;
        try
        {
            identity = await verifier.VerifyAsync(request.IdToken, cancellationToken);
        }
        catch (ProviderNotConfiguredException)
        {
            return ApiResults.Problem(StatusCodes.Status503ServiceUnavailable, ErrorCodes.ProviderNotConfigured);
        }

        if (identity is null)
            return ApiResults.Problem(StatusCodes.Status401Unauthorized, ErrorCodes.InvalidIdentityToken);

        var result = await authService.SignInExternalAsync(AuthProvider.Google, identity, request.Name, httpContext.Language(), cancellationToken);
        return result.Outcome == AuthOutcome.Success
            ? Results.Ok(AuthResponse.From(result.Tokens!))
            : ApiResults.Problem(StatusCodes.Status401Unauthorized, ErrorCodes.InvalidIdentityToken);
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/auth/google", Handler)
            .Produces<AuthResponse>(StatusCodes.Status200OK)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<ProblemDetails>(StatusCodes.Status401Unauthorized)
            .Produces<ProblemDetails>(StatusCodes.Status503ServiceUnavailable)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .AllowAnonymous()
            .WithSummary("Sign in with Google")
            .WithDescription("Validates the Google idToken against Google's JWKS (iss, aud = configured client ids, exp).")
            .WithTags("Auth");
    }
}

public record GoogleSignInRequest(string IdToken, string? Name);

public class GoogleSignInRequestValidator : AbstractValidator<GoogleSignInRequest>
{
    public GoogleSignInRequestValidator()
    {
        RuleFor(x => x.IdToken).NotEmpty().WithErrorCode("id_token_required").MaximumLength(8192).WithErrorCode("id_token_invalid");
        RuleFor(x => x.Name).MaximumLength(60).WithErrorCode("name_too_long");
    }
}
