using System.Text.Json;
using Domain.Enum;
using Domain.Services;

namespace DomainTests.Services;

public class StoreRulesTests
{
    private static readonly DateTime Now = new(2026, 11, 19, 9, 0, 0, DateTimeKind.Utc);

    private static long Ms(DateTime at) => new DateTimeOffset(at).ToUnixTimeMilliseconds();

    private static JsonElement Json(object value) => JsonSerializer.SerializeToElement(value);

    private static JsonElement AppleSub(DateTime expires, DateTime? revoked = null, bool upgraded = false) => Json(new Dictionary<string, object?>
    {
        ["transactionId"] = "2000000002",
        ["originalTransactionId"] = "2000000001",
        ["bundleId"] = "com.alatech.droplet",
        ["productId"] = "com.alatech.droplet.premium.monthly",
        ["type"] = "Auto-Renewable Subscription",
        ["purchaseDate"] = Ms(expires.AddMonths(-1)),
        ["originalPurchaseDate"] = Ms(Now.AddMonths(-3)),
        ["expiresDate"] = Ms(expires),
        ["revocationDate"] = revoked is null ? null : Ms(revoked.Value),
        ["isUpgraded"] = upgraded,
        ["appAccountToken"] = "01890f2a-5f5b-7c3e-9a4f-0123456789ab",
        ["environment"] = "Sandbox",
        ["signedDate"] = Ms(Now.AddMinutes(-1)),
        ["quantity"] = 1,
    });

    [Fact]
    public void AccountToken_RoundTripsAUlidTenant_AndIsAUuid()
    {
        const string tenant = "01JCX3T7V0Q8M4ZK2R5N6P9W1B";
        var token = StoreAccountToken.FromTenantId(tenant);

        Assert.True(Guid.TryParse(token, out _));
        Assert.Equal(tenant, StoreAccountToken.TryTenantId(token));
        Assert.True(StoreAccountToken.Matches(tenant, token.ToUpperInvariant()));
        Assert.False(StoreAccountToken.Matches(tenant, StoreAccountToken.FromTenantId("01JCX3T7V0Q8M4ZK2R5N6P9W1C")));
    }

    [Fact]
    public void AccountToken_NonUlidTenant_GetsAStableUuid_ThatIsNotReversible()
    {
        var token = StoreAccountToken.FromTenantId("t1");
        Assert.Equal(token, StoreAccountToken.FromTenantId("t1"));
        Assert.True(Guid.TryParse(token, out _));
        Assert.NotEqual("t1", StoreAccountToken.TryTenantId(token));
        Assert.Null(StoreAccountToken.TryTenantId("not-a-uuid"));
    }

    [Theory]
    [InlineData("SUBSCRIBED", null, StoreNotificationAction.Apply)]
    [InlineData("DID_RENEW", null, StoreNotificationAction.Apply)]
    [InlineData("DID_CHANGE_RENEWAL_PREF", "UPGRADE", StoreNotificationAction.Apply)]
    [InlineData("DID_CHANGE_RENEWAL_PREF", "DOWNGRADE", StoreNotificationAction.Apply)]
    [InlineData("DID_FAIL_TO_RENEW", "GRACE_PERIOD", StoreNotificationAction.Apply)]
    [InlineData("DID_FAIL_TO_RENEW", null, StoreNotificationAction.Apply)]
    [InlineData("GRACE_PERIOD_EXPIRED", null, StoreNotificationAction.Apply)]
    [InlineData("EXPIRED", "VOLUNTARY", StoreNotificationAction.Apply)]
    [InlineData("REFUND_REVERSED", null, StoreNotificationAction.Apply)]
    [InlineData("ONE_TIME_CHARGE", null, StoreNotificationAction.Apply)]
    [InlineData("REFUND", null, StoreNotificationAction.Revoke)]
    [InlineData("REVOKE", null, StoreNotificationAction.Revoke)]
    [InlineData("TEST", null, StoreNotificationAction.Ignore)]
    [InlineData("CONSUMPTION_REQUEST", null, StoreNotificationAction.Ignore)]
    [InlineData("REFUND_DECLINED", null, StoreNotificationAction.Ignore)]
    [InlineData("RENEWAL_EXTENSION", "SUMMARY", StoreNotificationAction.Ignore)]
    public void AppleAction_Table(string type, string? subtype, StoreNotificationAction expected) =>
        Assert.Equal(expected, StoreRules.AppleAction(type, subtype));

