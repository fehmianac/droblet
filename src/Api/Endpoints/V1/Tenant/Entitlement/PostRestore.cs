using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Context;
using Domain.Domain;
using Domain.Enum;
using Domain.Services;
using FluentValidation;
using Infrastructure.Services.Purchases;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.Entitlement;

public class PostRestore : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] RestoreRequest request,
        [FromServices] IApiContext apiContext,
        [FromServices] IStoreSyncService store,
        [FromServices] IEntitlementService entitlementService,
        [FromServices] IValidator<RestoreRequest> validator,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        var items = (request.Purchases ?? [])
            .Select(p => new RestoreItem(p.ProductId, p.SignedTransaction ?? p.TransactionId))
            .ToList();
        var summary = await store.RestoreAsync(apiContext.TenantId, request.Platform, items, cancellationToken);
        if (!summary.StoreAvailable)
            return ApiResults.Problem(StatusCodes.Status501NotImplemented, ErrorCodes.PurchaseVerificationUnavailable);

        var entitlement = (await entitlementService.GetAsync(apiContext.TenantId, cancellationToken)).ToDto(apiContext.TenantId);
        return Results.Ok(new RestoreResponse(entitlement, summary.Restored, summary.OwnedByAnotherAccount));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/tenant/entitlement/restore", Handler)
            .Produces<RestoreResponse>(StatusCodes.Status200OK)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<ProblemDetails>(StatusCodes.Status501NotImplemented)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Restore purchases")
            .WithDescription("purchases = what the store still holds on this device (StoreKit currentEntitlements JWS / Play purchase tokens; may be empty). " +
                             "Each one is verified and applied like POST purchase; subscriptions this account already owns are re-read from the store server API when it is configured. " +
                             "Returns the entitlement, how many purchases were restored and how many belong to another Droblet account. 501 when the store cannot be read at all.")
            .WithTags("Tenant Entitlement");
    }
}

public record RestorePurchase(string ProductId, string TransactionId, string? SignedTransaction = null);

public record RestoreRequest(StorePlatform Platform, List<RestorePurchase>? Purchases);

public record RestoreResponse(EntitlementDto Entitlement, int Restored, int OwnedByAnotherAccount);

public class RestoreRequestValidator : AbstractValidator<RestoreRequest>
{
    public RestoreRequestValidator()
    {
        RuleFor(x => x.Platform).IsInEnum().WithErrorCode("platform_invalid");
        RuleFor(x => x.Purchases).Must(p => p is null || p.Count <= 50).WithErrorCode("purchases_too_many");
        RuleForEach(x => x.Purchases).ChildRules(p =>
        {
            p.RuleFor(x => x.ProductId).NotEmpty().WithErrorCode("product_id_required").MaximumLength(200).WithErrorCode("product_id_invalid");
            p.RuleFor(x => x.TransactionId).NotEmpty().WithErrorCode("transaction_id_required").MaximumLength(16384).WithErrorCode("transaction_id_invalid");
            p.RuleFor(x => x.SignedTransaction).MaximumLength(16384).WithErrorCode("signed_transaction_invalid");
        });
    }
}
