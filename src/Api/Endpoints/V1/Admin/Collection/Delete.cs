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

namespace Api.Endpoints.V1.Admin.Collection;

public class Delete : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string kind,
        [FromRoute] string id,
        [FromServices] IContentService content,
        CancellationToken cancellationToken)
    {
        if (!QueryParsing.TryEnum<ContentCollectionKind>(kind, out var parsedKind) || parsedKind is not { } collectionKind)
            return StoreResults.NotFound();

        return await content.RetireCollectionAsync(collectionKind, id, cancellationToken) ? Results.NoContent() : StoreResults.NotFound();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapDelete("v1/admin/collection/{kind}/{id}", Handler)
            .Produces(StatusCodes.Status204NoContent)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAdmin(AdminPermissions.ContentManage)
            .Audited("collection.retire", "collection", "id", AdminAuditBefore.Collection)
            .WithSummary("Retire a content collection")
            .WithDescription("The collection leaves the public list.")
            .WithTags("Admin Content");
    }
}
