using System.Text.Json;
using Domain.Entity;
using Domain.Enum;
using Domain.Options;
using Domain.Services;
using Infrastructure.Services;
using Infrastructure.Services.Purchases;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using Tests.Shared;

namespace InfrastructureTests;

internal sealed class FakePlayApi : IGooglePlayDeveloperApi
{
    public bool IsConfigured { get; set; } = true;
    public Dictionary<string, object> Subscriptions { get; } = [];
    public Dictionary<string, object> Products { get; } = [];
    public List<string> Acknowledged { get; } = [];
    public List<string> Consumed { get; } = [];

    public Task<JsonDocument?> GetSubscriptionAsync(string purchaseToken, CancellationToken ct) =>
        Task.FromResult(Subscriptions.TryGetValue(purchaseToken, out var s) ? JsonSerializer.SerializeToDocument(s) : null);

    public Task<JsonDocument?> GetProductAsync(string productId, string purchaseToken, CancellationToken ct) =>
        Task.FromResult(Products.TryGetValue(purchaseToken, out var p) ? JsonSerializer.SerializeToDocument(p) : null);

    public Task<bool> AcknowledgeSubscriptionAsync(string productId, string purchaseToken, CancellationToken ct)
    {
        Acknowledged.Add(purchaseToken);
        return Task.FromResult(true);
    }

    public Task<bool> ConsumeProductAsync(string productId, string purchaseToken, CancellationToken ct)
    {
        Consumed.Add(purchaseToken);
        return Task.FromResult(true);
    }
}

internal sealed class FakeAppStoreApi : IAppStoreServerApi
{
    public bool IsConfigured { get; set; }
    public Dictionary<string, string> Transactions { get; } = [];
    public Dictionary<string, AppleSubscriptionStatus> Statuses { get; } = [];

    public Task<string?> GetTransactionAsync(string transactionId, string? environment, CancellationToken ct) =>
        Task.FromResult(Transactions.GetValueOrDefault(transactionId));

    public Task<AppleSubscriptionStatus?> GetSubscriptionStatusAsync(string originalTransactionId, string? environment, CancellationToken ct) =>
        Task.FromResult(Statuses.GetValueOrDefault(originalTransactionId));
}

/// <summary>Real verifier, purchase and credit services over an in-memory table; Apple chain and Play API are fakes.</summary>
internal sealed class PurchaseHarness : IDisposable
{
    public const string Tenant = "01JCX3T7V0Q8M4ZK2R5N6P9W1B";
    public const string OtherTenant = "01JCX3T7V0Q8M4ZK2R5N6P9W1C";
    public const string Monthly = "com.alatech.droplet.premium.monthly";
    public const string Yearly = "com.alatech.droplet.premium.yearly";
    public const string Credits20 = "com.alatech.droplet.credits.20";

    public StoreKitTestChain Chain { get; } = new();
    public InMemoryRepository Repository { get; } = new();
    public FakeTimeProvider Clock { get; } = Fixtures.Clock();
    public FakePlayApi Play { get; } = new();
    public FakeAppStoreApi AppStore { get; } = new();
    public StoreOptions Store { get; } = new()
    {
        ProductIds = { Premium = [Monthly, Yearly] },
        CreditPacks = { [Credits20] = 20 },
    };
    public CreditService Credits { get; }
    public PurchaseService Purchases { get; }
    public StorePurchaseVerifier Verifier { get; }
    public StoreSyncService Sync { get; }
    public EntitlementService Entitlement { get; }

    public PurchaseHarness()
    {
        var store = Fixtures.Monitor(Store);
        Credits = new CreditService(Repository, Fixtures.Entitlements(), Clock, NullLogger<CreditService>.Instance);
        Purchases = new PurchaseService(Repository, Credits, store, Clock, NullLogger<PurchaseService>.Instance);
        var jws = new AppleJwsVerifier(Chain, Clock);
        Verifier = new StorePurchaseVerifier(jws, AppStore, Play, store, Clock, NullLogger<StorePurchaseVerifier>.Instance);
        Sync = new StoreSyncService(Verifier, Purchases, jws, Repository, store, Clock, NullLogger<StoreSyncService>.Instance);
        Entitlement = new EntitlementService(Repository, Fixtures.Entitlements(), Clock);
        Repository.SaveAsync(new TenantEntity { Id = Tenant, OwnerUserId = "u1" }).GetAwaiter().GetResult();
    }

    public DateTime Now => Clock.GetUtcNow().UtcDateTime;

    public static long Ms(DateTime at) => new DateTimeOffset(DateTime.SpecifyKind(at, DateTimeKind.Utc)).ToUnixTimeMilliseconds();