    [Theory]
    [InlineData(1, StoreNotificationAction.Apply)]   // RECOVERED
    [InlineData(2, StoreNotificationAction.Apply)]   // RENEWED
    [InlineData(3, StoreNotificationAction.Apply)]   // CANCELED
    [InlineData(5, StoreNotificationAction.Apply)]   // ON_HOLD
    [InlineData(6, StoreNotificationAction.Apply)]   // IN_GRACE_PERIOD
    [InlineData(12, StoreNotificationAction.Revoke)] // REVOKED
    [InlineData(13, StoreNotificationAction.Apply)]  // EXPIRED
    [InlineData(99, StoreNotificationAction.Ignore)]
    public void GoogleSubscriptionAction_Table(int type, StoreNotificationAction expected) =>
        Assert.Equal(expected, StoreRules.GoogleSubscriptionAction(type));

    [Fact]
    public void Apple_ActiveSubscription_KeyIsTheOriginalTransaction()
    {
        var result = StoreRules.FromAppleTransaction(AppleSub(Now.AddDays(10)), null, Now);

        Assert.Equal(PurchaseVerificationStatus.Verified, result.Status);
        Assert.Equal(StoreSubscriptionState.Active, result.State);
        Assert.Equal("2000000001", result.OriginalTransactionId);
        Assert.Equal(Now.AddDays(10), result.ExpiresAt!.Value, TimeSpan.FromMilliseconds(1));
        Assert.Equal(Now.AddMonths(-3), result.PurchasedAt!.Value, TimeSpan.FromMilliseconds(1));
        Assert.Equal(StoreProductKind.Subscription, result.Kind);
        Assert.Equal("01890f2a-5f5b-7c3e-9a4f-0123456789ab", result.AccountToken);
    }

    [Fact]
    public void Apple_GracePeriod_KeepsAccessUntilGraceEnds()
    {
        var renewal = Json(new { gracePeriodExpiresDate = Ms(Now.AddDays(6)), isInBillingRetryPeriod = true });
        var result = StoreRules.FromAppleTransaction(AppleSub(Now.AddDays(-1)), renewal, Now);

        Assert.Equal(StoreSubscriptionState.GracePeriod, result.State);
        Assert.Equal(Now.AddDays(6), result.ExpiresAt!.Value, TimeSpan.FromMilliseconds(1));
        Assert.True(StoreRules.HasAccess(result.State));
    }

    [Fact]
    public void Apple_BillingRetryWithoutGrace_HasNoAccess()
    {
        var renewal = Json(new { isInBillingRetryPeriod = true });
        var result = StoreRules.FromAppleTransaction(AppleSub(Now.AddDays(-1)), renewal, Now);

        Assert.Equal(StoreSubscriptionState.BillingRetry, result.State);
        Assert.True(result.ExpiresAt <= Now);
    }

    [Fact]
    public void Apple_Expired_And_Revoked()
    {
        Assert.Equal(StoreSubscriptionState.Expired, StoreRules.FromAppleTransaction(AppleSub(Now.AddDays(-1)), null, Now).State);

        var revoked = StoreRules.FromAppleTransaction(AppleSub(Now.AddDays(20), revoked: Now.AddDays(-2)), null, Now);
        Assert.Equal(StoreSubscriptionState.Revoked, revoked.State);
        Assert.Equal(Now.AddDays(-2), revoked.ExpiresAt!.Value, TimeSpan.FromMilliseconds(1));
    }

    [Fact]
    public void Apple_Consumable_KeyIsTheTransaction_AndNeverExpires()
    {
        var tx = Json(new
        {
            transactionId = "3000000009", originalTransactionId = "3000000009", bundleId = "com.alatech.droplet",
            productId = "com.alatech.droplet.credits.20", type = "Consumable", purchaseDate = Ms(Now), quantity = 1, environment = "Production",
        });
        var result = StoreRules.FromAppleTransaction(tx, null, Now);

        Assert.Equal(StoreProductKind.Consumable, result.Kind);
        Assert.Equal("3000000009", result.OriginalTransactionId);
        Assert.Null(result.ExpiresAt);
        Assert.Equal(StoreSubscriptionState.Active, result.State);
    }

    [Fact]
    public void Apple_MissingFields_IsInvalid() =>
        Assert.Equal(PurchaseVerificationStatus.Invalid, StoreRules.FromAppleTransaction(Json(new { productId = "x" }), null, Now).Status);

