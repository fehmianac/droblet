using Domain.Enum;
using Domain.Services;

namespace Infrastructure.Services.Providers;

/// <summary>
/// Placeholder until App Store Server API / Play Developer API credentials and final product ids exist.
/// Never grants anything: the endpoints answer 501 purchase_verification_unavailable.
/// </summary>
public sealed class NotConfiguredPurchaseVerifier : IPurchaseVerifier
{
    public Task<PurchaseVerificationResult> VerifyAsync(StorePlatform platform, string productId, string transactionIdOrToken, CancellationToken ct) =>
        Task.FromResult(new PurchaseVerificationResult(PurchaseVerificationStatus.NotAvailable));
}
