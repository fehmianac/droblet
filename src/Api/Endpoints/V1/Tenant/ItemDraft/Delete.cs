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

public class Delete : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromServices] IApiContext apiContext,
        [FromServices] IWardrobeService wardrobe,
        CancellationToken cancellationToken)
    {
        return await wardrobe.DeleteDraftAsync(apiContext.TenantId, id, cancellationToken) ? Results.NoContent() : Results.NotFound();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapDelete("v1/tenant/item-draft/{id}", Handler)
            .Produces(StatusCodes.Status204NoContent)
            .Produces(StatusCodes.Status404NotFound)
            .Tenant("Tenant ItemDraft", "Discard an item draft", "Deletes the draft and its S3 objects.");
    }
}
