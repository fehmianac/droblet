using Api.Contracts;
using Api.Infrastructure.Contract;
using Domain.Constant;
using Domain.Context;
using Domain.Domain;
using Domain.Services;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Content.Feed;

// Akış F1 reads (decisions 16–19): editor posts and stories. Open to teens (decision 17); the app hides prices and the
// buy button for them (teen `commerce` restriction) — the server does not strip anything here.

public class Get : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromQuery] string? occasion,
        [FromQuery] string? pageToken,
        [FromServices] IApiContext apiContext,
        [FromServices] IFeedService feed,
        CancellationToken cancellationToken)
    {
        if (!FeedRules.TryParseOccasions(occasion, out var filter))
            return StoreResults.BadQuery();
        return Results.Ok(await feed.GetFeedAsync(apiContext.TenantId, filter, pageToken, cancellationToken));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapGet("v1/content/feed", Handler)
            .Produces<PagedDto<FeedPostDto>>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Akış: editor posts")
            .WithDescription("Published, not retired posts whose publishAt has come, of the user's segment or of every segment; newest first " +
                             "(publishAt desc, then sortOrder). occasion = one or more comma-separated Occasion wire names (office | weekend | dinner,wedding = the app's \"Davet\" tab);" +
                             "unknown → 400 validation_failed. Page size ContentFeed:PageSize (10); pageToken = the previous page's token. " +
                             "Products carry ownedSimilar; buyableCount = available and not owned; liked / saved are the caller's.")
            .WithTags("Content");
}

public class GetStory : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromServices] IApiContext apiContext,
        [FromServices] IFeedService feed,
        CancellationToken cancellationToken) =>
        Results.Ok(await feed.GetStoriesAsync(apiContext.TenantId, cancellationToken));

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapGet("v1/content/feed/story", Handler)
            .Produces<List<FeedStoryDto>>(StatusCodes.Status200OK)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Akış: editor stories")
            .WithDescription("Published, not retired stories inside [publishAt, expiresAt) of the user's segment or of every segment; sortOrder, then newest. " +
                             "At most ContentFeed:MaxStories (20).")
            .WithTags("Content");
}
