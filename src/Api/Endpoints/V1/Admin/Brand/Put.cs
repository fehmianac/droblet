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

namespace Api.Endpoints.V1.Admin.Brand;

public class Put : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromBody] BrandInput request,
        [FromServices] IValidator<BrandInput> validator,
        [FromServices] ICatalogService catalog,
        CancellationToken cancellationToken)
    {

        request = request with { Id = id };
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        var (_, brand) = await catalog.UpsertBrandAsync(request, cancellationToken);
        return Results.Ok(brand.ToAdminDto());
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPut("v1/admin/brand/{id}", Handler)
            .Produces<AdminBrandDto>(StatusCodes.Status200OK)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(AdminOptions.Policy)
            .WithSummary("Create or update a brand")
            .WithDescription("Upsert by id (the route id wins). source = network | direct; clickIdParameter = the sub-id query parameter of the brand / network; commissionRateBps overrides the Affiliate config.")
            .WithTags("Admin Catalog");
    }
}
