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

namespace Api.Endpoints.V1.Content.SeriesOutfit;

public class GetAll : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromServices] IContentService content,
        CancellationToken cancellationToken)
    {

        return Results.Ok(await content.GetCollectionsAsync(ContentCollectionKind.Series, cancellationToken));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/content/series-outfit", Handler)
            .Produces<List<ContentCollectionDto>>(StatusCodes.Status200OK)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Series outfit collections")
            .WithDescription("Data driven and empty until content is published by an admin (rights / licence: open decision A-7; placeholder names only).")
            .WithTags("Content");
    }
}
