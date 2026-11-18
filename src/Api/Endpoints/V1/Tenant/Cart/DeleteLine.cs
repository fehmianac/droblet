using System.Text.Json;
using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Context;
using Domain.Domain;
using Domain.Entity;
using Domain.Enum;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Domain.Validation;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace Api.Endpoints.V1.Tenant.Cart;

public class DeleteLine : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string lineId,
        [FromServices] IApiContext apiContext,
        [FromServices] ICartService cart,
        CancellationToken cancellationToken)
    {

        return await cart.RemoveLineAsync(apiContext.TenantId, lineId, cancellationToken) ? Results.NoContent() : StoreResults.NotFound();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapDelete("v1/tenant/cart/line/{lineId}", Handler)
            .Produces(StatusCodes.Status204NoContent)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Remove a cart line")
            .WithDescription("404 when the line is already gone.")
            .WithTags("Tenant Cart");
    }
}
