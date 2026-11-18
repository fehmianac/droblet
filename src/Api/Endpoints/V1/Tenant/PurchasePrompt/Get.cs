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

public class Get : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromServices] IApiContext apiContext,
        [FromServices] IAffiliateService affiliate,
        CancellationToken cancellationToken)
    {

        return Results.Ok(await affiliate.GetPurchasePromptsAsync(apiContext.TenantId, cancellationToken));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/tenant/purchase-prompt", Handler)
            .Produces<List<PurchasePromptDto>>(StatusCodes.Status200OK)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Pending \"add to wardrobe?\" prompts")
            .WithDescription("One per recorded purchase (conversion) whose products are known and that the user has not answered yet.")
            .WithTags("Tenant Purchase Prompt");
    }
}
