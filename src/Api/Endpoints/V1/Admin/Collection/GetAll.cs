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

public class GetAll : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string kind,
        [FromServices] IContentService content,
        CancellationToken cancellationToken)
    {
        if (!QueryParsing.TryEnum<ContentCollectionKind>(kind, out var parsedKind) || parsedKind is not { } collectionKind)
            return StoreResults.NotFound();

        return Results.Ok((await content.ListCollectionsAsync(collectionKind, cancellationToken)).Select(c => c.ToAdminDto()).ToList());
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/admin/collection/{kind}", Handler)
            .Produces<List<AdminCollectionDto>>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAdmin(AdminPermissions.ContentManage)
            .WithSummary("Content collections (admin)")
            .WithDescription("kind = creator | series.")
            .WithTags("Admin Content");
    }
}
