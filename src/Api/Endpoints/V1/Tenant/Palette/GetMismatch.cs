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

public class GetMismatch : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromServices] IApiContext apiContext,
        [FromServices] IPaletteService palette,
        CancellationToken cancellationToken)
    {
        var result = await palette.GetMismatchAsync(apiContext.TenantId, cancellationToken);
        return result is null ? ApiResults.Problem(StatusCodes.Status404NotFound, ErrorCodes.PaletteNotFound) : Results.Ok(result);
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/tenant/palette/mismatch", Handler)
            .Produces<PaletteMismatchDto>(StatusCodes.Status200OK)
            .Problems(StatusCodes.Status404NotFound)
            .Tenant("Tenant Palette", "Get wardrobe pieces that clash with my palette", "Uyumsuz parcalari gor: pieces whose main colour is one of the tones to avoid.");
    }
}
