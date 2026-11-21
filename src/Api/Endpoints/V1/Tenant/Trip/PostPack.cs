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

public class PostPack : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromBody] StartPackCommand request,
        [FromServices] IApiContext apiContext,
        [FromServices] ITripService trips,
        [FromServices] IValidator<StartPackCommand> validator,
        HttpContext httpContext,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        return (await trips.StartPackAsync(apiContext.TenantId, id, request, httpContext.RequestLanguage(), cancellationToken)).ToHttp($"/v1/tenant/job/{request.RequestId}");
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/tenant/trip/{id}/pack", Handler)
            .Produces<JobDto>(StatusCodes.Status202Accepted)
            .Problems(StatusCodes.Status403Forbidden, StatusCodes.Status404NotFound, StatusCodes.Status409Conflict)
            .Validated()
            .Tenant("Tenant Trip", "Build the suitcase", "Queues a job that drafts the packing list and the daily looks (PackingRules: every piece worn at least twice except on 1-day trips; cabin limit). Membership required — teens: Teen:Stylist:TripPackPerWeek (0 by default → 403 teen_stylist_unavailable). Poll GET v1/tenant/job/{requestId}.");
    }
}
