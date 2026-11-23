using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Context;
using Domain.Domain;
using Domain.Services;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.FeedPost;

// Akış interactions: ♡ and save (F1), and on the shared looks of users (F2, ids "u_…") also "similar products", "hide for
// me" and "report". No comments or follows on the card (decisions 18–19). Not under the teen `social` restriction
// (TeenRouteRules closes only the exact friends' feed route v1/tenant/feed): teens use these on editor posts; a user post
// simply does not exist for them (404).

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
            .WithDescription("Idempotent: liking again changes nothing. → { liked: true, likeCount }. 404 not_found when the post is unknown, a draft, scheduled or retired — or, for a user post (u_…), my own, of a blocked pair, hidden by reports or removed.")
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

public class GetSimilar : IEndpoint
{
    private static async Task<IResult> Handler([FromRoute] string id, [FromServices] IApiContext apiContext, [FromServices] IFeedService feed, CancellationToken ct) =>
        await feed.GetSimilarAsync(apiContext.TenantId, id, ct) is { } products ? Results.Ok(products) : StoreResults.NotFound();

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapGet("v1/tenant/feed-post/{id}/similar", Handler)
            .Produces<List<ProductDto>>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Similar products of a shared look")
            .WithDescription("\"Benzerlerini gör\" of a user post: catalog products of the viewer's segment similar to the look's pieces (same wardrobe category and the " +
                             "piece's main colour among the product's colours — the rule behind ownedSimilar; a catalog piece of the look comes first), not retired, " +
                             "one piece after the other, newest first; at most ContentFeed:MaxSimilarProducts (12). 404 not_found for an editor post or a user post the caller may not see.")
            .WithTags("Tenant Feed Post");
}

public class PutHide : IEndpoint
{
    private static async Task<IResult> Handler([FromRoute] string id, [FromServices] IApiContext apiContext, [FromServices] IFeedService feed, CancellationToken ct) =>
        await feed.HideAsync(apiContext.TenantId, id, ct) == FeedWriteOutcome.Ok ? Results.NoContent() : StoreResults.NotFound();

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPut("v1/tenant/feed-post/{id}/hide", Handler)
            .Produces(StatusCodes.Status204NoContent)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Hide an Akış post for me")
            .WithDescription("\"Bunu gösterme\": GET v1/content/feed never returns the post to the caller again. Idempotent. Works on user posts and editor posts. 404 not_found as for like.")
            .WithTags("Tenant Feed Post");
}

public class PostLook : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromBody] FeedPostLookRequest request,
        [FromServices] IValidator<FeedPostLookRequest> validator,
        [FromServices] IApiContext apiContext,
        [FromServices] IFeedLookService looks,
        CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(request, ct);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        return (await looks.SaveAsLookAsync(apiContext.TenantId, id, new SaveFeedPostAsLookCommand(request.Mode!.Value, request.RequestId!), ct))
            .ToHttp($"/v1/tenant/look/{request.RequestId}");
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPost("v1/tenant/feed-post/{id}/look", Handler)
            .Produces<LookDto>(StatusCodes.Status201Created)
            .Produces<LookDto>(StatusCodes.Status200OK)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<ProblemDetails>(StatusCodes.Status403Forbidden)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .Produces<ProblemDetails>(StatusCodes.Status409Conflict)
            .Produces<ProblemDetails>(StatusCodes.Status422UnprocessableEntity)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Save an Akış editor post into my looks")
            .WithDescription("\"Looklarıma ekle\" on an editor post that has pieces. Body { mode, requestId }: mode = inspiration (a look without pieces whose cover is the " +
                             "post's photograph; source = inspiration; nothing is added to the wardrobe; no AI cover; never shareable) | pieces (every piece of the post becomes a " +
                             "wardrobe item with its clean picture — colour \"other\", every season, no name — and a normal own look is made of them, one piece per slot; " +
                             "its AI cover is requested like any saved look's). requestId = a client ULID, the new look's id. → 201 LookDto; the same post in the same mode " +
                             "again → 200 with the look made then (while it exists). name = the post's title in the request language, occasion = the post's. " +
                             "No AI call. Open to teens. 404 not_found (unknown, draft, scheduled, retired, a user post u_…); 422 look_not_savable (no pieces; inspiration: " +
                             "no readable photograph; pieces: fewer than two pieces that take a look slot); 403 premium_required (the wardrobe-item entitlement); " +
                             "409 look_id_taken (requestId is another look's id).")
            .WithTags("Tenant Feed Post");
}

public class PostReport : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromBody] FeedPostReportRequest request,
        [FromServices] IValidator<FeedPostReportRequest> validator,
        [FromServices] IApiContext apiContext,
        [FromServices] IFeedService feed,
        CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(request, ct);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        var (outcome, reportId, created) = await feed.ReportAsync(apiContext.TenantId, id, request.Reason, request.Note, ct);
        if (StoreResults.SocialError(outcome) is { } error)
            return error;
        return created
            ? Results.Created($"/v1/admin/moderation/report/{reportId}", new ReportCreatedResponse(reportId!))
            : Results.Ok(new ReportCreatedResponse(reportId!));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPost("v1/tenant/feed-post/{id}/report", Handler)
            .Produces<ReportCreatedResponse>(StatusCodes.Status201Created)
            .Produces<ReportCreatedResponse>(StatusCodes.Status200OK)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .Produces<ProblemDetails>(StatusCodes.Status422UnprocessableEntity)
            .Produces<ProblemDetails>(StatusCodes.Status429TooManyRequests)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Report a shared look")
            .WithDescription("User posts only. reason = spam | inappropriate | harassment | impersonation | minorSafety | other; note ≤ 500. One report per user per post: " +
                             "the first answers 201 { reportId }, a repeat 200 with the same id. Filed as a moderation report of the look (targetKind look). " +
                             "ContentFeed:ReportsToAutoHide (3) distinct reporters take the look off the feed until an admin restores or removes it. " +
                             "404 not_found (editor post, unknown or not visible); 422 cannot_target_self; 429 too_many_attempts (Social:ReportsPerDay, shared with profile reports).")
            .WithTags("Tenant Feed Post");
}
