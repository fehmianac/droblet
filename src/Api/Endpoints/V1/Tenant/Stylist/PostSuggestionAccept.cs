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

namespace Api.Endpoints.V1.Tenant.Stylist;

public class PostSuggestionAccept : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string jobId,
        [FromRoute] int index,
        [FromBody] AcceptSuggestionCommand request,
        [FromServices] IApiContext apiContext,
        [FromServices] IStylistService stylist,
        [FromServices] IValidator<AcceptSuggestionCommand> validator,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        return (await stylist.AcceptSuggestionAsync(apiContext.TenantId, jobId, index, request, cancellationToken)).ToHttp();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/tenant/stylist/suggestion/{jobId}/{index:int}/accept", Handler)
            .Produces<AcceptedSuggestionDto>(StatusCodes.Status200OK)
            .Problems(StatusCodes.Status404NotFound, StatusCodes.Status409Conflict)
            .Validated()
            .Tenant("Tenant Stylist", "Accept a suggestion", "Saves suggestion {index} of a completed outfit job as a Look (source = stylist) and, with planDate, plans it on that day (Takvime ekle). Idempotent by clientMutationId. 409 suggestion_stale if a piece was deleted meanwhile.");
    }
}
