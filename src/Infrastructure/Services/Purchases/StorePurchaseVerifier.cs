using System.Text.Json;
using Domain.Enum;
using Domain.Options;
using Domain.Services;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Infrastructure.Services.Purchases;

/// <summary>
/// Apple: a StoreKit 2 signed transaction is verified locally (AppleJwsVerifier) — works without any App Store Connect
/// secret. A bare transaction id needs the App Store Server API. The subscription's current state (renewal info: grace
/// period, billing retry) is read from the Server API when it is configured. Checks: bundle id, product id, environment.
/// Google: Play Developer API (subscriptionsv2 / products) with the service account; package is part of the URL.
/// </summary>
public sealed class StorePurchaseVerifier(
    AppleJwsVerifier jws,
    IAppStoreServerApi appStore,
    IGooglePlayDeveloperApi play,
    IOptionsMonitor<StoreOptions> options,
    TimeProvider timeProvider,
    ILogger<StorePurchaseVerifier> logger) : IPurchaseVerifier
{
    private DateTime Now => timeProvider.GetUtcNow().UtcDateTime;

    /// <summary>True when Android purchases can be read (Play Developer API service account configured).</summary>
    public bool GoogleAvailable => play.IsConfigured;

    public Task<PurchaseVerificationResult> VerifyAsync(StorePlatform platform, string productId, string transactionIdOrToken, CancellationToken ct) =>
        platform == StorePlatform.Apple
            ? VerifyAppleAsync(productId, transactionIdOrToken, ct)
            : VerifyGoogleAsync(productId, transactionIdOrToken, eventAt: null, ct);

    public async Task<PurchaseVerificationResult> RefreshAsync(StorePlatform platform, string productId, string key, string? purchaseToken, string? environment, CancellationToken ct)
    {
        if (platform == StorePlatform.Google)
            return purchaseToken is null ? PurchaseVerificationResult.Invalid("token_missing") : await VerifyGoogleAsync(productId, purchaseToken, null, ct);

        if (!appStore.IsConfigured)
            return PurchaseVerificationResult.NotAvailable();
        var kind = KindOf(productId);
        if (kind == StoreProductKind.Subscription)
        {
            var status = await appStore.GetSubscriptionStatusAsync(key, environment, ct);
            return status is null
                ? PurchaseVerificationResult.Invalid("subscription_not_found")
                : FromSigned(productId: null, status.SignedTransactionInfo, status.SignedRenewalInfo, eventAt: Now);
        }
        var signed = await appStore.GetTransactionAsync(key, environment, ct);
        return signed is null ? PurchaseVerificationResult.Invalid("transaction_not_found") : FromSigned(null, signed, null, Now);
    }

    public async Task FinalizeAsync(StorePlatform platform, PurchaseVerificationResult verified, StoreProductKind kind, CancellationToken ct)
    {
        if (platform != StorePlatform.Google || !verified.NeedsAcknowledgement || verified.PurchaseToken is null || verified.ProductId is null)
            return;
        // Unacknowledged Play purchases are refunded after 3 days; consuming a consumable also lets it be bought again.
        var done = kind == StoreProductKind.Consumable
            ? await play.ConsumeProductAsync(verified.ProductId, verified.PurchaseToken, ct)
            : await play.AcknowledgeSubscriptionAsync(verified.ProductId, verified.PurchaseToken, ct);
        if (!done)
            logger.LogWarning("Play purchase {Key} could not be finalized yet; the app or the next notification retries", verified.OriginalTransactionId);
    }

    // ── Apple ────────────────────────────────────────────────────────────────────────────────────────────────────

    private async Task<PurchaseVerificationResult> VerifyAppleAsync(string productId, string value, CancellationToken ct)
    {
        string signedTransaction;
        if (value.Count(c => c == '.') == 2)
        {
            signedTransaction = value;
        }
        else
        {
            if (!appStore.IsConfigured)
                return PurchaseVerificationResult.NotAvailable();
            var fetched = await appStore.GetTransactionAsync(value, null, ct);
            if (fetched is null)
                return PurchaseVerificationResult.Invalid("transaction_not_found");
            signedTransaction = fetched;
        }

        var result = FromSigned(productId, signedTransaction, null, null);
        if (result.Status != PurchaseVerificationStatus.Verified || result.Kind != StoreProductKind.Subscription || !appStore.IsConfigured)
            return result;

        // The device's JWS is the transaction as it was; the Server API has the chain's current state.
        var status = await appStore.GetSubscriptionStatusAsync(result.OriginalTransactionId!, result.Environment, ct);
        if (status is null)
            return result;
        var current = FromSigned(null, status.SignedTransactionInfo, status.SignedRenewalInfo, Now);
        return current.Status == PurchaseVerificationStatus.Verified ? current with { AccountToken = current.AccountToken ?? result.AccountToken } : result;
    }

    /// <summary>Verified StoreKit transaction (+ renewal info) → facts; null product id = do not compare.</summary>
    public PurchaseVerificationResult FromSigned(string? productId, string signedTransaction, string? signedRenewal, DateTime? eventAt)
    {
        var transaction = jws.Verify(signedTransaction);
        if (transaction is null)
            return PurchaseVerificationResult.Invalid("signature_invalid");
        JsonElement? renewal = null;
        if (signedRenewal is not null)
        {
            var verifiedRenewal = jws.Verify(signedRenewal);
            if (verifiedRenewal is null)
                return PurchaseVerificationResult.Invalid("renewal_signature_invalid");
            renewal = verifiedRenewal.Payload;
        }

        var result = StoreRules.FromAppleTransaction(transaction.Payload, renewal, Now, eventAt);
        if (result.Status != PurchaseVerificationStatus.Verified)
            return result;

        var store = options.CurrentValue;
        if (!string.Equals(result.BundleId, store.BundleId, StringComparison.Ordinal))
            return PurchaseVerificationResult.Invalid("bundle_id_mismatch");
        if (productId is not null && !string.Equals(result.ProductId, productId, StringComparison.Ordinal))
            return PurchaseVerificationResult.Invalid("product_id_mismatch");
        if (!EnvironmentAccepted(result.Environment, store))
            return PurchaseVerificationResult.Invalid("environment_rejected");

        return result with { Kind = KindOf(result.ProductId!) ?? result.Kind };
    }

    public static bool EnvironmentAccepted(string? environment, StoreOptions store) => environment switch
    {
        StoreRules.ProductionEnvironment => true,
        StoreRules.SandboxEnvironment => store.AcceptSandbox,
        // Only reachable when the Xcode test root is configured (AppleJwsVerifier ties that root to this environment).
        StoreRules.XcodeEnvironment => ConfigSecret.IsSet(store.XcodeTestRootCertificate),
        _ => false,
    };

    // ── Google ───────────────────────────────────────────────────────────────────────────────────────────────────

    public async Task<PurchaseVerificationResult> VerifyGoogleAsync(string productId, string purchaseToken, DateTime? eventAt, CancellationToken ct)
    {
        if (!play.IsConfigured)
            return PurchaseVerificationResult.NotAvailable();

        var kind = KindOf(productId);
        if (kind is null)
            return PurchaseVerificationResult.Invalid("product_unknown");

        if (kind == StoreProductKind.Subscription)
        {
            using var subscription = await play.GetSubscriptionAsync(purchaseToken, ct);
            if (subscription is null)
                return PurchaseVerificationResult.Invalid("token_unknown");
            var result = StoreRules.FromGoogleSubscription(subscription.RootElement, purchaseToken, Now, eventAt);
            // The token's line items decide the product; the request's product id must be one of ours.
            return result.Status == PurchaseVerificationStatus.Verified && KindOf(result.ProductId!) != StoreProductKind.Subscription
                ? PurchaseVerificationResult.Invalid("product_id_mismatch")
                : result;
        }

        using var product = await play.GetProductAsync(productId, purchaseToken, ct);
        return product is null
            ? PurchaseVerificationResult.Invalid("token_unknown")
            : StoreRules.FromGoogleProduct(product.RootElement, productId, purchaseToken, Now, eventAt);
    }

    private StoreProductKind? KindOf(string productId)
    {
        var store = options.CurrentValue;
        if (store.ProductIds.Premium.Contains(productId))
            return StoreProductKind.Subscription;
        return store.CreditPacks.ContainsKey(productId) ? StoreProductKind.Consumable : null;
    }
}
