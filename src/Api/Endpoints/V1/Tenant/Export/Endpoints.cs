using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Context;
using Domain.Services;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.Export;

// "Verilerimi indir" (KVKK m.11 / GDPR art.15 + 20). docs/api/verification-export.md §2.

public class Post : IEndpoint
{
    public const string InProgress = "export_in_progress";
    public const string RateLimited = "export_rate_limited";

    private static async Task<IResult> Handler(
        [FromServices] IApiContext apiContext,
        [FromServices] IDataExportService exports,
        HttpContext httpContext,
        CancellationToken cancellationToken)
    {
        var result = await exports.StartAsync(apiContext.TenantId, apiContext.UserId, httpContext.Language(), cancellationToken);
        return result.Outcome switch
        {
            DataExportStartOutcome.Started => Results.Accepted("/v1/tenant/export", result.State),
            DataExportStartOutcome.InProgress => WithState(ApiResults.Problem(StatusCodes.Status409Conflict, InProgress), result.State),
            _ => WithState(ApiResults.Problem(StatusCodes.Status429TooManyRequests, RateLimited), result.State),
        };
    }

    private static IResult WithState(Microsoft.AspNetCore.Http.HttpResults.ProblemHttpResult problem, DataExportStateDto state)
    {
        if (state.NextRequestAt is { } next)
            problem.ProblemDetails.Extensions["nextRequestAt"] = next;
        return problem;
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPost("v1/tenant/export", Handler)
            .Produces<DataExportStateDto>(StatusCodes.Status202Accepted)
            .Problems(StatusCodes.Status409Conflict, StatusCodes.Status429TooManyRequests)
            .Tenant("Tenant Export", "Request a copy of my data",
                "Starts the data export (a ZIP of every stored record as JSON plus the user's photos and generated images). " +
                "202 with the state (export.status = queued). When ready (usually minutes) an inbox row data_export_ready and an " +
                "e-mail with a download link arrive; the file is kept 7 days. One active export at a time: 409 export_in_progress. " +
                "One per day (a failed one does not count): 429 export_rate_limited with nextRequestAt.");
}

public class Get : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromServices] IApiContext apiContext,
        [FromServices] IDataExportService exports,
        CancellationToken cancellationToken) =>
        Results.Ok(await exports.GetStateAsync(apiContext.TenantId, cancellationToken));

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapGet("v1/tenant/export", Handler)
            .Produces<DataExportStateDto>(StatusCodes.Status200OK)
            .Tenant("Tenant Export", "My data export",
                "The latest export (null = none yet): status queued | processing | ready | failed | expired, sizes, and while ready a " +
                "10-minute presigned downloadUrl. canRequest / nextRequestAt say whether a new export may be started.");
}

public class GetDownload : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromQuery] string? token,
        [FromServices] IDataExportService exports,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(token) || token.Length > 200)
            return ApiResults.Problem(StatusCodes.Status404NotFound, Domain.Constant.ErrorCodes.NotFound);
        var (outcome, url) = await exports.ResolveDownloadAsync(token, cancellationToken);
        return outcome switch
        {
            DataExportDownloadOutcome.Ready => Results.Redirect(url!),
            DataExportDownloadOutcome.Expired => ApiResults.Problem(StatusCodes.Status410Gone, "export_expired"),
            _ => ApiResults.Problem(StatusCodes.Status404NotFound, Domain.Constant.ErrorCodes.NotFound),
        };
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapGet("v1/export/download", Handler)
            .Produces(StatusCodes.Status302Found)
            .Problems(StatusCodes.Status404NotFound, StatusCodes.Status410Gone)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .AllowAnonymous()
            .WithSummary("Download a data export (e-mailed link)")
            .WithDescription("The token from the data export e-mail. 302 to a 10-minute presigned GET of the ZIP; 410 export_expired after 7 days; 404 otherwise.")
            .WithTags("Tenant Export");
}
