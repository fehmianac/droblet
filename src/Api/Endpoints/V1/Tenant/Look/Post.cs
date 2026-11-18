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

namespace Api.Endpoints.V1.Tenant.Look;

public class Post : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] CreateLookCommand request,
        [FromServices] IApiContext apiContext,
        [FromServices] ILookService looks,
        [FromServices] IValidator<CreateLookCommand> validator,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        return (await looks.CreateAsync(apiContext.TenantId, request, cancellationToken)).ToHttp($"/v1/tenant/look/{request.Id}");
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/tenant/look", Handler)
            .Produces<LookDto>(StatusCodes.Status200OK)
            .Produces<LookDto>(StatusCodes.Status201Created)
            .Problems(StatusCodes.Status422UnprocessableEntity)
            .Validated()
            .Tenant("Tenant Look", "Create look", "Client-generated id (ULID). 5 slots, each a wardrobe item or a catalog product (missing piece), at least 2 pieces; a dress fills top and closes bottom. Sending the same id again returns the stored look (200).");
    }
}