    public Dictionary<string, object?> AppleTx(string productId, string transactionId, string originalTransactionId, DateTime? expires,
        string? accountToken = null, DateTime? revoked = null, DateTime? signed = null, string bundleId = "com.alatech.droplet",
        string environment = "Sandbox") => new()
    {
        ["transactionId"] = transactionId,
        ["originalTransactionId"] = originalTransactionId,
        ["bundleId"] = bundleId,
        ["productId"] = productId,
        ["type"] = productId == Credits20 ? "Consumable" : "Auto-Renewable Subscription",
        ["purchaseDate"] = Ms(Now.AddDays(-1)),
        ["originalPurchaseDate"] = Ms(Now.AddDays(-1)),
        ["expiresDate"] = expires is null ? null : Ms(expires.Value),
        ["revocationDate"] = revoked is null ? null : Ms(revoked.Value),
        ["appAccountToken"] = accountToken ?? StoreAccountToken.FromTenantId(Tenant),
        ["environment"] = environment,
        ["signedDate"] = Ms(signed ?? Now),
        ["quantity"] = 1,
    };

    public string AppleNotification(string type, string? subtype, Dictionary<string, object?> transaction, object? renewal = null,
        string? uuid = null, DateTime? signed = null) => Chain.Sign(new Dictionary<string, object?>
    {
        ["notificationType"] = type,
        ["subtype"] = subtype,
        ["notificationUUID"] = uuid ?? Guid.NewGuid().ToString(),
        ["version"] = "2.0",
        ["signedDate"] = Ms(signed ?? Now),
        ["data"] = new Dictionary<string, object?>
        {
            ["bundleId"] = "com.alatech.droplet",
            ["environment"] = "Sandbox",
            ["signedTransactionInfo"] = Chain.Sign(transaction),
            ["signedRenewalInfo"] = renewal is null ? null : Chain.Sign(renewal),
        },
    });

    public static string Rtdn(object notification) =>
        Convert.ToBase64String(JsonSerializer.SerializeToUtf8Bytes(new Dictionary<string, object>(
            JsonSerializer.Deserialize<Dictionary<string, object>>(JsonSerializer.Serialize(notification))!)
        {
            ["version"] = "1.0",
            ["packageName"] = "com.alatech.droplet",
            ["eventTimeMillis"] = Ms(Fixtures.Now).ToString(),
        }));

    public Task<EntitlementSnapshot> SnapshotAsync(string tenantId = Tenant) => Entitlement.GetAsync(tenantId, default);

    public void Dispose() => Chain.Dispose();
}

public class AppleJwsVerifierTests
{
    private static readonly DateTime Now = Fixtures.Now;

    private static object Payload(DateTime? signed = null) => new Dictionary<string, object?>
    {
        ["transactionId"] = "1", ["environment"] = "Sandbox", ["signedDate"] = PurchaseHarness.Ms(signed ?? Now),
    };

    [Fact]
    public void ValidChain_ReturnsThePayload()
    {
        using var chain = new StoreKitTestChain();
        var verified = new AppleJwsVerifier(chain, Fixtures.Clock()).Verify(chain.Sign(Payload()));

        Assert.NotNull(verified);
        Assert.Equal("1", verified.Payload.GetProperty("transactionId").GetString());
        Assert.Equal("Sandbox", verified.Environment);
    }

    [Fact]
    public void TamperedPayload_IsRejected()
    {
        using var chain = new StoreKitTestChain();
        var parts = chain.Sign(Payload()).Split('.');
        var forged = StoreKitTestChain.B64(JsonSerializer.SerializeToUtf8Bytes(new { transactionId = "2", environment = "Sandbox" }));

        Assert.Null(new AppleJwsVerifier(chain, Fixtures.Clock()).Verify($"{parts[0]}.{forged}.{parts[2]}"));
    }

    [Fact]
    public void ChainFromAnotherRoot_IsRejected()
    {
        using var trusted = new StoreKitTestChain();
        using var attacker = new StoreKitTestChain();

        Assert.Null(new AppleJwsVerifier(trusted, Fixtures.Clock()).Verify(attacker.Sign(Payload())));
    }

    [Theory]
    [InlineData(false, true)]
    [InlineData(true, false)]
    public void MissingAppleMarkerOid_IsRejected(bool leafOid, bool intermediateOid)
    {
        using var chain = new StoreKitTestChain(leafOid, intermediateOid);
        Assert.Null(new AppleJwsVerifier(chain, Fixtures.Clock()).Verify(chain.Sign(Payload())));
    }

    [Theory]
    [InlineData("HS256")]
    [InlineData("none")]
    [InlineData("ES384")]
    public void OtherAlgorithms_AreRejected(string alg)
    {
        using var chain = new StoreKitTestChain();
        Assert.Null(new AppleJwsVerifier(chain, Fixtures.Clock()).Verify(chain.Sign(Payload(), alg)));
    }

    [Fact]
    public void LeafExpiredAtSignedDate_IsRejected_ButValidBeforeExpiry()
    {
        using var chain = new StoreKitTestChain(leafNotAfter: new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero));
        var verifier = new AppleJwsVerifier(chain, Fixtures.Clock());

