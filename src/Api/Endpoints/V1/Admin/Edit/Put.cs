using Domain.Services.Admin;
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

namespace Api.Endpoints.V1.Admin.Edit;

public class Put : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromBody] WeeklyEditInput request,
        [FromServices] IValidator<WeeklyEditInput> validator,
        [FromServices] IContentService content,
        CancellationToken cancellationToken)
    {

        request = request with { Id = id };
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        var (outcome, edit, missing) = await content.UpsertEditAsync(request, cancellationToken);
        return outcome == CatalogWriteOutcome.ProductNotFound ? StoreResults.MissingProducts(missing) : Results.Ok(edit!.ToAdminDto());
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPut("v1/admin/edit/{id}", Handler)
            .Produces<AdminEditDto>(StatusCodes.Status200OK)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<ProblemDetails>(StatusCodes.Status422UnprocessableEntity)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAdmin(AdminPermissions.ContentManage)
            .Audited("edit.upsert", "edit", "id", AdminAuditBefore.Edit)
            .WithSummary("Create or update a weekly edit")
            .WithDescription("weekStart must be a Monday. published=true requires exactly 7 looks (days 1–7), each with 1–2 price-band variants. Every referenced product must exist (422 product_not_found + productIds). sponsorBrandId / sponsorName set the sponsored flag.")
            .WithTags("Admin Content");
    }
}
