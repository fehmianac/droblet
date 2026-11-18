using Api.Infrastructure.Contract;
using Domain.Constant;
using Domain.Context;
using Domain.Domain;
using Domain.Services;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.Entitlement;

public class Get : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromServices] IApiContext apiContext,
        [FromServices] IEntitlementService entitlementService,
        CancellationToken cancellationToken)
    {
        var snapshot = await entitlementService.GetAsync(apiContext.TenantId, cancellationToken);
        return Results.Ok(snapshot.ToDto());
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/tenant/entitlement", Handler)
            .Produces<EntitlementDto>(StatusCodes.Status200OK)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Get tier and AI credits")
            .WithDescription("Tier (free | premium), monthly allowance, remaining allowance + pack credits and when the allowance resets (subscription month). itemRecognition = AI garment recognitions of the account: { limit, used, remaining } — limit / remaining null = unlimited (members); for non-members the limit is lifetime (Entitlements:Free:ItemRecognitionLimit), 0 = members only.")
            .WithTags("Tenant Entitlement");
    }
}
