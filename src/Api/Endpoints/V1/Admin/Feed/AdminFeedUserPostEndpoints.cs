using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Context;
using Domain.Domain;
using Domain.Services;
using Domain.Services.Admin;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Admin.Feed;

// Akış F2 moderation (moderation.manage): shared looks that were reported or auto-hidden, restore and remove. Audited.

public class GetUserPosts : IEndpoint
{
    private static async Task<IResult> Handler([FromServices] IFeedModeration moderation, CancellationToken ct) => Results.Ok(await moderation.ListAsync(ct));

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapGet("v1/admin/feed-user-post", Handler)
            .Produces<List<AdminFeedUserPostDto>>(StatusCodes.Status200OK)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAdmin(AdminPermissions.ModerationManage)
            .WithSummary("Reported shared looks (Akış)")
            .WithDescription("Shared looks with at least one open report, or taken off the feed automatically (ContentFeed:ReportsToAutoHide distinct reporters). " +
                             "status reported | autoHidden; reporterCount, reasons [{ reason, count }] and reports = the look's open reports; imageUrl = the cover the feed showed " +
                             "(short-lived). Teen-involved first, then auto-hidden, most reported, newest.")
            .WithTags("Admin Moderation");
}

public class PostRestoreUserPost : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromBody] FeedModerationRequest? request,
        [FromServices] IAdminContext adminContext,
        [FromServices] IFeedModeration moderation,
        [FromServices] IAuditLog audit,
        CancellationToken ct)
    {
        if (request?.Note is { Length: > 500 })
            return StoreResults.BadQuery();
        var admin = adminContext.Admin;
        var before = await moderation.GetAsync(id, ct);
        if (await moderation.RestoreAsync(id, admin.Id, request?.Note, ct) != FeedModerationOutcome.Ok)
            return StoreResults.NotFound();
        await audit.WriteAsync(admin, "feed_user_post.restore", "feed_user_post", id, before, new { request?.Note }, adminContext.Ip, ct);
        return Results.NoContent();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPost("v1/admin/feed-user-post/{id}/restore", Handler)
            .Produces(StatusCodes.Status204NoContent)
            .Produces<ProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAdmin(AdminPermissions.ModerationManage)
            .WithSummary("Restore a shared look to the Akış")
            .WithDescription("The look is listed again and its open reports are resolved as dismissed (note ≤ 500 kept on them), so the count towards the next automatic " +
                             "hide starts from zero. Idempotent. 404 not_found (unknown, or un-shared meanwhile). Audited.")
            .WithTags("Admin Moderation");
}

public class PostRemoveUserPost : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromBody] FeedModerationRequest? request,
        [FromServices] IAdminContext adminContext,
        [FromServices] IFeedModeration moderation,
        [FromServices] IAuditLog audit,
        CancellationToken ct)
    {
        if (request?.Note is { Length: > 500 })
            return StoreResults.BadQuery();
        var admin = adminContext.Admin;
        var before = await moderation.GetAsync(id, ct);
        var (outcome, reportId, removal) = await moderation.RemoveAsync(id, admin.Id, request?.Note, ct);
        switch (outcome)
        {
            case FeedModerationOutcome.NotFound:
                return StoreResults.NotFound();
            case FeedModerationOutcome.NotReported:
                return ApiResults.Problem(StatusCodes.Status409Conflict, StoreSocialErrorCodes.FeedPostNotReported);
        }
        await audit.WriteAsync(admin, "feed_user_post.remove", "feed_user_post", id, before, new { request?.Note, ReportId = reportId, removal?.Outcome, Target = removal?.After }, adminContext.Ip, ct);
        return Results.Ok(new ReportCreatedResponse(reportId!));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPost("v1/admin/feed-user-post/{id}/remove", Handler)
            .Produces<ReportCreatedResponse>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .Produces<ProblemDetails>(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAdmin(AdminPermissions.ModerationManage)
            .WithSummary("Remove a shared look")
            .WithDescription("The existing look moderation: the look's open reports are resolved as contentRemoved (note ≤ 500) and the look is hidden from everyone but its " +
                             "owner (feed, closet, saved lists); the owner keeps it with moderation { hidden, reason } and gets the content_removed inbox row. " +
                             "→ { reportId }: the report the removal is recorded on — POST v1/admin/moderation/report/{reportId}/restore undoes it. " +
                             "404 not_found; 409 feed_post_not_reported (no open report to remove it by). Audited.")
            .WithTags("Admin Moderation");
}
