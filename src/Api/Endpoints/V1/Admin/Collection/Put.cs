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

public class Put : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string kind,
        [FromRoute] string id,
        [FromBody] ContentCollectionInput request,
        [FromServices] IValidator<ContentCollectionInput> validator,
        [FromServices] IContentService content,
        CancellationToken cancellationToken)
    {
        if (!QueryParsing.TryEnum<ContentCollectionKind>(kind, out var parsedKind) || parsedKind is not { } collectionKind)
            return StoreResults.NotFound();

        request = request with { Id = id, Kind = collectionKind };
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        var (_, collection) = await content.UpsertCollectionAsync(request, cancellationToken);
        return Results.Ok(collection.ToAdminDto());
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPut("v1/admin/collection/{kind}/{id}", Handler)
            .Produces<AdminCollectionDto>(StatusCodes.Status200OK)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(AdminOptions.Policy)
            .WithSummary("Create or update a content collection")
            .WithDescription("A creator / editor (placeholder name until A-7 closes) or a series-outfit group.")
            .WithTags("Admin Content");
    }
}
