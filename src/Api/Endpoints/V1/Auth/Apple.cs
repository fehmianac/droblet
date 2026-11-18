using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Enum;
using Domain.Services;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Auth;

public class Apple : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] AppleSignInRequest request,
        [FromServices] IAppleIdentityVerifier verifier,
        [FromServices] IAuthService authService,
        [FromServices] IValidator<AppleSignInRequest> validator,
        HttpContext httpContext,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        ExternalIdentity? identity;
        try
        {
            identity = await verifier.VerifyAsync(request.IdentityToken, request.Nonce, cancellationToken);
        }
        catch (ProviderNotConfiguredException)
        {
            return ApiResults.Problem(StatusCodes.Status503ServiceUnavailable, ErrorCodes.ProviderNotConfigured);
        }

        if (identity is null)
            return ApiResults.Problem(StatusCodes.Status401Unauthorized, ErrorCodes.InvalidIdentityToken);

        // Apple sends the name only on the very first authorization; it is stored then.
        var name = request.FullName is { } n ? string.Join(' ', new[] { n.GivenName, n.FamilyName }.Where(p => !string.IsNullOrWhiteSpace(p))) : null;
        var result = await authService.SignInExternalAsync(AuthProvider.Apple, identity, name, httpContext.Language(), cancellationToken);
        return result.Outcome == AuthOutcome.Success
            ? Results.Ok(AuthResponse.From(result.Tokens!))
            : ApiResults.Problem(StatusCodes.Status401Unauthorized, ErrorCodes.InvalidIdentityToken);
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/auth/apple", Handler)
            .Produces<AuthResponse>(StatusCodes.Status200OK)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<ProblemDetails>(StatusCodes.Status401Unauthorized)
            .Produces<ProblemDetails>(StatusCodes.Status503ServiceUnavailable)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .AllowAnonymous()
            .WithSummary("Sign in with Apple")
            .WithDescription("Validates identityToken against Apple's JWKS (iss, aud = bundle id, exp, nonce) and returns a JWT + refresh token.")
            .WithTags("Auth");
    }
}

public record AppleFullName(string? GivenName, string? FamilyName);

public record AppleSignInRequest(string IdentityToken, string Nonce, AppleFullName? FullName);

public class AppleSignInRequestValidator : AbstractValidator<AppleSignInRequest>
{
    public AppleSignInRequestValidator()
    {
        RuleFor(x => x.IdentityToken).NotEmpty().WithErrorCode("identity_token_required").MaximumLength(8192).WithErrorCode("identity_token_invalid");
        RuleFor(x => x.Nonce).NotEmpty().WithErrorCode("nonce_required").MaximumLength(256).WithErrorCode("nonce_invalid");
        RuleFor(x => x.FullName!.GivenName).MaximumLength(60).WithErrorCode("name_too_long").When(x => x.FullName is not null);
        RuleFor(x => x.FullName!.FamilyName).MaximumLength(60).WithErrorCode("name_too_long").When(x => x.FullName is not null);
    }
}
