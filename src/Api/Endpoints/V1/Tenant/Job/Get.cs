using Api.Infrastructure.Contract;
using Domain.Constant;
using Domain.Context;
using Domain.Domain;
using Domain.Entity;
using Domain.Enum;
using Domain.Manager;
using Domain.Services;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.Job;

public class Get : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromServices] IApiContext apiContext,
        [FromServices] IRepository repository,
        [FromServices] IJobEtaProvider eta,
        [FromServices] TimeProvider timeProvider,
        CancellationToken cancellationToken)
    {
        var job = await repository.GetAsync<JobEntity>(JobEntity.GetPk(apiContext.TenantId), JobEntity.GetSk(id), cancellationToken);
        if (job is null)
            return Results.NotFound();
        if (job.Status is JobStatus.Completed or JobStatus.Failed)
            return Results.Ok(job.ToDto());
        return Results.Ok(job.ToDto(await eta.TypicalMsAsync(job.Kind, cancellationToken), timeProvider.GetUtcNow().UtcDateTime));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/tenant/job/{id}", Handler)
            .Produces<JobDto>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Get job status")
            .WithDescription("Status of a long-running job started with a 202 (queued | processing | completed | failed) and its draft result. " +
                             "While running: etaMs (expected remaining time from recent jobs of this kind, null when unknown) and retryAfterMs " +
                             "(when to poll next, 500..3000 ms). timings: the worker's stage timings in ms (internal diagnostics).")
            .WithTags("Tenant Job");
    }
}
