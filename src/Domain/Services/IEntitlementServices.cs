using Domain.Enum;

namespace Domain.Services;

public sealed record EntitlementSnapshot(ActiveEntitlement Active, CreditBalance Credits, ItemRecognitionQuota? ItemRecognition = null);

/// <summary>
/// Server-side counter behind Entitlements:Free:ItemRecognitionLimit. Reserve when the Api queues the jobs, commit when
/// the worker completes one, release when it fails (a failed job never consumes the allowance). Every call is
/// idempotent per job id; EntitlementPolicy makes the decision.
/// </summary>
public interface IItemRecognitionQuotaService
{
    Task<ItemRecognitionQuota> GetAsync(string tenantId, CancellationToken ct);
    /// <summary>Reserves a slot for the first Granted job ids (request order). Members: everything is granted, nothing is stored.</summary>
    Task<ItemRecognitionGrant> ReserveAsync(string tenantId, IReadOnlyList<string> jobIds, CancellationToken ct);
    Task CommitAsync(string tenantId, string jobId, CancellationToken ct);
    Task ReleaseAsync(string tenantId, string jobId, CancellationToken ct);
}

public interface IEntitlementService
{
    Task<EntitlementSnapshot> GetAsync(string tenantId, CancellationToken ct);
    Task<EntitlementDecision> CheckAsync(string tenantId, Capability capability, CancellationToken ct);
}

public sealed record CreditReservationResult(ReserveOutcome Outcome, string? Reason);

/// <summary>Server-side credit counter: reserve on enqueue, commit on success, refund on terminal failure.</summary>
public interface ICreditService
{
    Task<CreditReservationResult> ReserveAsync(string tenantId, string idempotencyKey, string jobId, CancellationToken ct);
    Task CommitAsync(string tenantId, string idempotencyKey, CancellationToken ct);
    Task RefundAsync(string tenantId, string idempotencyKey, CancellationToken ct);
    Task AddPackCreditsAsync(string tenantId, int credits, string reference, CancellationToken ct);
    /// <summary>Refunded consumable: removes the pack's credits from what is left (never below zero), once per reference.
    /// Returns the credits actually removed.</summary>
    Task<int> RemovePackCreditsAsync(string tenantId, int credits, string reference, CancellationToken ct);
}

public enum PurchaseVerificationStatus { Verified, Invalid, NotAvailable }

/// <summary>
/// What the store says about one purchase. OriginalTransactionId is the stable purchase key (StorePurchaseEntity.Key):
/// Apple originalTransactionId (subscription) / transactionId (consumable), Google SHA-256 of the purchase token.
/// ExpiresAt is the instant access ends (grace end in the grace period, the refund instant when revoked).
/// </summary>
public sealed record PurchaseVerificationResult(
    PurchaseVerificationStatus Status,
    string? ProductId = null,
    string? OriginalTransactionId = null,
    DateTime? PurchasedAt = null,
    DateTime? ExpiresAt = null)
{
    /// <summary>Null = decided by the product id (Store.ProductIds / Store.CreditPacks).</summary>
    public StoreProductKind? Kind { get; init; }
    public string? TransactionId { get; init; }
    /// <summary>appAccountToken (iOS) / obfuscatedExternalAccountId (Android): StoreAccountToken of the buying tenant.</summary>
    public string? AccountToken { get; init; }
    public StoreSubscriptionState State { get; init; } = StoreSubscriptionState.Active;
    public DateTime? RevokedAt { get; init; }
    public string? Environment { get; init; }
    public string? BundleId { get; init; }
    /// <summary>Google upgrade / downgrade: key of the purchase this one replaces.</summary>
    public string? LinkedOriginalTransactionId { get; init; }
    /// <summary>Google only: the raw purchase token (acknowledge / consume / re-read).</summary>
    public string? PurchaseToken { get; init; }
    /// <summary>StoreKit: this transaction was replaced by an upgrade inside the same chain — informational only.</summary>
    public bool Superseded { get; init; }
    public int Quantity { get; init; } = 1;
    /// <summary>Google: the purchase still has to be acknowledged (subscription) / consumed (consumable).</summary>
    public bool NeedsAcknowledgement { get; init; }
    /// <summary>Store signing / event time: orders events (StoreRules.IsStale).</summary>
    public DateTime? EventAt { get; init; }
    /// <summary>Why verification failed (logs only, never returned to the client).</summary>
    public string? FailureReason { get; init; }

    public static PurchaseVerificationResult Invalid(string reason) => new(PurchaseVerificationStatus.Invalid) { FailureReason = reason };
    public static PurchaseVerificationResult NotAvailable() => new(PurchaseVerificationStatus.NotAvailable);
}

/// <summary>
/// StoreKit 2 / Play Billing verification. Apple: the StoreKit 2 signed transaction (JWS) is verified locally against
/// Apple's root (no secret needed); a bare transaction id is resolved through the App Store Server API when its key is
/// configured. Google: Play Developer API with the service account. NotAvailable = that store is not configured.
/// </summary>
public interface IPurchaseVerifier
{
    /// <param name="transactionIdOrToken">Apple: signed transaction (JWS) or transaction id. Google: purchase token.</param>
    Task<PurchaseVerificationResult> VerifyAsync(StorePlatform platform, string productId, string transactionIdOrToken, CancellationToken ct);

    /// <summary>Re-reads a stored purchase from the store server API (restore, notifications). NotAvailable without credentials.</summary>
    Task<PurchaseVerificationResult> RefreshAsync(StorePlatform platform, string productId, string key, string? purchaseToken, string? environment, CancellationToken ct) =>
        Task.FromResult(PurchaseVerificationResult.NotAvailable());

    /// <summary>Google: acknowledge a subscription / consume a consumable after it was granted. Apple: nothing (the app finishes the transaction).</summary>
    Task FinalizeAsync(StorePlatform platform, PurchaseVerificationResult verified, StoreProductKind kind, CancellationToken ct) => Task.CompletedTask;
}
