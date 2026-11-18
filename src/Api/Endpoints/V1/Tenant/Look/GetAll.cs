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

public class GetAll : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromServices] IApiContext apiContext,
        [FromServices] ILookService looks,
        CancellationToken cancellationToken)
    {
        return Results.Ok(await looks.GetAllAsync(apiContext.TenantId, cancellationToken));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/tenant/look", Handler)
            .Produces<List<LookDto>>(StatusCodes.Status200OK)
            .Tenant("Tenant Look", "Get looks", "Lookbook, newest first. Filters (favourite, occasion) are applied on the device.");
    }
}
