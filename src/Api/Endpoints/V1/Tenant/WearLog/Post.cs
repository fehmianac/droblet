using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Context;
using Domain.Domain;
using Domain.Enum;
using Domain.Services;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.WearLog;

public class Post : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] WearLogCommand request,
        [FromServices] IApiContext apiContext,
        [FromServices] IPlanService plan,
        [FromServices] IValidator<WearLogCommand> validator,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        return (await plan.LogWearAsync(apiContext.TenantId, request, cancellationToken)).ToHttp();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/tenant/wear-log", Handler)
            .Produces<WearLogResultDto>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status404NotFound)
            .Problems(StatusCodes.Status422UnprocessableEntity)
            .Validated()
            .Tenant("Tenant WearLog", "Log what was worn (Bunu giyiyorum)", "Either lookId or itemIds. Writes the wear log and increments the wear count of each piece once per calendar day. Idempotent by clientMutationId (a replay returns the same log, nothing is counted twice).");
    }
}
