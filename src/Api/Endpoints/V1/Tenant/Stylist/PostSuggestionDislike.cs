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

public class PostSuggestionDislike : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string jobId,
        [FromRoute] int index,
        [FromBody] DislikeCommand request,
        [FromServices] IApiContext apiContext,
        [FromServices] IStylistService stylist,
        [FromServices] IValidator<DislikeCommand> validator,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        return (await stylist.DislikeAsync(apiContext.TenantId, jobId, index, request, cancellationToken)).ToHttp();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/tenant/stylist/suggestion/{jobId}/{index:int}/dislike", Handler)
            .Produces(StatusCodes.Status204NoContent)
            .Problems(StatusCodes.Status404NotFound)
            .Validated()
            .Tenant("Tenant Stylist", "Dislike a suggestion", "Screen 17 Begenmedim: stores the combination and a reason; later prompts are told to avoid it.");
    }
}
