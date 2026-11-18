using Domain.Services.Admin;
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

namespace Api.Endpoints.V1.Admin.Moderation;

public class PostResolve : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromBody] ResolveReportRequest request,
        [FromServices] IValidator<ResolveReportRequest> validator,
        [FromServices] IAdminContext adminContext,
        [FromServices] ISocialService social,
        [FromServices] IAdminAppUserService users,
        [FromServices] IAuditLog audit,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        var admin = adminContext.Admin;
        var report = await social.ResolveReportAsync(id, request.Resolution, request.Note, admin.Id, cancellationToken);
        if (report is null)
            return StoreResults.NotFound();

        // "Block" in the panel = userSuspended: the reported account is suspended as well (idempotent).
        if (report.Resolution == ReportResolution.UserSuspended && request.Resolution == ReportResolution.UserSuspended)
        {
            var reason = $"report:{report.Id}:{report.Reason}" + (string.IsNullOrWhiteSpace(request.Note) ? "" : $" {request.Note.Trim()}");
            await users.SuspendTenantOwnerAsync(admin, report.TargetTenantId, reason.Length > 500 ? reason[..500] : reason, adminContext.Ip, cancellationToken);
        }
        await audit.WriteAsync(admin, "report.resolve", "report", report.Id, null, new { request.Resolution, request.Note }, adminContext.Ip, cancellationToken);
        return Results.Ok(report);
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/admin/moderation/report/{id}/resolve", Handler)
            .Produces<ModerationReportDto>(StatusCodes.Status200OK)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAdmin(AdminPermissions.ModerationManage)
            .WithSummary("Resolve a report")
            .WithDescription("resolution = dismissed | contentRemoved | userWarned | userSuspended. Records the decision; an already resolved report is returned unchanged. userSuspended (panel: Block) also suspends the reported account.")
            .WithTags("Admin Moderation");
    }
}
