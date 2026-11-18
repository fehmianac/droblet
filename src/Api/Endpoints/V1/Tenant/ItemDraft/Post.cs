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

namespace Api.Endpoints.V1.Tenant.ItemDraft;

public class Post : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] StartDraftsCommand request,
        [FromServices] IApiContext apiContext,
        [FromServices] IWardrobeService wardrobe,
        [FromServices] IValidator<StartDraftsCommand> validator,
        HttpContext httpContext,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        return (await wardrobe.StartDraftsAsync(apiContext.TenantId, request, httpContext.RequestLanguage(), cancellationToken)).ToHttp("/v1/tenant/item-draft");
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/tenant/item-draft", Handler)
            .Produces<StartDraftsDto>(StatusCodes.Status202Accepted)
            .Problems(StatusCodes.Status403Forbidden, StatusCodes.Status404NotFound, StatusCodes.Status422UnprocessableEntity)
            .Validated()
            .Tenant("Tenant ItemDraft", "Start AI processing of uploaded garment photos", "One draft and one ItemProcessor job per uploaded photo (max 30). splitOutfit = true cuts an outfit photo into one draft per piece. Nothing becomes an item until POST item-draft/confirm.");
    }
}
