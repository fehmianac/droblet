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

public class PostLine : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] AddCartLinesRequest request,
        [FromServices] IValidator<AddCartLinesRequest> validator,
        [FromServices] IApiContext apiContext,
        [FromServices] ICartService cart,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        var lines = request.Lines!.Select(l => new CartLineInput(l.ClientMutationId, l.ProductId, l.Size, l.Look?.ToDto())).ToList();
        var result = await cart.AddLinesAsync(apiContext.TenantId, lines, cancellationToken);
        return StoreResults.CartError(result.Outcome) ?? Results.Ok(result.Cart);
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/tenant/cart/line", Handler)
            .Produces<CartDto>(StatusCodes.Status200OK)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .Produces<ProblemDetails>(StatusCodes.Status422UnprocessableEntity)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Add cart lines")
            .WithDescription("One or many lines (single add, \"Look'u satın al\", \"N ürünü satın al\"). All or nothing. Re-adding the same product + size keeps the existing line, so replays are safe.")
            .WithTags("Tenant Cart");
    }
}
