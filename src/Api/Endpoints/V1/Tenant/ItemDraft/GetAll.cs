using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Context;
using Domain.Domain;
using Domain.Enum;
using Domain.Services;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.ItemDraft;

public class GetAll : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromServices] IApiContext apiContext,
        [FromServices] IWardrobeService wardrobe,
        CancellationToken cancellationToken)
    {
        return Results.Ok(await wardrobe.GetDraftsAsync(apiContext.TenantId, cancellationToken));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/tenant/item-draft", Handler)
            .Produces<ItemDraftsDto>(StatusCodes.Status200OK)
            .Tenant("Tenant ItemDraft", "Get pending item drafts", "Drafts with status, AI suggestions and flagged fields, plus processed / total for the progress card. needsReview = Kategoriyi kontrol et.");
    }
}
