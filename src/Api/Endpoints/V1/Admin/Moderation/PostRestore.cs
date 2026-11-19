using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Context;
using Domain.Services;
using Domain.Services.Admin;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Admin.Moderation;

public class PostRestore : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromServices] IAdminContext adminContext,
        [FromServices] ISocialService social,
        [FromServices] IContentModeration moderation,
        [FromServices] IAuditLog audit,
        CancellationToken cancellationToken)
    {
        var admin = adminContext.Admin;
        var result = await moderation.RestoreAsync(id, admin.Id, cancellationToken);
        switch (result.Outcome)
        {
            case ContentModerationOutcome.ReportNotFound:
                return StoreResults.NotFound();
            case ContentModerationOutcome.ReportNotResolved:
                return ApiResults.Problem(StatusCodes.Status409Conflict, StoreSocialErrorCodes.ReportNotResolved);
            case ContentModerationOutcome.NotContentRemoved:
                return ApiResults.Problem(StatusCodes.Status409Conflict, StoreSocialErrorCodes.ReportNotContentRemoved);
            case ContentModerationOutcome.Applied:
                await audit.WriteAsync(admin, "report.contentRestore", "report", id, result.Before, result.After, adminContext.Ip, cancellationToken);
                break;
        }

        var report = await social.GetReportAsync(id, cancellationToken);
        return report is null ? StoreResults.NotFound() : Results.Ok(report);
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/admin/moderation/report/{id}/restore", Handler)
            .Produces<ModerationReportDto>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .Produces<ProblemDetails>(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAdmin(AdminPermissions.ModerationManage)
            .WithSummary("Restore removed content")
            .WithDescription("Undo of a contentRemoved decision (a resolved report cannot be reopened): the look / item / profile fields become visible to others again " +
                             "and the report records contentRestoredAt / contentRestoredByUserId. The report stays resolved. Idempotent: a second call changes nothing. " +
                             "404 not_found; 409 report_not_resolved (still open) / report_not_content_removed (another resolution). Audited (before / after).")
            .WithTags("Admin Moderation");
    }
}
