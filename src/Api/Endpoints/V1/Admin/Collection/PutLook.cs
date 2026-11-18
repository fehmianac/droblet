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

namespace Api.Endpoints.V1.Admin.Collection;

public class PutLook : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string kind,
        [FromRoute] string id,
        [FromRoute] string lookId,
        [FromBody] ContentLookInput request,
        [FromServices] IValidator<ContentLookInput> validator,
        [FromServices] IContentService content,
        CancellationToken cancellationToken)
    {
        if (!QueryParsing.TryEnum<ContentCollectionKind>(kind, out var parsedKind) || parsedKind is not { } collectionKind)
            return StoreResults.NotFound();

        request = request with { Id = lookId };
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        var (outcome, look, missing) = await content.UpsertCollectionLookAsync(collectionKind, id, request, cancellationToken);
        return outcome switch
        {
            CatalogWriteOutcome.NotFound => StoreResults.NotFound(),
            CatalogWriteOutcome.ProductNotFound => StoreResults.MissingProducts(missing),
            _ => Results.Ok(look!.ToAdminDto()),
        };
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPut("v1/admin/collection/{kind}/{id}/look/{lookId}", Handler)
            .Produces<AdminCollectionLookDto>(StatusCodes.Status200OK)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .Produces<ProblemDetails>(StatusCodes.Status422UnprocessableEntity)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(AdminOptions.Policy)
            .WithSummary("Create or update a collection look")
            .WithDescription("The collection must exist; every product id must exist (422 product_not_found + productIds).")
            .WithTags("Admin Content");
    }
}