        Assert.Null(verifier.Verify(chain.Sign(Payload(Now))));
        // An old transaction signed while the certificate was valid still verifies (effective date = signedDate).
        Assert.NotNull(verifier.Verify(chain.Sign(Payload(new DateTime(2025, 6, 1, 0, 0, 0, DateTimeKind.Utc)))));
    }

    [Theory]
    [InlineData("")]
    [InlineData("a.b")]
    [InlineData("not.a.jws")]
    public void Garbage_IsRejected(string value)
    {
        using var chain = new StoreKitTestChain();
        Assert.Null(new AppleJwsVerifier(chain, Fixtures.Clock()).Verify(value));
    }

    [Fact]
    public void EmbeddedAppleRoot_MatchesItsPinnedFingerprint()
    {
        var root = AppleRootCertificates.AppleRootCaG3Certificate;
        Assert.Contains("CN=Apple Root CA - G3", root.Subject);
        Assert.Equal(AppleRootCertificates.AppleRootCaG3Sha256, root.GetCertHashString(System.Security.Cryptography.HashAlgorithmName.SHA256));
    }

    [Fact]
    public void XcodeTestRoot_IsTrustedOnlyForTheXcodeEnvironment()
    {
        using var chain = new StoreKitTestChain(leafOid: false, intermediateOid: false);
        var roots = new AppleRootCertificates(Fixtures.Monitor(new StoreOptions { XcodeTestRootCertificate = Convert.ToBase64String(chain.Root.RawData) }));
        var verifier = new AppleJwsVerifier(roots, Fixtures.Clock());

        Assert.NotNull(verifier.Verify(chain.Sign(new { transactionId = "1", environment = "Xcode", signedDate = PurchaseHarness.Ms(Now) })));
        Assert.Null(verifier.Verify(chain.Sign(new { transactionId = "1", environment = "Production", signedDate = PurchaseHarness.Ms(Now) })));
        // Without the setting only Apple's real root is trusted.
        Assert.Null(new AppleJwsVerifier(new AppleRootCertificates(Fixtures.Monitor(new StoreOptions())), Fixtures.Clock())
            .Verify(chain.Sign(new { transactionId = "1", environment = "Xcode", signedDate = PurchaseHarness.Ms(Now) })));
    }
}

public class ApplePurchaseTests
{
    [Fact]
    public async Task Subscription_GrantsPremiumWith30Credits_AndIsIdempotent()
    {
        using var h = new PurchaseHarness();
        var jws = h.Chain.Sign(h.AppleTx(PurchaseHarness.Monthly, "2000000001", "2000000001", h.Now.AddDays(30)));

        Assert.Equal(StorePurchaseOutcome.Applied, await h.Sync.PurchaseAsync(PurchaseHarness.Tenant, StorePlatform.Apple, PurchaseHarness.Monthly, jws, default));
        Assert.Equal(StorePurchaseOutcome.Applied, await h.Sync.PurchaseAsync(PurchaseHarness.Tenant, StorePlatform.Apple, PurchaseHarness.Monthly, jws, default));

        var snapshot = await h.SnapshotAsync();
        Assert.Equal(Tier.Premium, snapshot.Active.Tier);
        Assert.Equal(30, snapshot.Credits.AllowanceRemaining);
        Assert.Single(await h.Repository.GetAllAsync<EntitlementEntity>(EntitlementEntity.GetPk(PurchaseHarness.Tenant)));
        Assert.Equal(StoreSubscriptionState.Active, snapshot.Active.Source!.State);
    }

    [Fact]
    public async Task Consumable_AddsTwentyCreditsOnce_EvenWhenPostedAgain()
    {
        using var h = new PurchaseHarness();
        var jws = h.Chain.Sign(h.AppleTx(PurchaseHarness.Credits20, "3000000001", "3000000001", null));

        for (var i = 0; i < 3; i++)
            Assert.Equal(StorePurchaseOutcome.Applied, await h.Sync.PurchaseAsync(PurchaseHarness.Tenant, StorePlatform.Apple, PurchaseHarness.Credits20, jws, default));

        Assert.Equal(20, (await h.SnapshotAsync()).Credits.PackRemaining);
        Assert.Equal(Tier.Free, (await h.SnapshotAsync()).Active.Tier);
    }

    [Fact]
    public async Task ProductMismatch_WrongBundle_UnknownProduct_AreRejected()
    {
        using var h = new PurchaseHarness();
        var monthly = h.Chain.Sign(h.AppleTx(PurchaseHarness.Monthly, "1", "1", h.Now.AddDays(30)));
        var otherApp = h.Chain.Sign(h.AppleTx(PurchaseHarness.Monthly, "2", "2", h.Now.AddDays(30), bundleId: "com.other.app"));
        var unknown = h.Chain.Sign(h.AppleTx("com.alatech.droplet.lifetime", "3", "3", null));

        Assert.Equal(StorePurchaseOutcome.Invalid, await h.Sync.PurchaseAsync(PurchaseHarness.Tenant, StorePlatform.Apple, PurchaseHarness.Yearly, monthly, default));
        Assert.Equal(StorePurchaseOutcome.Invalid, await h.Sync.PurchaseAsync(PurchaseHarness.Tenant, StorePlatform.Apple, PurchaseHarness.Monthly, otherApp, default));
        Assert.Equal(StorePurchaseOutcome.UnknownProduct, await h.Sync.PurchaseAsync(PurchaseHarness.Tenant, StorePlatform.Apple, "com.alatech.droplet.lifetime", unknown, default));
        Assert.Equal(Tier.Free, (await h.SnapshotAsync()).Active.Tier);
    }

