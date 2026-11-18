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

        var answer = await affiliate.AnswerPurchasePromptAsync(apiContext.TenantId, id, request.Accepted, cancellationToken);
        if (answer is null)
            return StoreResults.NotFound();
        if (answer.Items.FirstOrDefault(i => i.Outcome == ItemCreateOutcome.Rejected) is { } rejected)
        {
            // Wardrobe limit (or another refusal): nothing is lost — the prompt stays pending.
            return ApiResults.Problem(
                rejected.Code == ErrorCodes.PremiumRequired ? StatusCodes.Status403Forbidden : StatusCodes.Status422UnprocessableEntity,
                rejected.Code ?? ErrorCodes.ValidationFailed);
        }
        return Results.Ok(new PurchasePromptAnswerResponse(answer.Status, answer.Items));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPut("v1/tenant/purchase-prompt/{id}", Handler)
            .Produces<PurchasePromptAnswerResponse>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status403Forbidden)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .Produces<ProblemDetails>(StatusCodes.Status422UnprocessableEntity)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Answer a purchase prompt")
            .WithDescription("accepted=true: the server adds every purchased product to the wardrobe (source = purchase, idempotent — answering twice never adds a piece twice) and returns the created items. accepted=false dismisses. Either way the prompt is not shown again; a refused add (403 premium_required: wardrobe limit) leaves it pending.")
            .WithTags("Tenant Purchase Prompt");
    }
}
