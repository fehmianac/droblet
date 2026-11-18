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

namespace Api.Endpoints.V1.Tenant.Follow;

public class Post : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string handle,
        [FromServices] IApiContext apiContext,
        [FromServices] ISocialService social,
        CancellationToken cancellationToken)
    {

        return StoreResults.SocialError(await social.FollowAsync(apiContext.TenantId, handle, cancellationToken)) ?? Results.NoContent();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/tenant/follow/{handle}", Handler)
            .Produces(StatusCodes.Status204NoContent)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .Produces<ProblemDetails>(StatusCodes.Status422UnprocessableEntity)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Follow")
            .WithDescription("Immediate (no approval), both edges in one transaction, idempotent. 422 follow_limit_reached / cannot_target_self.")
            .WithTags("Tenant Social");
    }
}
