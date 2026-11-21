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

namespace Api.Endpoints.V1.Tenant.Library;

public class GetAll : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromServices] IApiContext apiContext,
        [FromServices] IWardrobeService wardrobe,
        HttpContext httpContext,
        CancellationToken cancellationToken)
    {
        return Results.Ok(await wardrobe.GetLibraryAsync(apiContext.TenantId, httpContext.RequestLanguage(), cancellationToken));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/tenant/library/item", Handler)
            .Produces<List<LibraryItemDto>>(StatusCodes.Status200OK)
            .Tenant("Tenant Library", "Get the ready-made library", "Global library pieces (screen 12b, onboarding 04b) of the user's segment plus unisex ones (style profile; women when never chosen). Names are resolved in the profile language (Accept-Language fallback, then tr). imageUrl null = no image yet (men's starter set): show the garment placeholder.");
    }
}
