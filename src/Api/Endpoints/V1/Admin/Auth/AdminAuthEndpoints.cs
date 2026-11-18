using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Services.Admin;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Admin.Auth;

// Admin sign-in (docs/api/admin.md §3): e-mail + password → e-mailed 6-digit code → admin session.

public class PostLogin : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] AdminLoginRequest request,
        [FromServices] IValidator<AdminLoginRequest> validator,
        [FromServices] IAdminAuthService auth,
        HttpContext http,
        CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(request, ct);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        var result = await auth.LoginAsync(request.Email, request.Password, new AdminRequestInfo(http.ClientIp(), http.Language()), ct);
        return result.Outcome switch
        {
            AdminAuthOutcome.Success => Results.Ok(new AdminLoginResponse(result.ChallengeId!, result.ExpiresAt!.Value, 6)),
            AdminAuthOutcome.TooManyAttempts => ApiResults.Problem(StatusCodes.Status429TooManyRequests, ErrorCodes.TooManyAttempts),
            AdminAuthOutcome.EmailUnavailable => ApiResults.Problem(StatusCodes.Status503ServiceUnavailable, ErrorCodes.EmailUnavailable),
            _ => ApiResults.Problem(StatusCodes.Status401Unauthorized, ErrorCodes.InvalidCredentials),
        };
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPost("v1/admin/auth/login", Handler)
            .Produces<AdminLoginResponse>(StatusCodes.Status200OK)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<ProblemDetails>(StatusCodes.Status401Unauthorized)
            .AdminAnonymous()
            .WithSummary("Admin sign-in, step 1: e-mail + password")
            .WithDescription("A correct password e-mails a 6-digit code (10 min, 5 tries, single use) and returns the challenge id. Unknown e-mail, wrong password, disabled admin and no password yet all answer 401 invalid_credentials. Rate limited per e-mail and per IP.")
            .WithTags("Admin Auth");
}

public class PostVerify : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] AdminVerifyRequest request,
        [FromServices] IValidator<AdminVerifyRequest> validator,
        [FromServices] IAdminAuthService auth,
        HttpContext http,
        CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(request, ct);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        var result = await auth.VerifyAsync(request.ChallengeId, request.Code, new AdminRequestInfo(http.ClientIp(), http.Language()), ct);
        return result.Outcome switch
        {
            AdminAuthOutcome.Success => Results.Ok(result.Session),
            AdminAuthOutcome.InvalidCode => AdminResults.InvalidCode(result.AttemptsLeft),
            AdminAuthOutcome.TooManyAttempts => ApiResults.Problem(StatusCodes.Status429TooManyRequests, ErrorCodes.TooManyAttempts),
            _ => ApiResults.Problem(StatusCodes.Status401Unauthorized, ErrorCodes.ChallengeExpired),
        };
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPost("v1/admin/auth/verify", Handler)
            .Produces<AdminSessionDto>(StatusCodes.Status200OK)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<ProblemDetails>(StatusCodes.Status401Unauthorized)
            .AdminAnonymous()
            .WithSummary("Admin sign-in, step 2: the e-mailed code")
            .WithDescription("401 invalid_code (+ attemptsLeft) or challenge_expired (unknown, expired, used, or out of tries).")
            .WithTags("Admin Auth");
}

public class PostRefresh : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] AdminRefreshRequest request,
        [FromServices] IValidator<AdminRefreshRequest> validator,
        [FromServices] IAdminAuthService auth,
        CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(request, ct);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        var result = await auth.RefreshAsync(request.RefreshToken, ct);
        return result.Outcome == AdminAuthOutcome.Success
            ? Results.Ok(result.Session)
            : ApiResults.Problem(StatusCodes.Status401Unauthorized, ErrorCodes.InvalidToken);
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPost("v1/admin/auth/refresh", Handler)
            .Produces<AdminSessionDto>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status401Unauthorized)
            .AdminAnonymous()
            .WithSummary("Rotate the admin refresh token")
            .WithDescription("Every refresh rotates the token; a rotated token presented again ends every session of that admin. The session never outlives AdminJwt:RefreshTokenHours from sign-in.")
            .WithTags("Admin Auth");
}