    [Theory]
    [InlineData("SUBSCRIPTION_STATE_ACTIVE", 10, StoreSubscriptionState.Active)]
    [InlineData("SUBSCRIPTION_STATE_IN_GRACE_PERIOD", 3, StoreSubscriptionState.GracePeriod)]
    [InlineData("SUBSCRIPTION_STATE_ON_HOLD", -2, StoreSubscriptionState.BillingRetry)]
    [InlineData("SUBSCRIPTION_STATE_PAUSED", 5, StoreSubscriptionState.Expired)]
    [InlineData("SUBSCRIPTION_STATE_CANCELED", 5, StoreSubscriptionState.Active)]
    [InlineData("SUBSCRIPTION_STATE_CANCELED", -1, StoreSubscriptionState.Expired)]
    [InlineData("SUBSCRIPTION_STATE_EXPIRED", -1, StoreSubscriptionState.Expired)]
    [InlineData("SUBSCRIPTION_STATE_PENDING", 30, StoreSubscriptionState.Pending)]
    public void Google_SubscriptionStates(string state, int expiryDays, StoreSubscriptionState expected)
    {
        var json = Json(new
        {
            subscriptionState = state,
            startTime = "2026-08-01T10:00:00Z",
            latestOrderId = "GPA.1234",
            acknowledgementState = "ACKNOWLEDGEMENT_STATE_PENDING",
            lineItems = new[] { new { productId = "com.alatech.droplet.premium.yearly", expiryTime = Now.AddDays(expiryDays).ToString("O") } },
            externalAccountIdentifiers = new { obfuscatedExternalAccountId = "acc" },
        });
        var result = StoreRules.FromGoogleSubscription(json, "token-1", Now);

        Assert.Equal(expected, result.State);
        Assert.Equal(StoreRules.GoogleKey("token-1"), result.OriginalTransactionId);
        Assert.Equal("acc", result.AccountToken);
        Assert.True(result.NeedsAcknowledgement);
        // No access → the window is closed now at the latest.
        if (!StoreRules.HasAccess(expected))
            Assert.True(result.ExpiresAt <= Now);
    }

    [Fact]
    public void Google_Upgrade_CarriesTheLinkedTokenKey()
    {
        var json = Json(new
        {
            subscriptionState = "SUBSCRIPTION_STATE_ACTIVE",
            linkedPurchaseToken = "old-token",
            lineItems = new[] { new { productId = "com.alatech.droplet.premium.yearly", expiryTime = Now.AddYears(1).ToString("O") } },
        });
        Assert.Equal(StoreRules.GoogleKey("old-token"), StoreRules.FromGoogleSubscription(json, "new-token", Now).LinkedOriginalTransactionId);
    }

    [Theory]
    [InlineData(0, StoreSubscriptionState.Active)]
    [InlineData(1, StoreSubscriptionState.Revoked)]
    [InlineData(2, StoreSubscriptionState.Pending)]
    public void Google_ProductStates(int purchaseState, StoreSubscriptionState expected)
    {
        var json = Json(new { purchaseState, consumptionState = 0, orderId = "GPA.9", purchaseTimeMillis = Ms(Now).ToString(), purchaseType = 0 });
        var result = StoreRules.FromGoogleProduct(json, "com.alatech.droplet.credits.20", "tok", Now);

        Assert.Equal(expected, result.State);
        Assert.Equal(StoreProductKind.Consumable, result.Kind);
        Assert.Equal("Sandbox", result.Environment);
    }

    [Fact]
    public void Ordering_AndPackRemoval()
    {
        Assert.False(StoreRules.IsStale(null, Now));
        Assert.False(StoreRules.IsStale(Now, Now));
        Assert.True(StoreRules.IsStale(Now, Now.AddSeconds(-1)));
        Assert.Equal(20, StoreRules.PackCreditsToRemove(35, 20));
        Assert.Equal(7, StoreRules.PackCreditsToRemove(7, 20));
        Assert.Equal(0, StoreRules.PackCreditsToRemove(0, 20));
    }

    [Theory]
    [InlineData(DevicePlatform.Ios, "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90", null, PushTokenType.Apns)]
    [InlineData(DevicePlatform.Ios, "fcm:APA91bH-abc_def", null, PushTokenType.Fcm)]
    [InlineData(DevicePlatform.Android, "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90", null, PushTokenType.Fcm)]
    [InlineData(DevicePlatform.Ios, "anything", PushTokenType.Fcm, PushTokenType.Fcm)]
    public void PushTokenType_IsDeclaredOrInferred(DevicePlatform platform, string token, PushTokenType? declared, PushTokenType expected) =>
        Assert.Equal(expected, PushTokenRules.Resolve(platform, token, declared));
}
