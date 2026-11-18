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

public class Put : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromBody] UpdateLookCommand request,
        [FromServices] IApiContext apiContext,
        [FromServices] ILookService looks,
        [FromServices] IValidator<UpdateLookCommand> validator,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        return (await looks.UpdateAsync(apiContext.TenantId, id, request, cancellationToken)).ToHttp();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPut("v1/tenant/look/{id}", Handler)
            .Produces<LookDto>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status404NotFound)
            .Produces<LookDto>(StatusCodes.Status409Conflict)
            .Problems(StatusCodes.Status422UnprocessableEntity)
            .Validated()
            .Tenant("Tenant Look", "Update look", "Name, occasion, slots and favourite if baseVersion matches; 409 carries the current look.");
    }
}
