using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Context;
using Domain.Services;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Auth;

/// <summary>{ code } (signed in: the 6-digit code from the e-mail) or { token } (the link; signed out is fine).</summary>
public record EmailVerifyRequest(string? Code, string? Token);

public class EmailVerifyRequestValidator : AbstractValidator<EmailVerifyRequest>
{
    public EmailVerifyRequestValidator()
    {
        RuleFor(x => x).Must(x => string.IsNullOrWhiteSpace(x.Code) != string.IsNullOrWhiteSpace(x.Token))
            .WithName("code").WithErrorCode("code_or_token_required");
        RuleFor(x => x.Code).Matches("^[0-9]{6}$").When(x => !string.IsNullOrWhiteSpace(x.Code)).WithErrorCode("code_invalid");
        RuleFor(x => x.Token).MaximumLength(200).WithErrorCode("token_invalid");
    }
}

public sealed record EmailVerifyResponse(bool EmailVerified);

public class EmailVerify : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] EmailVerifyRequest request,
        [FromServices] IEmailVerificationService verification,
        [FromServices] IValidator<EmailVerifyRequest> validator,
        HttpContext httpContext,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        EmailVerificationOutcome outcome;
        if (!string.IsNullOrWhiteSpace(request.Token))
        {
            outcome = await verification.VerifyTokenAsync(request.Token, cancellationToken);
        }
        else
        {
            // The code belongs to the signed-in user (the default bearer scheme reads the token on anonymous routes too).
            var userId = httpContext.User.FindFirst(ClaimNames.Subject)?.Value;
            if (userId is null || httpContext.User.FindFirst(ClaimNames.TenantId) is null)
                return Results.Unauthorized();
            outcome = await verification.VerifyCodeAsync(userId, request.Code!, cancellationToken);
        }

        return outcome switch
        {
            EmailVerificationOutcome.Verified or EmailVerificationOutcome.AlreadyVerified => Results.Ok(new EmailVerifyResponse(true)),
            EmailVerificationOutcome.Expired => ApiResults.Problem(StatusCodes.Status400BadRequest, ErrorCodes.VerificationExpired),
            EmailVerificationOutcome.TooManyAttempts => ApiResults.Problem(StatusCodes.Status429TooManyRequests, ErrorCodes.TooManyAttempts),
            _ => ApiResults.Problem(StatusCodes.Status400BadRequest, ErrorCodes.InvalidVerificationCode),
        };
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/auth/email/verify", Handler)
            .Produces<EmailVerifyResponse>(StatusCodes.Status200OK)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces<ProblemDetails>(StatusCodes.Status429TooManyRequests)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .AllowAnonymous()
            .WithSummary("Verify the e-mail address")
            .WithDescription(
                "Exactly one of code (6 digits, needs the bearer token) or token (from the e-mail link, works signed out). " +
                "Both are valid 24 hours; a resend replaces them. 200 { emailVerified: true } also when it already was. " +
                "400 invalid_verification_code (wrong / older code or link) | verification_expired; 429 too_many_attempts after " +
                "5 wrong codes (ask for a new one) or AuthRateLimits:VerifyCodePerUserPerHour. The profile then has emailVerified = true.")
            .WithTags("Auth");
    }
}

public class EmailResend : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromServices] IApiContext apiContext,
        [FromServices] IEmailVerificationService verification,
        HttpContext httpContext,
        CancellationToken cancellationToken)
    {
        var outcome = await verification.ResendAsync(apiContext.UserId, httpContext.Language(), cancellationToken);
        return outcome switch
        {
            EmailVerificationOutcome.Sent => Results.Accepted(),
            EmailVerificationOutcome.AlreadyVerified => ApiResults.Problem(StatusCodes.Status409Conflict, ErrorCodes.EmailAlreadyVerified),
            EmailVerificationOutcome.TooManyAttempts => ApiResults.Problem(StatusCodes.Status429TooManyRequests, ErrorCodes.TooManyAttempts),
            _ => Results.NotFound(),
        };
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/auth/email/resend", Handler)
            .Produces(StatusCodes.Status202Accepted)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces<ProblemDetails>(StatusCodes.Status409Conflict)
            .Produces<ProblemDetails>(StatusCodes.Status429TooManyRequests)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Send the verification e-mail again")
            .WithDescription(
                "New 6-digit code + link (the previous ones stop working), in the Accept-Language. One per 60 s and " +
                "AuthRateLimits:VerifyResendPerUserPerDay (5) per day: 429 too_many_attempts. 409 email_already_verified.")
            .WithTags("Auth");
    }
}