public class PostLogout : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] AdminLogoutRequest? request,
        [FromServices] IAdminContext admin,
        [FromServices] IAdminAuthService auth,
        CancellationToken ct)
    {
        await auth.LogoutAsync(admin.Admin, request?.RefreshToken, admin.Ip, ct);
        return Results.NoContent();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPost("v1/admin/auth/logout", Handler)
            .Produces(StatusCodes.Status204NoContent)
            .RequireAdmin(null)
            .WithSummary("Sign out of this session")
            .WithTags("Admin Auth");
}

public class PostLogoutAll : IEndpoint
{
    private static async Task<IResult> Handler([FromServices] IAdminContext admin, [FromServices] IAdminAuthService auth, CancellationToken ct)
    {
        await auth.LogoutAllAsync(admin.Admin, admin.Ip, ct);
        return Results.NoContent();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPost("v1/admin/auth/logout-all", Handler)
            .Produces(StatusCodes.Status204NoContent)
            .RequireAdmin(null)
            .WithSummary("Sign out of every session")
            .WithDescription("Refresh tokens and access tokens issued before now stop working (this one included).")
            .WithTags("Admin Auth");
}

public class GetMe : IEndpoint
{
    private static IResult Handler([FromServices] IAdminContext admin) => Results.Ok(AdminMeDto.From(admin.Admin));

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapGet("v1/admin/auth/me", Handler)
            .Produces<AdminMeDto>(StatusCodes.Status200OK)
            .RequireAdmin(null)
            .WithSummary("The signed-in admin and their permissions")
            .WithTags("Admin Auth");
}

public class PutPassword : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] AdminChangePasswordRequest request,
        [FromServices] IValidator<AdminChangePasswordRequest> validator,
        [FromServices] IAdminContext admin,
        [FromServices] IAdminAuthService auth,
        CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(request, ct);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        return await auth.ChangePasswordAsync(admin.Admin, request.CurrentPassword, request.NewPassword, admin.Ip, ct) == AdminAuthOutcome.Success
            ? Results.NoContent()
            : ApiResults.Problem(StatusCodes.Status401Unauthorized, ErrorCodes.InvalidCredentials);
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPut("v1/admin/auth/password", Handler)
            .Produces(StatusCodes.Status204NoContent)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .RequireAdmin(null)
            .WithSummary("Change my admin password")
            .WithDescription("Ends every session (sign in again). Password: 10–128 characters, a letter and a digit.")
            .WithTags("Admin Auth");
}

public class PostPasswordForgot : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] AdminForgotPasswordRequest request,
        [FromServices] IValidator<AdminForgotPasswordRequest> validator,
        [FromServices] IAdminAuthService auth,
        HttpContext http,
        CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(request, ct);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        await auth.RequestPasswordResetAsync(request.Email, new AdminRequestInfo(http.ClientIp(), http.Language()), ct);
        return Results.Accepted();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPost("v1/admin/auth/password/forgot", Handler)
            .Produces(StatusCodes.Status202Accepted)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .AdminAnonymous()
            .WithSummary("E-mail a set / reset password link")
            .WithDescription("Always 202. Also the first set-password path of the bootstrap super admin (docs/api/admin.md §7).")
            .WithTags("Admin Auth");
}

public class PostPasswordReset : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] AdminResetPasswordRequest request,
        [FromServices] IValidator<AdminResetPasswordRequest> validator,
        [FromServices] IAdminAuthService auth,
        HttpContext http,
        CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(request, ct);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        return await auth.ResetPasswordAsync(request.Token, request.NewPassword, http.ClientIp(), ct) == AdminAuthOutcome.Success
            ? Results.NoContent()
            : ApiResults.Problem(StatusCodes.Status400BadRequest, ErrorCodes.InvalidToken);
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPost("v1/admin/auth/password/reset", Handler)
            .Produces(StatusCodes.Status204NoContent)
            .Produces<ProblemDetails>(StatusCodes.Status400BadRequest)
            .AdminAnonymous()
            .WithSummary("Set a new admin password with the e-mailed token")
            .WithDescription("Single use; ends every session of that admin.")
            .WithTags("Admin Auth");
}