    [Fact]
    public async Task ProductionTransaction_IsAccepted_SandboxOnlyWhenAllowed()
    {
        using var h = new PurchaseHarness();
        h.Store.AcceptSandbox = false;
        var sandbox = h.Chain.Sign(h.AppleTx(PurchaseHarness.Monthly, "1", "1", h.Now.AddDays(30)));
        var production = h.Chain.Sign(h.AppleTx(PurchaseHarness.Monthly, "2", "2", h.Now.AddDays(30), environment: "Production"));

        Assert.Equal(StorePurchaseOutcome.Invalid, await h.Sync.PurchaseAsync(PurchaseHarness.Tenant, StorePlatform.Apple, PurchaseHarness.Monthly, sandbox, default));
        Assert.Equal(StorePurchaseOutcome.Applied, await h.Sync.PurchaseAsync(PurchaseHarness.Tenant, StorePlatform.Apple, PurchaseHarness.Monthly, production, default));
    }

    [Fact]
    public async Task AppAccountTokenOfAnotherAccount_IsRefused()
    {
        using var h = new PurchaseHarness();
        var jws = h.Chain.Sign(h.AppleTx(PurchaseHarness.Monthly, "1", "1", h.Now.AddDays(30), accountToken: StoreAccountToken.FromTenantId(PurchaseHarness.OtherTenant)));

        Assert.Equal(StorePurchaseOutcome.AccountMismatch, await h.Sync.PurchaseAsync(PurchaseHarness.Tenant, StorePlatform.Apple, PurchaseHarness.Monthly, jws, default));
    }

    [Fact]
    public async Task PurchaseOwnedByAnotherExistingAccount_IsRefused_ButADeletedOwnerReleasesIt()
    {
        using var h = new PurchaseHarness();
        await h.Repository.SaveAsync(new TenantEntity { Id = PurchaseHarness.OtherTenant, OwnerUserId = "u2" });
        // Bought without an account token (e.g. before the app sent one): the first account that posts it owns it.
        var tx = h.AppleTx(PurchaseHarness.Monthly, "1", "1", h.Now.AddDays(30));
        tx["appAccountToken"] = null;
        var jws = h.Chain.Sign(tx);

        Assert.Equal(StorePurchaseOutcome.Applied, await h.Sync.PurchaseAsync(PurchaseHarness.OtherTenant, StorePlatform.Apple, PurchaseHarness.Monthly, jws, default));
        Assert.Equal(StorePurchaseOutcome.OwnedByAnotherAccount, await h.Sync.PurchaseAsync(PurchaseHarness.Tenant, StorePlatform.Apple, PurchaseHarness.Monthly, jws, default));

        await h.Repository.DeleteAsync(TenantEntity.GetPk(), TenantEntity.GetSk(PurchaseHarness.OtherTenant));
        Assert.Equal(StorePurchaseOutcome.Applied, await h.Sync.PurchaseAsync(PurchaseHarness.Tenant, StorePlatform.Apple, PurchaseHarness.Monthly, jws, default));
    }

    [Fact]
    public async Task BareTransactionId_NeedsTheServerApi()
    {
        using var h = new PurchaseHarness();
        Assert.Equal(StorePurchaseOutcome.NotAvailable, await h.Sync.PurchaseAsync(PurchaseHarness.Tenant, StorePlatform.Apple, PurchaseHarness.Monthly, "2000000001", default));

        h.AppStore.IsConfigured = true;
        h.AppStore.Transactions["2000000001"] = h.Chain.Sign(h.AppleTx(PurchaseHarness.Monthly, "2000000001", "2000000001", h.Now.AddDays(30)));
        Assert.Equal(StorePurchaseOutcome.Applied, await h.Sync.PurchaseAsync(PurchaseHarness.Tenant, StorePlatform.Apple, PurchaseHarness.Monthly, "2000000001", default));
    }

    [Fact]
    public async Task ServerApiStatus_WinsOverTheDevicesOlderTransaction()
    {
        using var h = new PurchaseHarness();
        h.AppStore.IsConfigured = true;
        // The device still holds last month's (now expired) transaction; the chain is in its grace period.
        var deviceJws = h.Chain.Sign(h.AppleTx(PurchaseHarness.Monthly, "1", "1", h.Now.AddDays(-1), signed: h.Now.AddDays(-31)));
        h.AppStore.Statuses["1"] = new AppleSubscriptionStatus(
            h.Chain.Sign(h.AppleTx(PurchaseHarness.Monthly, "5", "1", h.Now.AddDays(-1))),
            h.Chain.Sign(new { gracePeriodExpiresDate = PurchaseHarness.Ms(h.Now.AddDays(5)), isInBillingRetryPeriod = true }), 4);

        Assert.Equal(StorePurchaseOutcome.Applied, await h.Sync.PurchaseAsync(PurchaseHarness.Tenant, StorePlatform.Apple, PurchaseHarness.Monthly, deviceJws, default));

        var snapshot = await h.SnapshotAsync();
        Assert.Equal(Tier.Premium, snapshot.Active.Tier);
        Assert.Equal(StoreSubscriptionState.GracePeriod, snapshot.Active.Source!.State);
    }
}

