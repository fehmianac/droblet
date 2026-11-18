using System.Text;
using System.Text.Json;
using Domain.Entity;
using Domain.Enum;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Infrastructure.Services.Purchases;

public enum StorePurchaseOutcome { Applied, NotAvailable, Invalid, UnknownProduct, OwnedByAnotherAccount, AccountMismatch, Pending }

public sealed record RestoreItem(string ProductId, string TransactionId);

public sealed record RestoreSummary(int Restored, int OwnedByAnotherAccount, int Invalid, bool StoreAvailable);

public enum StoreNotificationOutcome { Processed, Duplicate, Ignored, Invalid, NotConfigured }

public interface IStoreSyncService
{
    Task<StorePurchaseOutcome> PurchaseAsync(string tenantId, StorePlatform platform, string productId, string transactionIdOrToken, CancellationToken ct);
    Task<RestoreSummary> RestoreAsync(string tenantId, StorePlatform platform, IReadOnlyList<RestoreItem> items, CancellationToken ct);
    Task<StoreNotificationOutcome> HandleAppleAsync(string signedPayload, CancellationToken ct);
    Task<StoreNotificationOutcome> HandleGoogleAsync(string messageId, string base64Data, CancellationToken ct);
}

/// <summary>
/// Purchase, restore and store notifications in one place. The client only sends identifiers; state always comes from
/// the store (signed StoreKit data or the store server APIs) and a notification only triggers that read
/// (BACKEND_ENGINEER.md §Yetki ve satın alma). Idempotent: purchases by key, notifications by notification id.
/// </summary>
public sealed class StoreSyncService(
    StorePurchaseVerifier verifier,
    IPurchaseService purchases,
    AppleJwsVerifier jws,
    IRepository repository,
    IOptionsMonitor<StoreOptions> options,
    TimeProvider timeProvider,
    ILogger<StoreSyncService> logger) : IStoreSyncService
{
    private DateTime Now => timeProvider.GetUtcNow().UtcDateTime;

    public async Task<StorePurchaseOutcome> PurchaseAsync(string tenantId, StorePlatform platform, string productId, string transactionIdOrToken, CancellationToken ct)
    {
        var verified = await verifier.VerifyAsync(platform, productId, transactionIdOrToken, ct);
        switch (verified.Status)
        {
            case PurchaseVerificationStatus.NotAvailable:
                return StorePurchaseOutcome.NotAvailable;
            case PurchaseVerificationStatus.Invalid:
                logger.LogInformation("Purchase rejected for tenant {TenantId}: {Reason}", tenantId, verified.FailureReason);
                return StorePurchaseOutcome.Invalid;
        }
        if (!string.Equals(verified.ProductId, productId, StringComparison.Ordinal))
        {
            logger.LogInformation("Purchase rejected for tenant {TenantId}: product mismatch", tenantId);
            return StorePurchaseOutcome.Invalid;
        }

        var outcome = await purchases.ApplyAsync(tenantId, platform, verified, ct);
        if (outcome is PurchaseApplyOutcome.SubscriptionActivated or PurchaseApplyOutcome.CreditsAdded or PurchaseApplyOutcome.Stale)
            await verifier.FinalizeAsync(platform, verified, verified.Kind ?? StoreProductKind.Subscription, ct);
        return Map(outcome);
    }

    public async Task<RestoreSummary> RestoreAsync(string tenantId, StorePlatform platform, IReadOnlyList<RestoreItem> items, CancellationToken ct)
    {
        int restored = 0, owned = 0, invalid = 0;
        var available = false;
        var seen = new HashSet<string>(StringComparer.Ordinal);

        // 1. What the device still holds (StoreKit currentEntitlements / Play queryPurchases).
        foreach (var item in items)
        {
            var outcome = await PurchaseAsync(tenantId, platform, item.ProductId, item.TransactionId, ct);
            if (outcome != StorePurchaseOutcome.NotAvailable)
                available = true;
            switch (outcome)
            {
                case StorePurchaseOutcome.Applied: restored++; break;
                case StorePurchaseOutcome.OwnedByAnotherAccount or StorePurchaseOutcome.AccountMismatch: owned++; break;
                case StorePurchaseOutcome.Invalid or StorePurchaseOutcome.UnknownProduct: invalid++; break;
            }
            seen.Add(item.TransactionId);
        }

        // 2. Subscriptions this account already owns: re-read their current state from the store server API.
        foreach (var purchase in await repository.GetAllAsync<StorePurchaseEntity>(StorePurchaseEntity.GetPk(tenantId), ct))
        {
            if (purchase.Platform != platform || purchase.Kind != StoreProductKind.Subscription || (purchase.PurchaseToken is { } token && seen.Contains(token)))
                continue;
            var refreshed = await verifier.RefreshAsync(platform, purchase.ProductId, purchase.Key, purchase.PurchaseToken, purchase.Environment, ct);
            if (refreshed.Status != PurchaseVerificationStatus.Verified)
                continue;
            available = true;
            if (await purchases.ApplyAsync(tenantId, platform, refreshed, ct) == PurchaseApplyOutcome.SubscriptionActivated)
                restored++;
        }

        return new RestoreSummary(restored, owned, invalid, available || items.Count == 0);
    }

    // ── App Store Server Notifications v2 ─────────────────────────────────────────────────────────────────────────

    public async Task<StoreNotificationOutcome> HandleAppleAsync(string signedPayload, CancellationToken ct)
    {
        var notification = jws.Verify(signedPayload);
        if (notification is null)
            return StoreNotificationOutcome.Invalid;

        var payload = notification.Payload;
        var type = StoreRules.Str(payload, "notificationType");
        var subtype = StoreRules.Str(payload, "subtype");
        var notificationId = StoreRules.Str(payload, "notificationUUID");
        if (notificationId is null || !payload.TryGetProperty("data", out var data))
            return type == "TEST" || payload.TryGetProperty("summary", out _) ? StoreNotificationOutcome.Ignored : StoreNotificationOutcome.Invalid;

        var store = options.CurrentValue;
        if (!string.Equals(StoreRules.Str(data, "bundleId"), store.BundleId, StringComparison.Ordinal)
            || !StorePurchaseVerifier.EnvironmentAccepted(StoreRules.Str(data, "environment"), store)
            || (store.AppAppleId is { } appId && StoreRules.Str(data, "environment") == StoreRules.ProductionEnvironment
                && StoreRules.Str(data, "appAppleId") != appId.ToString(System.Globalization.CultureInfo.InvariantCulture)))
            return StoreNotificationOutcome.Invalid;

        if (await IsDuplicateAsync(StorePlatform.Apple, notificationId, ct))
            return StoreNotificationOutcome.Duplicate;

        var action = StoreRules.AppleAction(type, subtype);
        var signedTransaction = StoreRules.Str(data, "signedTransactionInfo");
        if (action == StoreNotificationAction.Ignore || signedTransaction is null)
        {
            logger.LogInformation("Apple notification {Type}/{Subtype} ignored", type, subtype);
            await ReceiptAsync(StorePlatform.Apple, notificationId, $"{type}/{subtype}", ct);
            return StoreNotificationOutcome.Ignored;
        }

        var verified = verifier.FromSigned(null, signedTransaction, StoreRules.Str(data, "signedRenewalInfo"), StoreRules.Ms(payload, "signedDate"));
        if (verified.Status != PurchaseVerificationStatus.Verified)
        {
            logger.LogWarning("Apple notification {Type} carried an invalid transaction: {Reason}", type, verified.FailureReason);
            return StoreNotificationOutcome.Invalid;
        }

        var (tenantId, outcome) = await purchases.ApplyStoreEventAsync(StorePlatform.Apple, verified, action, ct);
        logger.LogInformation("Apple notification {Type}/{Subtype} → {Outcome} for tenant {TenantId}", type, subtype, outcome, tenantId);
        await ReceiptAsync(StorePlatform.Apple, notificationId, $"{type}/{subtype}", ct);
        return StoreNotificationOutcome.Processed;
    }

    // ── Google Play RTDN (Pub/Sub push) ───────────────────────────────────────────────────────────────────────────

    public async Task<StoreNotificationOutcome> HandleGoogleAsync(string messageId, string base64Data, CancellationToken ct)
    {
        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(Convert.FromBase64String(base64Data));
        }
        catch (Exception ex) when (ex is FormatException or JsonException)
        {
            return StoreNotificationOutcome.Invalid;
        }

        using (document)
        {
            var root = document.RootElement;
            var store = options.CurrentValue;
            if (!string.Equals(StoreRules.Str(root, "packageName"), store.AndroidPackage, StringComparison.Ordinal))
                return StoreNotificationOutcome.Invalid;
            if (root.TryGetProperty("testNotification", out _))
                return StoreNotificationOutcome.Ignored;
            if (await IsDuplicateAsync(StorePlatform.Google, messageId, ct))
                return StoreNotificationOutcome.Duplicate;

            var eventAt = StoreRules.Ms(root, "eventTimeMillis");
            string kind;

            if (root.TryGetProperty("voidedPurchaseNotification", out var voided))
            {
                // Refund / chargeback / revoke of a subscription or a one-time product: access or pack credits go.
                var token = StoreRules.Str(voided, "purchaseToken");
                if (token is null)
                    return StoreNotificationOutcome.Invalid;
                var tenantId = await purchases.RevokeByKeyAsync(StorePlatform.Google, StoreRules.GoogleKey(token), eventAt ?? Now, ct);
                logger.LogInformation("Play voided purchase (type {Type}) for tenant {TenantId}", StoreRules.Int(voided, "productType"), tenantId);
                kind = "voided";
            }
            else if (root.TryGetProperty("subscriptionNotification", out var subscription))
            {
                if (!verifier.GoogleAvailable)
                    return StoreNotificationOutcome.NotConfigured;
                var type = StoreRules.Int(subscription, "notificationType") ?? 0;
                var token = StoreRules.Str(subscription, "purchaseToken");
                var productId = StoreRules.Str(subscription, "subscriptionId") ?? store.ProductIds.Premium.FirstOrDefault();
                var action = StoreRules.GoogleSubscriptionAction(type);
                if (token is null || productId is null)
                    return StoreNotificationOutcome.Invalid;
                if (action != StoreNotificationAction.Ignore)
                    await ApplyGoogleAsync(productId, token, action, eventAt, ct);
                kind = $"subscription/{type}";
            }
            else if (root.TryGetProperty("oneTimeProductNotification", out var oneTime))
            {
                if (!verifier.GoogleAvailable)
                    return StoreNotificationOutcome.NotConfigured;
                var type = StoreRules.Int(oneTime, "notificationType") ?? 0;
                var token = StoreRules.Str(oneTime, "purchaseToken");
                var sku = StoreRules.Str(oneTime, "sku");
                if (token is null || sku is null)
                    return StoreNotificationOutcome.Invalid;
                if (StoreRules.GoogleOneTimeAction(type) != StoreNotificationAction.Ignore)
                    await ApplyGoogleAsync(sku, token, StoreNotificationAction.Apply, eventAt, ct);
                kind = $"onetime/{type}";
            }
            else
            {
                kind = "unknown";
            }

            await ReceiptAsync(StorePlatform.Google, messageId, kind, ct);
            return StoreNotificationOutcome.Processed;
        }
    }

    private async Task ApplyGoogleAsync(string productId, string token, StoreNotificationAction action, DateTime? eventAt, CancellationToken ct)
    {
        var verified = await verifier.VerifyGoogleAsync(productId, token, eventAt, ct);
        if (verified.Status != PurchaseVerificationStatus.Verified)
        {
            logger.LogInformation("Play notification for an unknown / invalid token ignored: {Reason}", verified.FailureReason);
            return;
        }
        if (action == StoreNotificationAction.Revoke)
            verified = verified with { State = StoreSubscriptionState.Revoked, RevokedAt = eventAt ?? Now };

        var (tenantId, outcome) = await purchases.ApplyStoreEventAsync(StorePlatform.Google, verified, action, ct);
        if (tenantId is not null && outcome is PurchaseApplyOutcome.SubscriptionActivated or PurchaseApplyOutcome.CreditsAdded)
            await verifier.FinalizeAsync(StorePlatform.Google, verified, verified.Kind ?? StoreProductKind.Subscription, ct);
        logger.LogInformation("Play notification → {Outcome} for tenant {TenantId}", outcome, tenantId);
    }

    // ── idempotency ──────────────────────────────────────────────────────────────────────────────────────────────

    private async Task<bool> IsDuplicateAsync(StorePlatform platform, string id, CancellationToken ct) =>
        await repository.GetAsync<StoreNotificationReceiptEntity>(StoreNotificationReceiptEntity.GetPk(), StoreNotificationReceiptEntity.GetSk(platform, id), ct) is not null;

    // Written after processing: a crash before it lets the store redeliver; applying twice is harmless (idempotent writes).
    private Task ReceiptAsync(StorePlatform platform, string id, string kind, CancellationToken ct) =>
        repository.SaveAsync(new StoreNotificationReceiptEntity { Platform = platform, NotificationId = id, Kind = kind, CreatedAt = Now }, ct);

    private static StorePurchaseOutcome Map(PurchaseApplyOutcome outcome) => outcome switch
    {
        PurchaseApplyOutcome.UnknownProduct => StorePurchaseOutcome.UnknownProduct,
        PurchaseApplyOutcome.OwnedByAnotherAccount => StorePurchaseOutcome.OwnedByAnotherAccount,
        PurchaseApplyOutcome.AccountMismatch => StorePurchaseOutcome.AccountMismatch,
        PurchaseApplyOutcome.Pending => StorePurchaseOutcome.Pending,
        _ => StorePurchaseOutcome.Applied,
    };
}

