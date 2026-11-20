using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Options;
using Domain.Services.Admin;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace Api.Endpoints.V1.Admin.Ai;

// AI usage and cost (ai.usage.view). docs/api/admin.md §5c. Estimated micro-USD from Ai:Pricing; numbers only.

public class GetUserAiUsage : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromQuery] string? from,
        [FromQuery] string? to,
        [FromServices] IAdminContext admin,
        [FromServices] IAdminAiUsageService usage,
        [FromServices] IOptionsMonitor<AiUsageOptions> options,
        [FromServices] TimeProvider time,
        CancellationToken ct)
    {
        var today = DateOnly.FromDateTime(time.GetUtcNow().UtcDateTime);
        if (!QueryParsing.TryRange(from, to, today, Math.Max(1, options.CurrentValue.MaxRangeDays), out var start, out var end))
            return StoreResults.BadQuery();
        return await usage.GetUserUsageAsync(admin.Admin, id, start, end, admin.Ip, ct) is { } result ? Results.Ok(result) : StoreResults.NotFound();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapGet("v1/admin/user/{id}/ai-usage", Handler)
            .Produces<AdminUserAiUsageDto>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .RequireAdmin(AdminPermissions.AiUsageView)
            .WithSummary("One user's AI usage and estimated cost")
            .WithDescription("from / to = yyyy-MM-dd (UTC, inclusive; default the last 30 days, max AiUsage:MaxRangeDays). Totals, per operation and per model, by day and by month, plus the user's AI jobs of the last 7 days (kind, models, duration, cost, outcome, credits). Audited as user.ai_usage_view.")
            .WithTags("Admin AI");
}

public class GetAiUsageSummary : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromQuery] string? from,
        [FromQuery] string? to,
        [FromServices] IAdminAiUsageService usage,
        [FromServices] IOptionsMonitor<AiUsageOptions> options,
        [FromServices] TimeProvider time,
        CancellationToken ct)
    {
        var today = DateOnly.FromDateTime(time.GetUtcNow().UtcDateTime);
        if (!QueryParsing.TryRange(from, to, today, Math.Max(1, options.CurrentValue.MaxRangeDays), out var start, out var end))
            return StoreResults.BadQuery();
        return Results.Ok(await usage.GetSummaryAsync(start, end, ct));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapGet("v1/admin/ai-usage/summary", Handler)
            .Produces<AdminAiUsageSummaryDto>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status400BadRequest)
            .RequireAdmin(AdminPermissions.AiUsageView)
            .WithSummary("Overall AI cost board")
            .WithDescription("from / to = yyyy-MM-dd (UTC, inclusive; default the last 30 days). Daily cost, per operation / model / plan (active users, cost per active user, share of the net subscription price), top users (masked) and anomaly flags (AiUsage thresholds). Admin trials are counted apart.")
            .WithTags("Admin AI");
}
