using Api.Contracts;
using Api.Infrastructure.Contract;
using Domain.Constant;
using Domain.Context;
using Domain.Domain;
using Domain.Services;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.FeedPost;

// Akış F1 interactions: ♡ and save. No comments, shares or follows (decisions 18–19). Not under the teen `social`
// restriction (TeenRouteRules closes only the exact friends' feed route v1/tenant/feed).

public class PutLike : IEndpoint
{
    private static async Task<IResult> Handler([FromRoute] string id, [FromServices] IApiContext apiContext, [FromServices] IFeedService feed, CancellationToken ct) =>
        await feed.LikeAsync(apiContext.TenantId, id, ct) is { } result ? Results.Ok(result) : StoreResults.NotFound();

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPut("v1/tenant/feed-post/{id}/like", Handler)
            .Produces<FeedLikeDto>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Like an Akış post")
            .WithDescription("Idempotent: liking again changes nothing. → { liked: true, likeCount }. 404 not_found when the post is unknown, a draft, scheduled or retired.")
            .WithTags("Tenant Feed Post");
}

public class DeleteLike : IEndpoint
{
    private static async Task<IResult> Handler([FromRoute] string id, [FromServices] IApiContext apiContext, [FromServices] IFeedService feed, CancellationToken ct) =>
        await feed.UnlikeAsync(apiContext.TenantId, id, ct) is { } result ? Results.Ok(result) : StoreResults.NotFound();

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapDelete("v1/tenant/feed-post/{id}/like", Handler)
            .Produces<FeedLikeDto>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Take back a like")
            .WithDescription("Idempotent: un-liking a post that is not liked changes nothing. → { liked: false, likeCount }. 404 not_found as for PUT.")
            .WithTags("Tenant Feed Post");
}

public class PutSave : IEndpoint
{
    private static async Task<IResult> Handler([FromRoute] string id, [FromServices] IApiContext apiContext, [FromServices] IFeedService feed, CancellationToken ct) =>
        await feed.SaveAsync(apiContext.TenantId, id, ct) == FeedWriteOutcome.Ok ? Results.NoContent() : StoreResults.NotFound();

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPut("v1/tenant/feed-post/{id}/save", Handler)
            .Produces(StatusCodes.Status204NoContent)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Save an Akış post")
            .WithDescription("Idempotent (saving again keeps the first save time). 404 not_found when the post is unknown, a draft, scheduled or retired.")
            .WithTags("Tenant Feed Post");
}

public class DeleteSave : IEndpoint
{
    private static async Task<IResult> Handler([FromRoute] string id, [FromServices] IApiContext apiContext, [FromServices] IFeedService feed, CancellationToken ct)
    {
        await feed.UnsaveAsync(apiContext.TenantId, id, ct);
        return Results.NoContent();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapDelete("v1/tenant/feed-post/{id}/save", Handler)
            .Produces(StatusCodes.Status204NoContent)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Remove an Akış post from saved")
            .WithDescription("Idempotent: always 204 (also for a post that is not saved, or was retired since).")
            .WithTags("Tenant Feed Post");
}

public class GetSaved : IEndpoint
{
    private static async Task<IResult> Handler([FromServices] IApiContext apiContext, [FromServices] IFeedService feed, CancellationToken ct) =>
        Results.Ok(await feed.GetSavedAsync(apiContext.TenantId, ct));

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapGet("v1/tenant/feed-post/saved", Handler)
            .Produces<List<FeedPostDto>>(StatusCodes.Status200OK)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Saved Akış posts")
            .WithDescription("The caller's saved posts, newest save first, as FeedPostDto. Posts retired or unpublished since are left out.")
            .WithTags("Tenant Feed Post");
}
