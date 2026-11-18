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

namespace Api.Endpoints.V1.Content.Creator;

public class GetLooks : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromServices] IContentService content,
        CancellationToken cancellationToken)
    {

        var looks = await content.GetCollectionLooksAsync(ContentCollectionKind.Creator, id, cancellationToken);
        return looks is null ? StoreResults.NotFound() : Results.Ok(looks);
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/content/creator/{id}/look", Handler)
            .Produces<List<ContentLookDto>>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Creator / influencer looks")
            .WithDescription("Looks of one collection with their shoppable product rows and total.")
            .WithTags("Content");
    }
}
