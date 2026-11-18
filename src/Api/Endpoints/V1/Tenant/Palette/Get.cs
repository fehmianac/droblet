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

public class Get : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromServices] IApiContext apiContext,
        [FromServices] IPaletteService palette,
        HttpContext httpContext,
        CancellationToken cancellationToken)
    {
        var result = await palette.GetAsync(apiContext.TenantId, httpContext.RequestLanguage(), cancellationToken);
        return result is null ? ApiResults.Problem(StatusCodes.Status404NotFound, ErrorCodes.PaletteNotFound) : Results.Ok(result);
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/tenant/palette", Handler)
            .Produces<PaletteDto>(StatusCodes.Status200OK)
            .Problems(StatusCodes.Status404NotFound)
            .Tenant("Tenant Palette", "Get my colour palette", "Season type, flattering and avoid tones (names in the profile language) and the wardrobe compatibility percentage (rule-based, computed on read).");
    }
}
