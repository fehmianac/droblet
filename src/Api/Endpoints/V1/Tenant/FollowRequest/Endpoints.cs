using Api.Contracts;
using Api.Infrastructure.Contract;
using Domain.Context;
using Domain.Services;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.FollowRequest;

// Decision 8 (follow approval): the pending requests of followers-only / private accounts.

public class GetIncoming : IEndpoint
{
    private static async Task<IResult> Handler([FromServices] IApiContext apiContext, [FromServices] ISocialService social, CancellationToken cancellationToken) =>
        Results.Ok(await social.GetFollowRequestsAsync(apiContext.TenantId, incoming: true, cancellationToken));

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapGet("v1/tenant/follow-request/incoming", Handler)
            .Produces<List<FollowRequestDto>>(StatusCodes.Status200OK)
            .Tenant("Tenant Social", "Follow requests to me", "Pending requests to follow the caller, newest first, with the requester's card.");
}

public class GetOutgoing : IEndpoint
{
    private static async Task<IResult> Handler([FromServices] IApiContext apiContext, [FromServices] ISocialService social, CancellationToken cancellationToken) =>
        Results.Ok(await social.GetFollowRequestsAsync(apiContext.TenantId, incoming: false, cancellationToken));

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapGet("v1/tenant/follow-request/outgoing", Handler)
            .Produces<List<FollowRequestDto>>(StatusCodes.Status200OK)
            .Tenant("Tenant Social", "My follow requests", "The caller's pending requests, newest first.");
}

public class PostApprove : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string handle, [FromServices] IApiContext apiContext, [FromServices] ISocialService social, CancellationToken cancellationToken) =>
        StoreResults.SocialError(await social.AnswerFollowRequestAsync(apiContext.TenantId, handle, approve: true, cancellationToken)) ?? Results.NoContent();

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPost("v1/tenant/follow-request/{handle}/approve", Handler)
            .Produces(StatusCodes.Status204NoContent)
            .Problems(StatusCodes.Status404NotFound)
            .Tenant("Tenant Social", "Approve a follow request", "The requester becomes a follower (both edges in one transaction). 404 when that account has no pending request.");
}

public class PostDecline : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string handle, [FromServices] IApiContext apiContext, [FromServices] ISocialService social, CancellationToken cancellationToken) =>
        StoreResults.SocialError(await social.AnswerFollowRequestAsync(apiContext.TenantId, handle, approve: false, cancellationToken)) ?? Results.NoContent();

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPost("v1/tenant/follow-request/{handle}/decline", Handler)
            .Produces(StatusCodes.Status204NoContent)
            .Problems(StatusCodes.Status404NotFound)
            .Tenant("Tenant Social", "Decline a follow request", "Removes the request; the requester is not told. 404 when that account has no pending request.");
}

public class Delete : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string handle, [FromServices] IApiContext apiContext, [FromServices] ISocialService social, CancellationToken cancellationToken) =>
        StoreResults.SocialError(await social.CancelFollowRequestAsync(apiContext.TenantId, handle, cancellationToken)) ?? Results.NoContent();

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapDelete("v1/tenant/follow-request/{handle}", Handler)
            .Produces(StatusCodes.Status204NoContent)
            .Problems(StatusCodes.Status404NotFound)
            .Tenant("Tenant Social", "Cancel my follow request", "Withdraws the caller's pending request. Idempotent. 404 unknown handle.");
}
