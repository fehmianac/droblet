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

namespace Api.Endpoints.V1.Tenant.Feed;

public class Get : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromQuery] string? pageToken,
        [FromServices] IApiContext apiContext,
        [FromServices] ISocialService social,
        CancellationToken cancellationToken)
    {

        return Results.Ok(await social.GetFeedAsync(apiContext.TenantId, pageToken, cancellationToken));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/tenant/feed", Handler)
            .Produces<PagedDto<SocialLookDto>>(StatusCodes.Status200OK)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Friends feed")
            .WithDescription("Looks of followed users the caller may currently see, newest first, with rating summary, own score and saved flag. Look images are item images, never try-on images.")
            .WithTags("Tenant Social");
    }
}
