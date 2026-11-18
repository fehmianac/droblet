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
}

public enum PurchaseVerificationStatus { Verified, Invalid, NotAvailable }

public sealed record PurchaseVerificationResult(
    PurchaseVerificationStatus Status,
    string? ProductId = null,
    string? OriginalTransactionId = null,
    DateTime? PurchasedAt = null,
    DateTime? ExpiresAt = null);

/// <summary>StoreKit 2 / Play Billing verification against the store server APIs. Not available until product ids exist (A-10).</summary>
public interface IPurchaseVerifier
{
    Task<PurchaseVerificationResult> VerifyAsync(StorePlatform platform, string productId, string transactionIdOrToken, CancellationToken ct);
}
