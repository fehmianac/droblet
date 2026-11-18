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

public class PostAnalyze : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] StartPaletteCommand request,
        [FromServices] IApiContext apiContext,
        [FromServices] IPaletteService palette,
        [FromServices] IValidator<StartPaletteCommand> validator,
        HttpContext httpContext,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        return (await palette.StartAsync(apiContext.TenantId, request, httpContext.RequestLanguage(), cancellationToken)).ToHttp($"/v1/tenant/job/{request.RequestId}");
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/tenant/palette/analyze", Handler)
            .Produces<PaletteStartDto>(StatusCodes.Status200OK)
            .Produces<PaletteStartDto>(StatusCodes.Status202Accepted)
            .Problems(StatusCodes.Status403Forbidden, StatusCodes.Status409Conflict, StatusCodes.Status422UnprocessableEntity)
            .Validated()
            .Tenant("Tenant Palette", "Analyse my colour palette", "202 status = queued with the job; 200 status = cached when the current face photo was already analysed. 422 face_photo_required; 403 premium_required.");
    }
}
