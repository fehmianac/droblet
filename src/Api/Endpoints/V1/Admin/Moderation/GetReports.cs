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

public class GetReports : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromQuery] string? status,
        [FromQuery] string? pageToken,
        [FromQuery] int? limit,
        [FromServices] ISocialService social,
        CancellationToken cancellationToken)
    {

        if (!QueryParsing.TryEnum<ReportStatus>(status, out var parsedStatus))
            return StoreResults.BadQuery();

        return Results.Ok(await social.ListReportsAsync(parsedStatus ?? ReportStatus.Open, pageToken, limit, cancellationToken));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/admin/moderation/report", Handler)
            .Produces<PagedDto<ModerationReportDto>>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAdmin(AdminPermissions.ModerationManage)
            .WithSummary("Moderation queue")
            .WithDescription("status = open (default) | resolved, newest first.")
            .WithTags("Admin Moderation");
    }
}
