using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Domain;
using Domain.Options;
using Domain.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace Api.Endpoints.V1.Config;

public class Get : IEndpoint
{
    private static IResult Handler(
        [FromServices] IOptionsMonitor<SegmentOptions> segments,
        HttpContext httpContext)
    {
        var language = Localized.Language(null, httpContext.RequestLanguage());
        return Results.Ok(AppConfigDto.Build(segments.CurrentValue, language, v => StartupExtensions.EnumNaming.ConvertName(v.ToString())));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/config", Handler)
            .Produces<AppConfigDto>(StatusCodes.Status200OK)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .AllowAnonymous()
            .WithSummary("App configuration: open segments and the per segment choices")
            .WithDescription("No sign-in needed (onboarding). segments.available = the segments a user may choose now (Segments:Available; the others are shown as \"Yakında\"; teen is never open). " +
                             "bodyTypes / styleTags / subcategories are keyed by segment (women, men): ids with their names in the Accept-Language (tr fallback). " +
                             "Sub-types only filter the pickers: item writes accept any id.")
            .WithTags("Config");
    }
}
