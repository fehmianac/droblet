using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Domain;
using Domain.Services;
using Domain.Services.Admin;
using Domain.Validation;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Admin.Feed;

// Akış F1 editor content (content.manage): posts and stories. Ids are never reused — DELETE retires.

public class GetPosts : IEndpoint
{
    private static async Task<IResult> Handler([FromServices] IFeedService feed, CancellationToken ct) => Results.Ok(await feed.ListPostsAsync(ct));

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapGet("v1/admin/feed-post", Handler)
            .Produces<List<AdminFeedPostDto>>(StatusCodes.Status200OK)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAdmin(AdminPermissions.ContentManage)
            .WithSummary("Akış posts (admin)")
            .WithDescription("Every post, drafts / scheduled / retired included, in feed order (publishAt desc, sortOrder), with its like count.")
            .WithTags("Admin Content");
}

public class PutPost : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromBody] FeedPostInput request,
        [FromServices] IValidator<FeedPostInput> validator,
        [FromServices] IFeedService feed,
        CancellationToken ct)
    {
        request = request with { Id = id };
        var validation = await validator.ValidateAsync(request, ct);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        var (outcome, post, missing) = await feed.UpsertPostAsync(request, ct);
        return outcome == CatalogWriteOutcome.ProductNotFound ? StoreResults.MissingProducts(missing) : Results.Ok(post);
    }

    private static async Task<object?> Before(HttpContext http, string id) =>
        await http.RequestServices.GetRequiredService<IFeedService>().GetPostAsync(id, http.RequestAborted);

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPut("v1/admin/feed-post/{id}", Handler)
            .Produces<AdminFeedPostDto>(StatusCodes.Status200OK)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<ProblemDetails>(StatusCodes.Status422UnprocessableEntity)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAdmin(AdminPermissions.ContentManage)
            .Audited("feed_post.upsert", "feed_post", "id", Before)
            .WithSummary("Create or update an Akış post")
            .WithDescription("Id: a content slug or a ULID. segment women | men | null (= all); author { kind edit | stylist, name L (tr required, ≤ 60), handle?, imageUrl? }; " +
                             "occasion (Occasion); title L ≤ 120; note L ≤ 600; imageUrls 1–4 https; productIds 0–8 distinct, each must exist " +
                             "(422 product_not_found + productIds); publishAt UTC; sortOrder 0–100000; published; retired. The like count is kept.")
            .WithTags("Admin Content");
}

public class DeletePost : IEndpoint
{
    private static async Task<IResult> Handler([FromRoute] string id, [FromServices] IFeedService feed, CancellationToken ct) =>
        await feed.RetirePostAsync(id, ct) ? Results.NoContent() : StoreResults.NotFound();

    private static async Task<object?> Before(HttpContext http, string id) =>
        await http.RequestServices.GetRequiredService<IFeedService>().GetPostAsync(id, http.RequestAborted);

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapDelete("v1/admin/feed-post/{id}", Handler)
            .Produces(StatusCodes.Status204NoContent)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAdmin(AdminPermissions.ContentManage)
            .Audited("feed_post.retire", "feed_post", "id", Before)
            .WithSummary("Retire an Akış post")
            .WithDescription("Unpublishes and retires the post: it leaves the feed and every saved list.")
            .WithTags("Admin Content");
}

public class GetStories : IEndpoint
{
    private static async Task<IResult> Handler([FromServices] IFeedService feed, CancellationToken ct) => Results.Ok(await feed.ListStoriesAsync(ct));

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapGet("v1/admin/feed-story", Handler)
            .Produces<List<AdminFeedStoryDto>>(StatusCodes.Status200OK)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAdmin(AdminPermissions.ContentManage)
            .WithSummary("Akış stories (admin)")
            .WithDescription("Every story, drafts / expired / retired included, newest publishAt first.")
            .WithTags("Admin Content");
}

public class PutStory : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromBody] FeedStoryInput request,
        [FromServices] IValidator<FeedStoryInput> validator,
        [FromServices] IFeedService feed,
        CancellationToken ct)
    {
        request = request with { Id = id };
        var validation = await validator.ValidateAsync(request, ct);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        var (outcome, story, missing) = await feed.UpsertStoryAsync(request, ct);
        return outcome == CatalogWriteOutcome.ProductNotFound ? StoreResults.MissingProducts(missing) : Results.Ok(story);
    }

    private static async Task<object?> Before(HttpContext http, string id) =>
        (await http.RequestServices.GetRequiredService<IFeedService>().ListStoriesAsync(http.RequestAborted)).FirstOrDefault(s => s.Id == id);

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPut("v1/admin/feed-story/{id}", Handler)
            .Produces<AdminFeedStoryDto>(StatusCodes.Status200OK)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<ProblemDetails>(StatusCodes.Status422UnprocessableEntity)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAdmin(AdminPermissions.ContentManage)
            .Audited("feed_story.upsert", "feed_story", "id", Before)
            .WithSummary("Create or update an Akış story")
            .WithDescription("segment women | men | null; author { name L, imageUrl? }; imageUrl https (required); headline L ≤ 120; productId? (must exist, " +
                             "422 product_not_found); publishAt UTC; expiresAt? (> publishAt); sortOrder; published; retired.")
            .WithTags("Admin Content");
}

public class DeleteStory : IEndpoint
{
    private static async Task<IResult> Handler([FromRoute] string id, [FromServices] IFeedService feed, CancellationToken ct) =>
        await feed.RetireStoryAsync(id, ct) ? Results.NoContent() : StoreResults.NotFound();

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapDelete("v1/admin/feed-story/{id}", Handler)
            .Produces(StatusCodes.Status204NoContent)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAdmin(AdminPermissions.ContentManage)
            .Audited("feed_story.retire", "feed_story")
            .WithSummary("Retire an Akış story")
            .WithTags("Admin Content");
}
