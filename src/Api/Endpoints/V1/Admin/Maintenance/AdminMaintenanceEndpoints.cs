using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Services.Admin;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Admin.Maintenance;

// "Bakım" (maintenance.manage, super admin). docs/api/admin.md §5d, docs/images.md §8. The run itself is processed by the
// item processor worker in resumable batches; these routes start, list, cancel and retry it. Writes are audited.

public sealed record StartPublishItemImagesRequest(bool DryRun);

internal static class MaintenanceResults
{
    private const string Base = "v1/admin/maintenance/publish-item-images";

    public static string Route(string suffix = "") => Base + suffix;

    public static IResult Started(MaintenanceStartResult result) => result.Outcome switch
    {
        MaintenanceStartOutcome.Started => Results.Accepted($"/{Base}/{result.Run!.Id}", result.Run),
        MaintenanceStartOutcome.Active => ApiResults.Problem(StatusCodes.Status409Conflict, ErrorCodes.MaintenanceRunActive),
        MaintenanceStartOutcome.NothingToRetry => ApiResults.Problem(StatusCodes.Status422UnprocessableEntity, ErrorCodes.NothingToRetry),
        _ => ApiResults.Problem(StatusCodes.Status404NotFound, ErrorCodes.NotFound),
    };

    public static RouteHandlerBuilder Maintenance(this RouteHandlerBuilder builder) => builder
        .RequireAdmin(AdminPermissions.MaintenanceManage)
        .WithTags("Admin maintenance");
}

public class PostPublishItemImages : IEndpoint
{
    private static async Task<IResult> Handler([FromBody] StartPublishItemImagesRequest? request, [FromServices] IAdminContext admin,
        [FromServices] IMaintenanceService maintenance, CancellationToken ct) =>
        MaintenanceResults.Started(await maintenance.StartPublishItemImagesAsync(admin.Admin, request?.DryRun ?? true, admin.Ip, ct));

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPost(MaintenanceResults.Route(), Handler)
            .Produces<MaintenanceRunDto>(StatusCodes.Status202Accepted)
            .Produces<ProblemDetails>(StatusCodes.Status409Conflict)
            .Maintenance()
            .WithSummary("Start moving cleaned item images to the public location")
            .WithDescription("Body { dryRun }. Copies cleaned piece images and their 256 / 768 px thumbnails to public/{stage}/items/ (no AI, idempotent), in resumable batches on the item worker. One active run at a time: 409 maintenance_run_active. A dry run only counts. Audited as maintenance.publish_item_images.start.");
}

public class GetPublishItemImagesRuns : IEndpoint
{
    private static async Task<IResult> Handler([FromServices] IMaintenanceService maintenance, CancellationToken ct) =>
        Results.Ok(await maintenance.ListPublishItemImagesAsync(ct));

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapGet(MaintenanceResults.Route(), Handler)
            .Produces<MaintenanceRunsDto>(StatusCodes.Status200OK)
            .Maintenance()
            .WithSummary("Runs of the image move, newest first (≤ 20)");
}

public class GetPublishItemImagesRun : IEndpoint
{
    private static async Task<IResult> Handler([FromRoute] string runId, [FromServices] IMaintenanceService maintenance, CancellationToken ct) =>
        await maintenance.GetPublishItemImagesAsync(runId, ct) is { } run ? Results.Ok(run) : ApiResults.Problem(StatusCodes.Status404NotFound, ErrorCodes.NotFound);

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapGet(MaintenanceResults.Route("/{runId}"), Handler)
            .Produces<MaintenanceRunDto>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .Maintenance()
            .WithSummary("One run with its live counters (poll while queued / running / cancelling)");
}

public class PostCancelPublishItemImages : IEndpoint
{
    private static async Task<IResult> Handler([FromRoute] string runId, [FromServices] IAdminContext admin, [FromServices] IMaintenanceService maintenance,
        CancellationToken ct)
    {
        var result = await maintenance.CancelPublishItemImagesAsync(admin.Admin, runId, admin.Ip, ct);
        return result.Outcome switch
        {
            MaintenanceCancelOutcome.Cancelling => Results.Ok(result.Run),
            MaintenanceCancelOutcome.Finished => ApiResults.Problem(StatusCodes.Status409Conflict, ErrorCodes.MaintenanceRunFinished),
            _ => ApiResults.Problem(StatusCodes.Status404NotFound, ErrorCodes.NotFound),
        };
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPost(MaintenanceResults.Route("/{runId}/cancel"), Handler)
            .Produces<MaintenanceRunDto>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .Produces<ProblemDetails>(StatusCodes.Status409Conflict)
            .Maintenance()
            .WithSummary("Cancel a run (status cancelling until the current batch ends, then cancelled)")
            .WithDescription("409 maintenance_run_finished. Audited as maintenance.publish_item_images.cancel.");
}

public class PostRetryFailedPublishItemImages : IEndpoint
{
    private static async Task<IResult> Handler([FromRoute] string runId, [FromServices] IAdminContext admin, [FromServices] IMaintenanceService maintenance,
        CancellationToken ct) =>
        MaintenanceResults.Started(await maintenance.RetryFailedPublishItemImagesAsync(admin.Admin, runId, admin.Ip, ct));

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPost(MaintenanceResults.Route("/{runId}/retry-failed"), Handler)
            .Produces<MaintenanceRunDto>(StatusCodes.Status202Accepted)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .Produces<ProblemDetails>(StatusCodes.Status409Conflict)
            .Produces<ProblemDetails>(StatusCodes.Status422UnprocessableEntity)
            .Maintenance()
            .WithSummary("Start a new run over the failed pieces of a run")
            .WithDescription("retryOf = the run. 409 maintenance_run_active, 422 nothing_to_retry. Audited as maintenance.publish_item_images.retry_failed.");
}
