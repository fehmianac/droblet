using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Domain.Enum;

namespace Domain.Services;

/// <summary>
/// The store account token that ties a purchase to a Droblet tenant: StoreKit 2 appAccountToken (must be a UUID) and
/// Play Billing obfuscatedAccountId (≤ 64 chars, no PII). Tenant ids are ULIDs (128 bits), so the token is the same 128
/// bits written as a UUID — reversible, nothing to store. A non-ULID id (tests, legacy) gets a SHA-256 derived UUID,
/// which is not reversible (such a purchase is then found through StorePurchaseIndexEntity only).
/// </summary>
public static class StoreAccountToken
{
    private const string Alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

    public static string FromTenantId(string tenantId)
    {
        if (TryDecodeUlid(tenantId, out var value))
            return FormatUuid(value);
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes($"droblet-tenant:{tenantId}"));
        hash[6] = (byte)((hash[6] & 0x0F) | 0x40); // RFC 4122 v4 layout so every validator accepts it
        hash[8] = (byte)((hash[8] & 0x3F) | 0x80);
        return new Guid(hash.AsSpan(0, 16), bigEndian: true).ToString("D");
    }

    /// <summary>The tenant id a token was made from (ULID tenants only). The caller still checks that the tenant exists.</summary>
    public static string? TryTenantId(string? token)
    {
        if (string.IsNullOrWhiteSpace(token) || !Guid.TryParse(token, out var guid))
            return null;
        Span<byte> bytes = stackalloc byte[16];
        guid.TryWriteBytes(bytes, bigEndian: true, out _);
        UInt128 value = 0;
        foreach (var b in bytes)
            value = (value << 8) | b;
        if (value >> 125 != 0)
            return null; // a ULID has only 128 bits; 26 base-32 chars hold 130, the first char is ≤ 7
        Span<char> chars = stackalloc char[26];
        for (var i = 25; i >= 0; i--)
        {
            chars[i] = Alphabet[(int)(value & 31)];
            value >>= 5;
        }
        return new string(chars);
    }

    public static bool Matches(string tenantId, string? token) =>
        token is not null && string.Equals(FromTenantId(tenantId), token.Trim(), StringComparison.OrdinalIgnoreCase);

    private static bool TryDecodeUlid(string id, out UInt128 value)
    {
        value = 0;
        if (id.Length != 26)
            return false;
        foreach (var c in id.ToUpperInvariant())
        {
            var index = Alphabet.IndexOf(c);
            if (index < 0)
                return false;
            value = (value << 5) | (uint)index;
        }
        return id[0] <= '7';
    }

    private static string FormatUuid(UInt128 value)
    {
        Span<byte> bytes = stackalloc byte[16];
        for (var i = 15; i >= 0; i--)
        {
            bytes[i] = (byte)(value & 0xFF);
            value >>= 8;
        }
        return new Guid(bytes, bigEndian: true).ToString("D");
    }
}

public enum StoreNotificationAction { Apply, Revoke, Ignore }

/// <summary>
/// Pure store rules (no HTTP, no clock): purchase keys, notification → action tables, StoreKit / Play payload → the
/// facts PurchaseService applies. "Access" = Active or GracePeriod; ExpiresAt is always the instant access ends.
/// </summary>
public static class StoreRules
{
    public const string ProductionEnvironment = "Production";
    public const string SandboxEnvironment = "Sandbox";
    public const string XcodeEnvironment = "Xcode";