public class AppleNotificationTests
{
    private static async Task<PurchaseHarness> SubscribedAsync()
    {
        var h = new PurchaseHarness();
        var jws = h.Chain.Sign(h.AppleTx(PurchaseHarness.Monthly, "10", "10", h.Now.AddDays(5), signed: h.Now.AddDays(-25)));
        Assert.Equal(StorePurchaseOutcome.Applied, await h.Sync.PurchaseAsync(PurchaseHarness.Tenant, StorePlatform.Apple, PurchaseHarness.Monthly, jws, default));
        return h;
    }

    [Fact]
    public async Task DidRenew_ExtendsAccess_AndAnOlderLateNotificationNeverRollsBack()
    {
        using var h = await SubscribedAsync();
        var renewed = h.AppleTx(PurchaseHarness.Monthly, "11", "10", h.Now.AddDays(35));

        Assert.Equal(StoreNotificationOutcome.Processed, await h.Sync.HandleAppleAsync(h.AppleNotification("DID_RENEW", null, renewed), default));
        var expires = (await h.SnapshotAsync()).Active.Source!.ExpiresAt;
        Assert.Equal(h.Now.AddDays(35), expires!.Value, TimeSpan.FromSeconds(1));

        // An EXPIRED signed before the renewal arrives late: ignored.
        var old = h.AppleTx(PurchaseHarness.Monthly, "10", "10", h.Now.AddDays(-1));
        Assert.Equal(StoreNotificationOutcome.Processed,
            await h.Sync.HandleAppleAsync(h.AppleNotification("EXPIRED", "VOLUNTARY", old, signed: h.Now.AddDays(-1)), default));
        Assert.Equal(Tier.Premium, (await h.SnapshotAsync()).Active.Tier);
    }

    [Fact]
    public async Task UpgradeAndDowngrade_ChangeTheProductOfTheSameChain()
    {
        using var h = await SubscribedAsync();
        var upgraded = h.AppleTx(PurchaseHarness.Yearly, "12", "10", h.Now.AddYears(1));

        await h.Sync.HandleAppleAsync(h.AppleNotification("DID_CHANGE_RENEWAL_PREF", "UPGRADE", upgraded), default);

        var source = (await h.SnapshotAsync()).Active.Source!;
        Assert.Equal(PurchaseHarness.Yearly, source.ProductId);
        Assert.Single(await h.Repository.GetAllAsync<EntitlementEntity>(EntitlementEntity.GetPk(PurchaseHarness.Tenant)));
    }

    [Fact]
    public async Task BillingRetry_GracePeriod_ThenExpiry()
    {
        using var h = await SubscribedAsync();
        h.Clock.Advance(TimeSpan.FromDays(6)); // the paid period ended yesterday
        var lapsed = h.AppleTx(PurchaseHarness.Monthly, "10", "10", h.Now.AddDays(-1));

        await h.Sync.HandleAppleAsync(h.AppleNotification("DID_FAIL_TO_RENEW", "GRACE_PERIOD", lapsed,
            renewal: new { gracePeriodExpiresDate = PurchaseHarness.Ms(h.Now.AddDays(5)), isInBillingRetryPeriod = true }), default);
        var grace = await h.SnapshotAsync();
        Assert.Equal(Tier.Premium, grace.Active.Tier);
        Assert.Equal(StoreSubscriptionState.GracePeriod, grace.Active.Source!.State);

        h.Clock.Advance(TimeSpan.FromDays(6));
        await h.Sync.HandleAppleAsync(h.AppleNotification("GRACE_PERIOD_EXPIRED", null, lapsed,
            renewal: new { isInBillingRetryPeriod = true }), default);
        Assert.Equal(Tier.Free, (await h.SnapshotAsync()).Active.Tier);
    }

    [Fact]
    public async Task RefundOfSubscription_RemovesAccess()
    {
        using var h = await SubscribedAsync();
        var refunded = h.AppleTx(PurchaseHarness.Monthly, "10", "10", h.Now.AddDays(5), revoked: h.Now.AddMinutes(-5));

        await h.Sync.HandleAppleAsync(h.AppleNotification("REFUND", null, refunded), default);

        var snapshot = await h.SnapshotAsync();
        Assert.Equal(Tier.Free, snapshot.Active.Tier);
        var row = Assert.Single(await h.Repository.GetAllAsync<EntitlementEntity>(EntitlementEntity.GetPk(PurchaseHarness.Tenant)));
        Assert.Equal(StoreSubscriptionState.Revoked, row.State);
    }

