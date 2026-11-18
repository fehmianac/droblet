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

namespace Api.Endpoints.V1.Tenant.TryOn;

public class Get : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromServices] IApiContext apiContext,
        [FromServices] ITryOnService tryOn,
        CancellationToken cancellationToken)
    {
        var image = await tryOn.GetAsync(apiContext.TenantId, id, cancellationToken);
        return image is null ? Results.NotFound() : Results.Ok(image);
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/tenant/tryon/{id}", Handler)
            .Produces<TryOnImageDto>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status404NotFound)
            .Tenant("Tenant TryOn", "Get a try-on image", "Image metadata and a short-lived presigned GET. Owner only: another tenant always gets 404.");
    }
}
