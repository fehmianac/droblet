using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Context;
using Domain.Domain;
using Infrastructure.Services;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.Entitlement;

internal static class SelfPremiumResults
{
    public static async Task<IResult> From(SelfPremiumOutcome outcome, SelfServePremiumService selfPremium, string tenantId, CancellationToken ct) => outcome switch
    {
        SelfPremiumOutcome.Disabled => ApiResults.Problem(StatusCodes.Status403Forbidden, ErrorCodes.SelfPremiumDisabled),
        SelfPremiumOutcome.StoreSubscriptionActive => ApiResults.Problem(StatusCodes.Status409Conflict, ErrorCodes.StoreSubscriptionActive),
        _ => Results.Ok(await selfPremium.EntitlementAsync(tenantId, ct)),
    };
}

public class PostSelfPremium : IEndpoint
{
    private static async Task<IResult> Handler(
        HttpContext http,
        [FromServices] IApiContext apiContext,
        [FromServices] SelfServePremiumService selfPremium,
        CancellationToken cancellationToken)
    {
        var outcome = await selfPremium.GrantAsync(apiContext.TenantId, apiContext.UserId, http.ClientIp(), cancellationToken);
        return await SelfPremiumResults.From(outcome, selfPremium, apiContext.TenantId, cancellationToken);
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/tenant/entitlement/self-premium", Handler)
            .Produces<EntitlementDto>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status403Forbidden)
            .Produces<ProblemDetails>(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Turn on temporary self-serve premium")
            .WithDescription("Until store purchases are live: makes the caller's own account premium (Premium tier + the monthly try-on credits, source self_test, one subscription month, audited) — the same grant as the admin test premium. " +
                             "Idempotent (an active grant keeps its credit month). 403 self_premium_disabled when Entitlements:SelfServePremium:Enabled is false; 409 store_subscription_active when a store subscription already gives premium (it is never replaced). Returns the entitlement.")
            .WithTags("Tenant Entitlement");
    }
}

public class DeleteSelfPremium : IEndpoint
{
    private static async Task<IResult> Handler(
        HttpContext http,
        [FromServices] IApiContext apiContext,
        [FromServices] SelfServePremiumService selfPremium,
        CancellationToken cancellationToken)
    {
        var outcome = await selfPremium.RevokeAsync(apiContext.TenantId, apiContext.UserId, http.ClientIp(), cancellationToken);
        return await SelfPremiumResults.From(outcome, selfPremium, apiContext.TenantId, cancellationToken);
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapDelete("v1/tenant/entitlement/self-premium", Handler)
            .Produces<EntitlementDto>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Turn off temporary self-serve premium")
            .WithDescription("Removes only the caller's self-serve grant (idempotent); a store subscription is never touched. 403 self_premium_disabled when the switch is off. Returns the entitlement.")
            .WithTags("Tenant Entitlement");
    }
}
