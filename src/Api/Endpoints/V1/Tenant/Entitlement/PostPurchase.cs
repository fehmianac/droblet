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

public class PostPurchase : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] PurchaseRequest request,
        [FromServices] IApiContext apiContext,
        [FromServices] IStoreSyncService store,
        [FromServices] IEntitlementService entitlementService,
        [FromServices] IValidator<PurchaseRequest> validator,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        // The client only sends identifiers / the store-signed transaction; state is read from the store.
        var outcome = await store.PurchaseAsync(apiContext.TenantId, request.Platform, request.ProductId,
            request.SignedTransaction ?? request.TransactionId, cancellationToken);
        return outcome switch
        {
            StorePurchaseOutcome.NotAvailable => ApiResults.Problem(StatusCodes.Status501NotImplemented, ErrorCodes.PurchaseVerificationUnavailable),
            StorePurchaseOutcome.Invalid => ApiResults.Problem(StatusCodes.Status422UnprocessableEntity, ErrorCodes.PurchaseInvalid),
            StorePurchaseOutcome.UnknownProduct => ApiResults.Problem(StatusCodes.Status422UnprocessableEntity, ErrorCodes.ProductUnknown),
            StorePurchaseOutcome.OwnedByAnotherAccount or StorePurchaseOutcome.AccountMismatch =>
                ApiResults.Problem(StatusCodes.Status409Conflict, ErrorCodes.PurchaseOwnedByAnotherAccount),
            StorePurchaseOutcome.Pending => Results.Json(new PurchasePendingResponse(ErrorCodes.PurchasePending), statusCode: StatusCodes.Status202Accepted),
            _ => Results.Ok((await entitlementService.GetAsync(apiContext.TenantId, cancellationToken)).ToDto(apiContext.TenantId)),
        };
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/tenant/entitlement/purchase", Handler)
            .Produces<EntitlementDto>(StatusCodes.Status200OK)
            .Produces<PurchasePendingResponse>(StatusCodes.Status202Accepted)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<ProblemDetails>(StatusCodes.Status409Conflict)
            .Produces<ProblemDetails>(StatusCodes.Status422UnprocessableEntity)
            .Produces<ProblemDetails>(StatusCodes.Status501NotImplemented)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Verify a store purchase")
            .WithDescription("Subscription (monthly / yearly) or consumable credit pack, verified on the server and idempotent per store transaction. " +
                             "apple: signedTransaction = StoreKit 2 JWS (Transaction.jwsRepresentation; verified against Apple's root, bundle id, product id, environment) — " +
                             "or transactionId alone when the App Store Server API key is configured. google: transactionId = purchaseToken (Play Developer API; the server acknowledges / consumes). " +
                             "The app finishes the store transaction only after 200. 202 purchase_pending (Android pending / Ask to Buy), 409 purchase_owned_by_another_account, " +
                             "422 purchase_invalid | product_unknown, 501 purchase_verification_unavailable (that store is not configured).")
            .WithTags("Tenant Entitlement");
    }
}

public record PurchasePendingResponse(string Code);

public record PurchaseRequest(StorePlatform Platform, string ProductId, string TransactionId, string? SignedTransaction = null);

public class PurchaseRequestValidator : AbstractValidator<PurchaseRequest>
{
    public PurchaseRequestValidator()
    {
        RuleFor(x => x.Platform).IsInEnum().WithErrorCode("platform_invalid");
        RuleFor(x => x.ProductId).NotEmpty().WithErrorCode("product_id_required").MaximumLength(200).WithErrorCode("product_id_invalid");
        RuleFor(x => x.TransactionId).NotEmpty().WithErrorCode("transaction_id_required").MaximumLength(16384).WithErrorCode("transaction_id_invalid");
        RuleFor(x => x.SignedTransaction).MaximumLength(16384).WithErrorCode("signed_transaction_invalid");
    }
}
