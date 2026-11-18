using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Enum;
using Domain.Services;
using FluentValidation;
using Infrastructure.Services;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Auth;

public class Apple : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] AppleSignInRequest request,
        [FromServices] IAppleIdentityVerifier verifier,
        [FromServices] IAuthService authService,
        [FromServices] IAppleSignInTokenService appleTokens,
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
        // Keeps an Apple refresh token so account deletion can revoke it (App Store requirement). Never fails sign-in.
        if (result.Outcome == AuthOutcome.Success && !string.IsNullOrWhiteSpace(request.AuthorizationCode))
            await appleTokens.StoreFromAuthorizationCodeAsync(identity.Subject, request.AuthorizationCode, cancellationToken);
        return result.Outcome switch
        {
            AuthOutcome.Success => Results.Ok(AuthResponse.From(result.Tokens!)),
            AuthOutcome.Suspended => ApiResults.Problem(StatusCodes.Status403Forbidden, ErrorCodes.AccountSuspended),
            _ => ApiResults.Problem(StatusCodes.Status401Unauthorized, ErrorCodes.InvalidIdentityToken),
        };
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/auth/apple", Handler)
            .Produces<AuthResponse>(StatusCodes.Status200OK)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<ProblemDetails>(StatusCodes.Status401Unauthorized)
            .Produces<ProblemDetails>(StatusCodes.Status403Forbidden)
            .Produces<ProblemDetails>(StatusCodes.Status503ServiceUnavailable)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .AllowAnonymous()
            .WithSummary("Sign in with Apple")
            .WithDescription("Validates identityToken against Apple's JWKS (iss, aud = bundle id, exp, nonce) and returns a JWT + refresh token. authorizationCode (optional, from the same Apple sheet) is exchanged for an Apple refresh token that is stored encrypted and revoked on account deletion.")
            .WithTags("Auth");
    }
}

public record AppleFullName(string? GivenName, string? FamilyName);

public record AppleSignInRequest(string IdentityToken, string Nonce, AppleFullName? FullName, string? AuthorizationCode = null);

public class AppleSignInRequestValidator : AbstractValidator<AppleSignInRequest>
{
    public AppleSignInRequestValidator()
    {
        RuleFor(x => x.IdentityToken).NotEmpty().WithErrorCode("identity_token_required").MaximumLength(8192).WithErrorCode("identity_token_invalid");
        RuleFor(x => x.Nonce).NotEmpty().WithErrorCode("nonce_required").MaximumLength(256).WithErrorCode("nonce_invalid");
        RuleFor(x => x.AuthorizationCode).MaximumLength(2048).WithErrorCode("authorization_code_invalid");
        RuleFor(x => x.FullName!.GivenName).MaximumLength(60).WithErrorCode("name_too_long").When(x => x.FullName is not null);
        RuleFor(x => x.FullName!.FamilyName).MaximumLength(60).WithErrorCode("name_too_long").When(x => x.FullName is not null);
    }
}
