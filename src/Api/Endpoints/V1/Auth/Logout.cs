using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Context;
using Domain.Services;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Auth;

public class Logout : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] LogoutRequest request,
        [FromServices] IApiContext apiContext,
        [FromServices] IAuthService authService,
        [FromServices] IValidator<LogoutRequest> validator,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        await authService.LogoutAsync(apiContext.UserId, apiContext.TenantId, request.RefreshToken, request.DeviceId, cancellationToken);
        return Results.NoContent();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/auth/logout", Handler)
            .Produces(StatusCodes.Status204NoContent)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Sign out")
            .WithDescription("Revokes the given refresh token and removes the device's push registration.")
            .WithTags("Auth");
    }
}

public record LogoutRequest(string? RefreshToken, string? DeviceId);

public class LogoutRequestValidator : AbstractValidator<LogoutRequest>
{
    public LogoutRequestValidator()
    {
        RuleFor(x => x.RefreshToken).MaximumLength(200).WithErrorCode("refresh_token_invalid");
        RuleFor(x => x.DeviceId).MaximumLength(100).WithErrorCode("device_id_invalid");
    }
}