    /// <summary>Google purchase tokens are long and opaque: the stored key is their SHA-256 (hex).</summary>
    public static string GoogleKey(string purchaseToken) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(purchaseToken)));

    public static bool HasAccess(StoreSubscriptionState state) =>
        state is StoreSubscriptionState.Active or StoreSubscriptionState.GracePeriod;

    /// <summary>A late, older event never rolls a newer state back (same instant = apply: idempotent).</summary>
    public static bool IsStale(DateTime? appliedEventAt, DateTime? incomingEventAt) =>
        appliedEventAt is not null && incomingEventAt is not null && incomingEventAt < appliedEventAt;

    /// <summary>Refunded consumable: the pack's credits come off what is left, never below zero.</summary>
    public static int PackCreditsToRemove(int packBalance, int packCredits) => Math.Max(0, Math.Min(packBalance, packCredits));

    // ── App Store Server Notifications v2 ─────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// notificationType (+ subtype) → what to do. Everything that carries the current transaction is applied as-is
    /// (renew, expire, grace, billing retry, upgrade / downgrade, refund reversed …): the signed transaction + renewal
    /// info describe the state, so the handler never keeps its own state machine per type. Refund / revoke also take
    /// back consumable credits.
    /// </summary>
    public static StoreNotificationAction AppleAction(string? notificationType, string? subtype) => notificationType switch
    {
        "REFUND" or "REVOKE" => StoreNotificationAction.Revoke,
        "TEST" or "CONSUMPTION_REQUEST" or "REFUND_DECLINED" or "EXTERNAL_PURCHASE_TOKEN" or "PRICE_INCREASE" or "METADATA_UPDATE" or "MIGRATION" => StoreNotificationAction.Ignore,
        "RENEWAL_EXTENSION" when subtype is "SUMMARY" or "FAILURE" => StoreNotificationAction.Ignore,
        null or "" => StoreNotificationAction.Ignore,
        _ => StoreNotificationAction.Apply,
    };

    // ── Google Play RTDN ──────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>SubscriptionNotification.notificationType → action. The subscription is always re-read from the Play
    /// Developer API (the RTDN only says "something changed"); 12 SUBSCRIPTION_REVOKED also ends access at once.</summary>
    public static StoreNotificationAction GoogleSubscriptionAction(int notificationType) => notificationType switch
    {
        12 => StoreNotificationAction.Revoke,
        >= 1 and <= 20 => StoreNotificationAction.Apply,
        _ => StoreNotificationAction.Ignore,
    };

    /// <summary>OneTimeProductNotification: 1 PURCHASED (re-read, grant if not yet), 2 CANCELED (a pending purchase that
    /// never completed: re-read; nothing was granted).</summary>
    public static StoreNotificationAction GoogleOneTimeAction(int notificationType) => notificationType switch
    {
        1 or 2 => StoreNotificationAction.Apply,
        _ => StoreNotificationAction.Ignore,
    };

    // ── StoreKit 2 decoded payloads ───────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// JWSTransactionDecodedPayload (+ optional JWSRenewalInfoDecodedPayload) → verified facts. Subscription state:
    /// revoked (refund / family sharing revoked) → no access from revocationDate; expiresDate ahead → active;
    /// in the grace period → access until gracePeriodExpiresDate; billing retry → no access; otherwise expired.
    /// </summary>
    public static PurchaseVerificationResult FromAppleTransaction(JsonElement transaction, JsonElement? renewal, DateTime now, DateTime? eventAt = null)
    {
        var productId = Str(transaction, "productId");
        var transactionId = Str(transaction, "transactionId");
        var originalTransactionId = Str(transaction, "originalTransactionId") ?? transactionId;
        if (productId is null || transactionId is null || originalTransactionId is null)
            return PurchaseVerificationResult.Invalid("transaction_fields_missing");

        var type = Str(transaction, "type");
        var consumable = type is "Consumable";
        var revokedAt = Ms(transaction, "revocationDate");
        var expiresDate = Ms(transaction, "expiresDate");
        var purchased = Ms(transaction, "originalPurchaseDate") ?? Ms(transaction, "purchaseDate");

        StoreSubscriptionState state;
        DateTime? expiresAt;
        if (revokedAt is not null)
        {
            state = StoreSubscriptionState.Revoked;
            expiresAt = revokedAt;
        }
        else if (consumable || type is "Non-Consumable")
        {
            state = StoreSubscriptionState.Active;
            expiresAt = null;
        }
        else if (expiresDate is not null && expiresDate > now)
        {
            state = StoreSubscriptionState.Active;
            expiresAt = expiresDate;
        }
        else if (renewal is { } r && Ms(r, "gracePeriodExpiresDate") is { } grace && grace > now)
        {
            state = StoreSubscriptionState.GracePeriod;
            expiresAt = grace;
        }
        else if (renewal is { } rr && Bool(rr, "isInBillingRetryPeriod"))
        {
            state = StoreSubscriptionState.BillingRetry;
            expiresAt = expiresDate ?? now;
        }
        else
        {
            state = StoreSubscriptionState.Expired;
            expiresAt = expiresDate ?? now;
        }

        return new PurchaseVerificationResult(
            PurchaseVerificationStatus.Verified,
            productId,
            consumable ? transactionId : originalTransactionId,
            purchased,
            expiresAt)
        {
            Kind = consumable ? StoreProductKind.Consumable : StoreProductKind.Subscription,
            TransactionId = transactionId,
            AccountToken = Str(transaction, "appAccountToken"),
            State = state,
            RevokedAt = revokedAt,
            Environment = Str(transaction, "environment"),
            BundleId = Str(transaction, "bundleId"),
            Superseded = Bool(transaction, "isUpgraded"),
            Quantity = Int(transaction, "quantity") ?? 1,
            EventAt = eventAt ?? Ms(transaction, "signedDate"),
        };
    }

    // ── Play Developer API ────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>purchases.subscriptionsv2.get → verified facts (key = SHA-256 of the token).</summary>
    public static PurchaseVerificationResult FromGoogleSubscription(JsonElement subscription, string purchaseToken, DateTime now, DateTime? eventAt = null)
    {
        string? productId = null;
        DateTime? expiry = null;
        if (subscription.TryGetProperty("lineItems", out var items) && items.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in items.EnumerateArray())
            {
                var itemExpiry = Iso(item, "expiryTime");
                if (productId is null || (itemExpiry is not null && (expiry is null || itemExpiry > expiry)))
                {
                    productId = Str(item, "productId") ?? productId;
                    expiry = itemExpiry ?? expiry;
                }
            }
        }
        if (productId is null)
            return PurchaseVerificationResult.Invalid("line_items_missing");

        var raw = Str(subscription, "subscriptionState");
        var state = raw switch
        {
            "SUBSCRIPTION_STATE_ACTIVE" => StoreSubscriptionState.Active,
            "SUBSCRIPTION_STATE_IN_GRACE_PERIOD" => StoreSubscriptionState.GracePeriod,
            "SUBSCRIPTION_STATE_ON_HOLD" => StoreSubscriptionState.BillingRetry,
            "SUBSCRIPTION_STATE_PAUSED" => StoreSubscriptionState.Expired,
            // Cancelled = auto-renew off: access continues until the paid period ends.
            "SUBSCRIPTION_STATE_CANCELED" => expiry > now ? StoreSubscriptionState.Active : StoreSubscriptionState.Expired,
            "SUBSCRIPTION_STATE_EXPIRED" or "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED" => StoreSubscriptionState.Expired,
            "SUBSCRIPTION_STATE_PENDING" => StoreSubscriptionState.Pending,
            _ => (StoreSubscriptionState?)null,
        };
        if (state is null)
            return PurchaseVerificationResult.Invalid("subscription_state_unknown");

        // No access → the window ends now at the latest (on hold / paused keep a future expiry in some responses).
        var expiresAt = HasAccess(state.Value) ? expiry : (expiry is { } e && e < now ? e : now);
        var linked = Str(subscription, "linkedPurchaseToken");
        return new PurchaseVerificationResult(PurchaseVerificationStatus.Verified, productId, GoogleKey(purchaseToken), Iso(subscription, "startTime"), expiresAt)
        {
            Kind = StoreProductKind.Subscription,
            TransactionId = Str(subscription, "latestOrderId"),
            AccountToken = subscription.TryGetProperty("externalAccountIdentifiers", out var ids) ? Str(ids, "obfuscatedExternalAccountId") : null,
            State = state.Value,
            Environment = subscription.TryGetProperty("testPurchase", out _) ? SandboxEnvironment : ProductionEnvironment,
            LinkedOriginalTransactionId = linked is null ? null : GoogleKey(linked),
            PurchaseToken = purchaseToken,
            NeedsAcknowledgement = Str(subscription, "acknowledgementState") == "ACKNOWLEDGEMENT_STATE_PENDING",
            EventAt = eventAt ?? now,
        };
    }

    /// <summary>purchases.products.get (one-time / consumable) → verified facts. purchaseState 0 purchased, 1 cancelled, 2 pending.</summary>
    public static PurchaseVerificationResult FromGoogleProduct(JsonElement product, string productId, string purchaseToken, DateTime now, DateTime? eventAt = null)
    {
        var state = Int(product, "purchaseState") switch
        {
            0 => StoreSubscriptionState.Active,
            1 => StoreSubscriptionState.Revoked,
            2 => StoreSubscriptionState.Pending,
            _ => (StoreSubscriptionState?)null,
        };
        if (state is null)
            return PurchaseVerificationResult.Invalid("purchase_state_unknown");

        return new PurchaseVerificationResult(PurchaseVerificationStatus.Verified, Str(product, "productId") ?? productId, GoogleKey(purchaseToken),
            LongMs(product, "purchaseTimeMillis"), null)
        {
            Kind = StoreProductKind.Consumable,
            TransactionId = Str(product, "orderId"),
            AccountToken = Str(product, "obfuscatedExternalAccountId"),
            State = state.Value,
            RevokedAt = state == StoreSubscriptionState.Revoked ? now : null,
            Environment = Int(product, "purchaseType") == 0 ? SandboxEnvironment : ProductionEnvironment,
            PurchaseToken = purchaseToken,
            Quantity = Int(product, "quantity") ?? 1,
            NeedsAcknowledgement = Int(product, "consumptionState") == 0,
            EventAt = eventAt ?? now,
        };
    }

    // ── JSON helpers (store payloads use ms numbers, ISO strings or numeric strings) ───────────────────────────────

    public static string? Str(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var v)
            ? v.ValueKind switch
            {
                JsonValueKind.String => v.GetString(),
                JsonValueKind.Number => v.GetRawText(),
                _ => null,
            }
            : null;

    public static int? Int(JsonElement element, string name) =>
        Str(element, name) is { } s && int.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out var i) ? i : null;

    public static bool Bool(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;

    public static DateTime? Ms(JsonElement element, string name) => LongMs(element, name);

    private static DateTime? LongMs(JsonElement element, string name) =>
        Str(element, name) is { } s && long.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out var ms) && ms > 0
            ? DateTimeOffset.FromUnixTimeMilliseconds(ms).UtcDateTime
            : null;

    private static DateTime? Iso(JsonElement element, string name) =>
        Str(element, name) is { } s && DateTimeOffset.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var d)
            ? d.UtcDateTime
            : null;
}
