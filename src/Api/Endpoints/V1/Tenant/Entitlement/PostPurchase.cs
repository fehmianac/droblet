using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Context;
using Domain.Domain;
using Domain.Enum;
using Domain.Services;
using FluentValidation;
using Infrastructure.Services;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.Entitlement;

public class PostPurchase : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] PurchaseRequest request,
        [FromServices] IApiContext apiContext,
        [FromServices] IPurchaseVerifier verifier,
        [FromServices] IPurchaseService purchaseService,
        [FromServices] IEntitlementService entitlementService,
        [FromServices] IValidator<PurchaseRequest> validator,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        // The client only sends identifiers; state is read from the store server API.
        var verified = await verifier.VerifyAsync(request.Platform, request.ProductId, request.TransactionId, cancellationToken);
        switch (verified.Status)
        {
            case PurchaseVerificationStatus.NotAvailable:
                return ApiResults.Problem(StatusCodes.Status501NotImplemented, ErrorCodes.PurchaseVerificationUnavailable);
            case PurchaseVerificationStatus.Invalid:
                return ApiResults.Problem(StatusCodes.Status422UnprocessableEntity, "purchase_invalid");
        }

        var outcome = await purchaseService.ApplyAsync(apiContext.TenantId, request.Platform, verified, cancellationToken);
        if (outcome == PurchaseApplyOutcome.UnknownProduct)
            return ApiResults.Problem(StatusCodes.Status422UnprocessableEntity, "product_unknown");

        return Results.Ok((await entitlementService.GetAsync(apiContext.TenantId, cancellationToken)).ToDto());
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/tenant/entitlement/purchase", Handler)
            .Produces<EntitlementDto>(StatusCodes.Status200OK)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<ProblemDetails>(StatusCodes.Status422UnprocessableEntity)
            .Produces<ProblemDetails>(StatusCodes.Status501NotImplemented)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Verify a store purchase")
            .WithDescription("Subscription (monthly/yearly) or consumable credit pack. Returns 501 purchase_verification_unavailable until store credentials exist.")
            .WithTags("Tenant Entitlement");
    }
}

public record PurchaseRequest(StorePlatform Platform, string ProductId, string TransactionId);

public class PurchaseRequestValidator : AbstractValidator<PurchaseRequest>
{
    public PurchaseRequestValidator()
    {
        RuleFor(x => x.Platform).IsInEnum().WithErrorCode("platform_invalid");
        RuleFor(x => x.ProductId).NotEmpty().WithErrorCode("product_id_required").MaximumLength(200).WithErrorCode("product_id_invalid");
        RuleFor(x => x.TransactionId).NotEmpty().WithErrorCode("transaction_id_required").MaximumLength(4096).WithErrorCode("transaction_id_invalid");
    }
}
