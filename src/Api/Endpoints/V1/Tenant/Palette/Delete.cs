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

namespace Api.Endpoints.V1.Tenant.Palette;

public class Delete : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromServices] IApiContext apiContext,
        [FromServices] IPaletteService palette,
        CancellationToken cancellationToken)
    {
        await palette.DeleteAsync(apiContext.TenantId, cancellationToken);
        return Results.NoContent();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapDelete("v1/tenant/palette", Handler)
            .Produces(StatusCodes.Status204NoContent)
            .Tenant("Tenant Palette", "Delete my palette result", "Removes the stored palette (idempotent).");
    }
}