    [Fact]
    public async Task RefundOfConsumable_RemovesWhatIsLeft_NeverBelowZero_Once()
    {
        using var h = new PurchaseHarness();
        var pack = h.AppleTx(PurchaseHarness.Credits20, "30", "30", null);
        await h.Sync.PurchaseAsync(PurchaseHarness.Tenant, StorePlatform.Apple, PurchaseHarness.Credits20, h.Chain.Sign(pack), default);
        for (var i = 0; i < 15; i++)
        {
            await h.Credits.ReserveAsync(PurchaseHarness.Tenant, $"k{i}", $"j{i}", default);
            await h.Credits.CommitAsync(PurchaseHarness.Tenant, $"k{i}", default);
        }
        Assert.Equal(5, (await h.SnapshotAsync()).Credits.PackRemaining);

        var refunded = h.AppleTx(PurchaseHarness.Credits20, "30", "30", null, revoked: h.Now);
        await h.Sync.HandleAppleAsync(h.AppleNotification("REFUND", null, refunded), default);
        Assert.Equal(0, (await h.SnapshotAsync()).Credits.PackRemaining);

        // A second pack bought later is not touched by a repeated refund notification of the first one.
        await h.Sync.PurchaseAsync(PurchaseHarness.Tenant, StorePlatform.Apple, PurchaseHarness.Credits20,
            h.Chain.Sign(h.AppleTx(PurchaseHarness.Credits20, "31", "31", null)), default);
        await h.Sync.HandleAppleAsync(h.AppleNotification("REFUND", null, refunded), default);
        Assert.Equal(20, (await h.SnapshotAsync()).Credits.PackRemaining);
    }

    [Fact]
    public async Task SameNotificationTwice_IsProcessedOnce()
    {
        using var h = await SubscribedAsync();
        var payload = h.AppleNotification("DID_RENEW", null, h.AppleTx(PurchaseHarness.Monthly, "11", "10", h.Now.AddDays(35)), uuid: "n-1");

        Assert.Equal(StoreNotificationOutcome.Processed, await h.Sync.HandleAppleAsync(payload, default));
        Assert.Equal(StoreNotificationOutcome.Duplicate, await h.Sync.HandleAppleAsync(payload, default));
    }

    [Fact]
    public async Task ConsumableBoughtButNeverPostedByTheApp_IsGrantedFromTheNotification()
    {
        using var h = new PurchaseHarness();
        await h.Sync.HandleAppleAsync(h.AppleNotification("ONE_TIME_CHARGE", null, h.AppleTx(PurchaseHarness.Credits20, "40", "40", null)), default);

        Assert.Equal(20, (await h.SnapshotAsync()).Credits.PackRemaining);
    }

    [Fact]
    public async Task UnknownAccount_IsAcknowledgedWithoutWrites()
    {
        using var h = new PurchaseHarness();
        var tx = h.AppleTx(PurchaseHarness.Monthly, "50", "50", h.Now.AddDays(30), accountToken: StoreAccountToken.FromTenantId("01JCX3T7V0Q8M4ZK2R5N6P9W1D"));

        Assert.Equal(StoreNotificationOutcome.Processed, await h.Sync.HandleAppleAsync(h.AppleNotification("SUBSCRIBED", "INITIAL_BUY", tx), default));
        Assert.Empty(await h.Repository.GetAllAsync<EntitlementEntity>(EntitlementEntity.GetPk("01JCX3T7V0Q8M4ZK2R5N6P9W1D")));
    }

    [Fact]
    public async Task ForgedOrForeignNotifications_AreInvalid()
    {
        using var h = new PurchaseHarness();
        using var attacker = new StoreKitTestChain();
        var foreign = h.Chain.Sign(new
        {
            notificationType = "DID_RENEW", notificationUUID = "x", signedDate = PurchaseHarness.Ms(h.Now),
            data = new { bundleId = "com.other.app", environment = "Sandbox", signedTransactionInfo = "a.b.c" },
        });
        var forged = attacker.Sign(new { notificationType = "DID_RENEW", notificationUUID = "y", data = new { bundleId = "com.alatech.droplet" } });

        Assert.Equal(StoreNotificationOutcome.Invalid, await h.Sync.HandleAppleAsync(foreign, default));
        Assert.Equal(StoreNotificationOutcome.Invalid, await h.Sync.HandleAppleAsync(forged, default));
        Assert.Equal(StoreNotificationOutcome.Invalid, await h.Sync.HandleAppleAsync("not-a-jws", default));
    }

    [Fact]
    public async Task TestNotification_IsIgnored()
    {
        using var h = new PurchaseHarness();
        var test = h.Chain.Sign(new
        {
            notificationType = "TEST", notificationUUID = "t-1", signedDate = PurchaseHarness.Ms(h.Now),
            data = new { bundleId = "com.alatech.droplet", environment = "Sandbox" },
        });
        Assert.Equal(StoreNotificationOutcome.Ignored, await h.Sync.HandleAppleAsync(test, default));
    }
}

public class GooglePurchaseTests
{
    private static object Subscription(string state, DateTime expiry, string productId = PurchaseHarness.Yearly, string? linked = null, string ack = "ACKNOWLEDGEMENT_STATE_PENDING") =>
        new Dictionary<string, object?>
        {
            ["subscriptionState"] = state,
            ["startTime"] = Fixtures.Now.AddDays(-1).ToString("O"),
            ["latestOrderId"] = "GPA.1",
            ["acknowledgementState"] = ack,
            ["linkedPurchaseToken"] = linked,
            ["lineItems"] = new[] { new { productId, expiryTime = expiry.ToString("O") } },
            ["externalAccountIdentifiers"] = new { obfuscatedExternalAccountId = StoreAccountToken.FromTenantId(PurchaseHarness.Tenant) },
        };

