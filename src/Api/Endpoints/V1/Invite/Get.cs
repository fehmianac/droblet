using System.Text.Json;
using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Context;
using Domain.Domain;
using Domain.Entity;
using Domain.Enum;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Domain.Validation;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace Api.Endpoints.V1.Invite;

public class Get : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string code,
        HttpContext httpContext,
        [FromServices] IInviteService invites,
        [FromServices] IRateLimiter rateLimiter,
        [FromServices] IOptionsMonitor<SocialOptions> options,
        CancellationToken cancellationToken)
    {

        if (httpContext.ClientIp() is { } ip
            && !await rateLimiter.TryAcquireAsync("invite-resolve-ip", ip, options.CurrentValue.InviteResolvePerIpPerHour, TimeSpan.FromHours(1), cancellationToken))
            return ApiResults.Problem(StatusCodes.Status429TooManyRequests, ErrorCodes.TooManyAttempts);

        var preview = await invites.ResolveAsync(code, cancellationToken);
        return preview is null ? StoreResults.NotFound(StoreSocialErrorCodes.InviteCodeNotFound) : Results.Ok(preview);
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/invite/{code}", Handler)
            .Produces<InvitePreviewDto>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .Produces<ProblemDetails>(StatusCodes.Status429TooManyRequests)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .AllowAnonymous()
            .WithSummary("Resolve an invite code")
            .WithDescription("Anonymous preview for the landing / install screen: the inviter's first name only. Rate limited per IP.")
            .WithTags("Invite");
    }
}