/// <summary>Verifies the OIDC token Pub/Sub puts on a push request (audience + service account).</summary>
public interface IPubSubPushVerifier
{
    bool IsConfigured { get; }
    Task<bool> VerifyAsync(string? authorizationHeader, CancellationToken ct);
}

public sealed class PubSubPushVerifier(Providers.OidcTokenValidator validator, IOptionsMonitor<StoreOptions> options) : IPubSubPushVerifier
{
    public bool IsConfigured => options.CurrentValue.HasGooglePubSubVerification;

    public async Task<bool> VerifyAsync(string? authorizationHeader, CancellationToken ct)
    {
        var store = options.CurrentValue;
        if (!store.HasGooglePubSubVerification || authorizationHeader is null
            || !authorizationHeader.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            return false;

        var identity = await validator.ValidateAsync(authorizationHeader["Bearer ".Length..].Trim(),
            ["https://accounts.google.com", "accounts.google.com"], [store.GooglePubSubAudience!], ct);
        if (identity is null)
            return false;
        var email = identity.FindFirst("email")?.Value;
        var verified = identity.FindFirst("email_verified")?.Value;
        return string.Equals(email, store.GooglePubSubServiceAccount, StringComparison.OrdinalIgnoreCase)
               && string.Equals(verified, "true", StringComparison.OrdinalIgnoreCase);
    }
}

/// <summary>Decodes a Pub/Sub push envelope: { "message": { "data": base64, "messageId": … }, "subscription": … }.</summary>
public static class PubSubEnvelope
{
    public static (string MessageId, string Data)? Parse(JsonElement body)
    {
        if (!body.TryGetProperty("message", out var message))
            return null;
        var id = StoreRules.Str(message, "messageId") ?? StoreRules.Str(message, "message_id");
        var data = StoreRules.Str(message, "data");
        return id is null || data is null ? null : (id, data);
    }

    public static string Encode(string json) => Convert.ToBase64String(Encoding.UTF8.GetBytes(json));
}