    [Fact]
    public async Task Subscription_IsVerified_Granted_AndAcknowledged()
    {
        using var h = new PurchaseHarness();
        h.Play.Subscriptions["tok-1"] = Subscription("SUBSCRIPTION_STATE_ACTIVE", h.Now.AddYears(1));

        Assert.Equal(StorePurchaseOutcome.Applied, await h.Sync.PurchaseAsync(PurchaseHarness.Tenant, StorePlatform.Google, PurchaseHarness.Yearly, "tok-1", default));

        Assert.Equal(Tier.Premium, (await h.SnapshotAsync()).Active.Tier);
        Assert.Equal(["tok-1"], h.Play.Acknowledged);
    }

    [Fact]
    public async Task Consumable_IsGrantedOnce_AndConsumed()
    {
        using var h = new PurchaseHarness();
        h.Play.Products["tok-c"] = new { purchaseState = 0, consumptionState = 0, orderId = "GPA.2", purchaseTimeMillis = PurchaseHarness.Ms(h.Now).ToString(),
            obfuscatedExternalAccountId = StoreAccountToken.FromTenantId(PurchaseHarness.Tenant) };

        await h.Sync.PurchaseAsync(PurchaseHarness.Tenant, StorePlatform.Google, PurchaseHarness.Credits20, "tok-c", default);
        await h.Sync.PurchaseAsync(PurchaseHarness.Tenant, StorePlatform.Google, PurchaseHarness.Credits20, "tok-c", default);

        Assert.Equal(20, (await h.SnapshotAsync()).Credits.PackRemaining);
        Assert.Contains("tok-c", h.Play.Consumed);
    }

    [Fact]
    public async Task PendingPurchase_GrantsNothing()
    {
        using var h = new PurchaseHarness();
        h.Play.Products["tok-p"] = new { purchaseState = 2, consumptionState = 0 };

        Assert.Equal(StorePurchaseOutcome.Pending, await h.Sync.PurchaseAsync(PurchaseHarness.Tenant, StorePlatform.Google, PurchaseHarness.Credits20, "tok-p", default));
        Assert.Equal(0, (await h.SnapshotAsync()).Credits.PackRemaining);
        Assert.Empty(h.Play.Consumed);
    }

    [Fact]
    public async Task NotConfigured_Or_UnknownToken()
    {
        using var h = new PurchaseHarness();
        Assert.Equal(StorePurchaseOutcome.Invalid, await h.Sync.PurchaseAsync(PurchaseHarness.Tenant, StorePlatform.Google, PurchaseHarness.Yearly, "nope", default));
        h.Play.IsConfigured = false;
        Assert.Equal(StorePurchaseOutcome.NotAvailable, await h.Sync.PurchaseAsync(PurchaseHarness.Tenant, StorePlatform.Google, PurchaseHarness.Yearly, "nope", default));
    }

