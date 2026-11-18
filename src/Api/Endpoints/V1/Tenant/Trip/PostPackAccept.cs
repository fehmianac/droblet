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

namespace Api.Endpoints.V1.Tenant.Trip;

public class PostPackAccept : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromRoute] string jobId,
        [FromBody] AcceptPackCommand request,
        [FromServices] IApiContext apiContext,
        [FromServices] ITripService trips,
        [FromServices] IValidator<AcceptPackCommand> validator,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        return (await trips.AcceptPackAsync(apiContext.TenantId, id, jobId, request, cancellationToken)).ToHttp();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/tenant/trip/{id}/pack/{jobId}/accept", Handler)
            .Produces<TripDetailDto>(StatusCodes.Status200OK)
            .Problems(StatusCodes.Status404NotFound, StatusCodes.Status409Conflict)
            .Validated()
            .Tenant("Tenant Trip", "Accept the suitcase draft", "Writes the drafted list and daily looks to the trip (re-validated by PackingRules). Idempotent by clientMutationId. Pieces already ticked stay ticked.");
    }
}
