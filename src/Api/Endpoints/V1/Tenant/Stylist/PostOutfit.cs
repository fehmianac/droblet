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

public class PostOutfit : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] StartOutfitCommand request,
        [FromServices] IApiContext apiContext,
        [FromServices] IStylistService stylist,
        [FromServices] IValidator<StartOutfitCommand> validator,
        HttpContext httpContext,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        return (await stylist.StartOutfitAsync(apiContext.TenantId, request, httpContext.RequestLanguage(), cancellationToken)).ToHttp($"/v1/tenant/job/{request.RequestId}");
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/tenant/stylist/outfit", Handler)
            .Produces<JobDto>(StatusCodes.Status202Accepted)
            .Problems(StatusCodes.Status403Forbidden, StatusCodes.Status409Conflict, StatusCodes.Status422UnprocessableEntity)
            .Validated()
            .Tenant("Tenant Stylist", "Ask the stylist for outfit suggestions", "Queues a job that returns 3 suggestions built only from the wardrobe (free text + occasion + onlyMyWardrobe + optional pinned piece). Text stylist costs no credit; membership required. Poll GET v1/tenant/job/{requestId}.");
    }
}