    [Fact]
    public async Task Rtdn_Renewal_IsReReadFromThePlayApi_AndOnHoldEndsAccess()
    {
        using var h = new PurchaseHarness();
        h.Play.Subscriptions["tok-1"] = Subscription("SUBSCRIPTION_STATE_ACTIVE", h.Now.AddDays(3));
        await h.Sync.PurchaseAsync(PurchaseHarness.Tenant, StorePlatform.Google, PurchaseHarness.Yearly, "tok-1", default);

        h.Play.Subscriptions["tok-1"] = Subscription("SUBSCRIPTION_STATE_ACTIVE", h.Now.AddYears(1), ack: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED");
        Assert.Equal(StoreNotificationOutcome.Processed, await h.Sync.HandleGoogleAsync("m-1",
            PurchaseHarness.Rtdn(new { subscriptionNotification = new { version = "1.0", notificationType = 2, purchaseToken = "tok-1", subscriptionId = PurchaseHarness.Yearly } }), default));
        Assert.Equal(h.Now.AddYears(1), (await h.SnapshotAsync()).Active.Source!.ExpiresAt!.Value, TimeSpan.FromSeconds(1));

        h.Clock.Advance(TimeSpan.FromSeconds(5));
        h.Play.Subscriptions["tok-1"] = Subscription("SUBSCRIPTION_STATE_ON_HOLD", h.Now.AddDays(-1), ack: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED");
        await h.Sync.HandleGoogleAsync("m-2",
            PurchaseHarness.Rtdn(new { subscriptionNotification = new { version = "1.0", notificationType = 5, purchaseToken = "tok-1", subscriptionId = PurchaseHarness.Yearly } }), default);
        Assert.Equal(Tier.Free, (await h.SnapshotAsync()).Active.Tier);

        // Redelivery of the same Pub/Sub message.
        Assert.Equal(StoreNotificationOutcome.Duplicate, await h.Sync.HandleGoogleAsync("m-2",
            PurchaseHarness.Rtdn(new { subscriptionNotification = new { version = "1.0", notificationType = 5, purchaseToken = "tok-1", subscriptionId = PurchaseHarness.Yearly } }), default));
    }

    [Fact]
    public async Task Upgrade_ReplacesTheLinkedPurchase_AndKeepsTheCreditMonth()
    {
        using var h = new PurchaseHarness();
        h.Play.Subscriptions["old"] = Subscription("SUBSCRIPTION_STATE_ACTIVE", h.Now.AddDays(20), PurchaseHarness.Monthly);
        await h.Sync.PurchaseAsync(PurchaseHarness.Tenant, StorePlatform.Google, PurchaseHarness.Monthly, "old", default);
        var anchor = (await h.SnapshotAsync()).Active.Source!.PeriodAnchor;

        h.Clock.Advance(TimeSpan.FromDays(2));
        h.Play.Subscriptions["new"] = Subscription("SUBSCRIPTION_STATE_ACTIVE", h.Now.AddYears(1), PurchaseHarness.Yearly, linked: "old");
        await h.Sync.PurchaseAsync(PurchaseHarness.Tenant, StorePlatform.Google, PurchaseHarness.Yearly, "new", default);

        var rows = await h.Repository.GetAllAsync<EntitlementEntity>(EntitlementEntity.GetPk(PurchaseHarness.Tenant));
        var active = (await h.SnapshotAsync()).Active.Source!;
        Assert.Equal(2, rows.Count);
        Assert.Equal(PurchaseHarness.Yearly, active.ProductId);
        Assert.Equal(anchor, active.PeriodAnchor);
        Assert.Equal(StoreSubscriptionState.Expired, rows.Single(r => r.ProductId == PurchaseHarness.Monthly).State);
    }

    [Fact]
    public async Task VoidedPurchases_EndAccess_AndTakeBackPackCredits()
    {
        using var h = new PurchaseHarness();
        h.Play.Subscriptions["tok-s"] = Subscription("SUBSCRIPTION_STATE_ACTIVE", h.Now.AddYears(1));
        h.Play.Products["tok-c"] = new { purchaseState = 0, consumptionState = 0, orderId = "GPA.3" };
        await h.Sync.PurchaseAsync(PurchaseHarness.Tenant, StorePlatform.Google, PurchaseHarness.Yearly, "tok-s", default);
        await h.Sync.PurchaseAsync(PurchaseHarness.Tenant, StorePlatform.Google, PurchaseHarness.Credits20, "tok-c", default);

        await h.Sync.HandleGoogleAsync("v-1", PurchaseHarness.Rtdn(new { voidedPurchaseNotification = new { purchaseToken = "tok-s", orderId = "GPA.1", productType = 1, refundType = 1 } }), default);
        await h.Sync.HandleGoogleAsync("v-2", PurchaseHarness.Rtdn(new { voidedPurchaseNotification = new { purchaseToken = "tok-c", orderId = "GPA.3", productType = 2, refundType = 1 } }), default);

        var snapshot = await h.SnapshotAsync();
        Assert.Equal(Tier.Free, snapshot.Active.Tier);
        Assert.Equal(0, snapshot.Credits.PackRemaining);
    }

    [Fact]
    public async Task Rtdn_ForAnotherPackage_IsInvalid_TestNotification_IsIgnored()
    {
        using var h = new PurchaseHarness();
        var foreign = Convert.ToBase64String(JsonSerializer.SerializeToUtf8Bytes(new { packageName = "com.other", subscriptionNotification = new { notificationType = 2, purchaseToken = "x" } }));

        Assert.Equal(StoreNotificationOutcome.Invalid, await h.Sync.HandleGoogleAsync("f-1", foreign, default));
        Assert.Equal(StoreNotificationOutcome.Invalid, await h.Sync.HandleGoogleAsync("f-2", "%%%", default));
        Assert.Equal(StoreNotificationOutcome.Ignored, await h.Sync.HandleGoogleAsync("t-1", PurchaseHarness.Rtdn(new { testNotification = new { version = "1.0" } }), default));
    }

    [Fact]
    public async Task Restore_ReReadsOwnedSubscriptions_AndAppliesDeviceItems()
    {
        using var h = new PurchaseHarness();
        h.Play.Subscriptions["tok-1"] = Subscription("SUBSCRIPTION_STATE_ACTIVE", h.Now.AddDays(1));
        await h.Sync.PurchaseAsync(PurchaseHarness.Tenant, StorePlatform.Google, PurchaseHarness.Yearly, "tok-1", default);
        h.Play.Subscriptions["tok-1"] = Subscription("SUBSCRIPTION_STATE_ACTIVE", h.Now.AddYears(1));
        h.Clock.Advance(TimeSpan.FromMinutes(1));

        var summary = await h.Sync.RestoreAsync(PurchaseHarness.Tenant, StorePlatform.Google, [], default);

        Assert.True(summary.StoreAvailable);
        Assert.Equal(1, summary.Restored);
        Assert.Equal(h.Now.AddYears(1), (await h.SnapshotAsync()).Active.Source!.ExpiresAt!.Value, TimeSpan.FromMinutes(2));
    }
}
