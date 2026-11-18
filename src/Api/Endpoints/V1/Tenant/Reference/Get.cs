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

namespace Api.Endpoints.V1.Tenant.Reference;

public class Get : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromQuery] string? language,
        [FromServices] IApiContext apiContext,
        HttpContext httpContext,
        CancellationToken cancellationToken)
    {
        await Task.CompletedTask;
        _ = apiContext;
        return Results.Ok(WardrobeDtoMapper.Reference(language ?? httpContext.RequestLanguage()));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/tenant/reference/wardrobe", Handler)
            .Produces<WardrobeReferenceDto>(StatusCodes.Status200OK)
            .Tenant("Tenant Reference", "Get wardrobe vocabularies", "Colours, fabrics, categories, slot -> category rules, occasions and season types. Names are resolved for ?language= (or Accept-Language), tr fallback.");
    }
}
