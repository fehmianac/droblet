using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.Entitlement;

public class PostRestore : IEndpoint
{
    private static IResult Handler() =>
        ApiResults.Problem(StatusCodes.Status501NotImplemented, ErrorCodes.PurchaseVerificationUnavailable);

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/tenant/entitlement/restore", Handler)
            .Produces<ProblemDetails>(StatusCodes.Status501NotImplemented)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Restore purchases")
            .WithDescription("501 until App Store Server API / Play Developer API credentials are configured.")
            .WithTags("Tenant Entitlement");
    }
}
