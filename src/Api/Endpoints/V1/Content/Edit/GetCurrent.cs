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

namespace Api.Endpoints.V1.Content.Edit;

public class GetCurrent : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromServices] IApiContext apiContext,
        [FromServices] IRepository repository,
        [FromServices] IContentService content,
        CancellationToken cancellationToken)
    {

        var tenant = await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(apiContext.TenantId), cancellationToken);
        var edit = await content.GetCurrentEditAsync(tenant?.Segment ?? Segment.Women, cancellationToken);
        return edit is null ? StoreResults.NotFound() : Results.Ok(edit);
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/content/edit/current", Handler)
            .Produces<EditDto>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Current weekly edit")
            .WithDescription("The latest published edit of the user's segment whose week has started: 7 looks, price-band variants with product rows and totals, sponsored flag. Text in the request language. 404 not_found when none is published.")
            .WithTags("Content");
    }
}
