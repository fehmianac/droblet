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

namespace Api.Endpoints.V1.Admin.Report;

public class GetRevenue : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromQuery] string? from,
        [FromQuery] string? to,
        [FromServices] IAffiliateService affiliate,
        [FromServices] TimeProvider timeProvider,
        CancellationToken cancellationToken)
    {

        var today = DateOnly.FromDateTime(timeProvider.GetUtcNow().UtcDateTime);
        if (!QueryParsing.TryRange(from, to, today, maxDays: 366, out var start, out var end))
            return StoreResults.BadQuery();

        return Results.Ok(await affiliate.GetRevenueReportAsync(start, end, cancellationToken));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/admin/report/revenue", Handler)
            .Produces<RevenueReport>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAdmin(AdminPermissions.AnalyticsView)
            .WithSummary("Conversion / revenue report")
            .WithDescription("from / to = yyyy-MM-dd (UTC, inclusive; default last 30 days, max 366). GMV and commission (kuruş, TRY) in total, by brand, by look (\"edit:<id>\", \"collection:<id>\", \"user:<id>\", \"none\") and by source. Rejected conversions are counted separately and add no money.")
            .WithTags("Admin Report");
    }
}
