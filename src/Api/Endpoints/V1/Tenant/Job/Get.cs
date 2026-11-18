using Api.Infrastructure.Contract;
using Domain.Constant;
using Domain.Context;
using Domain.Domain;
using Domain.Entity;
using Domain.Manager;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.Job;

public class Get : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromServices] IApiContext apiContext,
        [FromServices] IRepository repository,
        CancellationToken cancellationToken)
    {
        var job = await repository.GetAsync<JobEntity>(JobEntity.GetPk(apiContext.TenantId), JobEntity.GetSk(id), cancellationToken);
        return job is null ? Results.NotFound() : Results.Ok(job.ToDto());
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/tenant/job/{id}", Handler)
            .Produces<JobDto>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Get job status")
            .WithDescription("Status of a long-running job started with a 202 (queued | processing | completed | failed) and its draft result.")
            .WithTags("Tenant Job");
    }
}
