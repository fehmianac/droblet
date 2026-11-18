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

namespace Api.Endpoints.V1.Tenant.PurchasePrompt;

public class Put : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromBody] PurchasePromptAnswerRequest request,
        [FromServices] IApiContext apiContext,
        [FromServices] IAffiliateService affiliate,
        CancellationToken cancellationToken)
    {

        return await affiliate.AnswerPurchasePromptAsync(apiContext.TenantId, id, request.Accepted, cancellationToken) ? Results.NoContent() : StoreResults.NotFound();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPut("v1/tenant/purchase-prompt/{id}", Handler)
            .Produces(StatusCodes.Status204NoContent)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Answer a purchase prompt")
            .WithDescription("accepted=true after the client added the pieces to the wardrobe (item/from-product), false to dismiss. Either way the prompt is not shown again.")
            .WithTags("Tenant Purchase Prompt");
    }
}
