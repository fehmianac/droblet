using Domain.Entity;
using Domain.Enum;
using Domain.Options;
using Domain.Services;
using Infrastructure.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Tests.Shared;

namespace InfrastructureTests;

public class AccountDeletionServiceTests
{
    [Fact]
    public async Task DeleteAccount_RemovesEveryTenantPartitionGlobalsAndS3()
    {
        var repository = new InMemoryRepository();
        var storage = new FakeObjectStorage();
        const string user = "u1", tenant = "t1";
        await repository.SaveAsync(new UserEntity { Id = user, TenantId = tenant, Identities = [AuthIdentityEntity.GetSk(AuthProvider.Email, "a@b.co")] });
        await repository.SaveAsync(new AuthIdentityEntity { Provider = AuthProvider.Email, Subject = "a@b.co", UserId = user });
        await repository.SaveAsync(new CredentialEntity { UserId = user, PasswordHash = "x" });
        await repository.SaveAsync(new TenantEntity { Id = tenant, OwnerUserId = user, Handle = "ayse" });
        await repository.SaveAsync(new HandleEntity { Handle = "ayse", TenantId = tenant });
        await repository.SaveAsync(new UserTenantIndexEntity { UserId = user, TenantId = tenant });
        await repository.SaveAsync(new StyleProfileEntity { TenantId = tenant });
        await repository.SaveAsync(new BodyProfileEntity { TenantId = tenant });
        await repository.SaveAsync(new CreditAccountEntity { TenantId = tenant });
        await repository.SaveAsync(new HandleEntity { Handle = "someone", TenantId = "t2" });
        await storage.PutAsync("tenant/t1/body/p.jpg", [1], "image/jpeg", default);
        await storage.PutAsync("uploads/tmp/t1/u", [1], "image/jpeg", default);
        await storage.PutAsync("tenant/t2/body/p.jpg", [1], "image/jpeg", default);

        await new AccountDeletionService(repository, storage, NullLogger<AccountDeletionService>.Instance).DeleteAccountAsync(user, tenant, default);

        Assert.Equal([(HandleEntity.GetPk(), "someone")], repository.Keys.ToArray());
        Assert.Equal(["tenant/t2/body/p.jpg"], storage.Objects.Keys.ToArray());
    }
}

public class JobLifecycleTests
{
    [Fact]
    public async Task Fail_RefundsReservedCredit_Complete_Commits()
    {
        var repository = new InMemoryRepository();
        var clock = Fixtures.Clock();
        await repository.SaveAsync(Fixtures.Premium("t1", Fixtures.Now.AddDays(-1)));
        var credits = new CreditService(repository, Fixtures.Entitlements(), clock, NullLogger<CreditService>.Instance);
        var entitlement = new EntitlementService(repository, Fixtures.Entitlements(), clock);
        var lifecycle = new JobLifecycle(repository, credits, clock, NullLogger<JobLifecycle>.Instance);

        foreach (var (jobId, key) in new[] { ("j1", "k1"), ("j2", "k2") })
        {
            await credits.ReserveAsync("t1", key, jobId, default);
            await repository.SaveAsync(new JobEntity { Id = jobId, TenantId = "t1", Kind = JobKind.TryOn, Status = JobStatus.Queued, CreditIdempotencyKey = key });
        }

        var failed = await lifecycle.StartAsync("t1", "j1", default);
        await lifecycle.FailAsync(failed!, JobFailure.ProviderError, default);
        var done = await lifecycle.StartAsync("t1", "j2", default);
        await lifecycle.CompleteAsync(done!, "{}", default);

        Assert.Equal(29, (await entitlement.GetAsync("t1", default)).Credits.AllowanceRemaining);
        Assert.Null(await lifecycle.StartAsync("t1", "j1", default)); // finished jobs are not re-run
    }
}

public class PurchaseServiceTests
{
    private static readonly StoreOptions Store = new()
    {
        ProductIds = { Premium = ["com.alatech.droplet.premium.monthly", "com.alatech.droplet.premium.yearly"] },
        CreditPacks = { ["com.alatech.droplet.credits.20"] = 20 },
    };

    private static (PurchaseService Service, InMemoryRepository Repository, EntitlementService Entitlement) Create()
    {
        var repository = new InMemoryRepository();
        var clock = Fixtures.Clock();
        var credits = new CreditService(repository, Fixtures.Entitlements(), clock, NullLogger<CreditService>.Instance);
        return (new PurchaseService(repository, credits, Fixtures.Monitor(Store), clock), repository, new EntitlementService(repository, Fixtures.Entitlements(), clock));
    }

    [Fact]
    public async Task Apply_Subscription_GrantsPremiumWith30Credits()
    {
        var (service, _, entitlement) = Create();
        var verified = new PurchaseVerificationResult(PurchaseVerificationStatus.Verified, "com.alatech.droplet.premium.yearly", "tx1", Fixtures.Now.AddDays(-2), Fixtures.Now.AddYears(1));

        Assert.Equal(PurchaseApplyOutcome.SubscriptionActivated, await service.ApplyAsync("t1", StorePlatform.Apple, verified, default));

        var snapshot = await entitlement.GetAsync("t1", default);
        Assert.Equal(Tier.Premium, snapshot.Active.Tier);
        Assert.Equal(30, snapshot.Credits.AllowanceRemaining);
        Assert.Equal(Fixtures.Now.AddDays(-2).AddMonths(1), snapshot.Credits.ResetsAt);
    }

    [Fact]
    public async Task Apply_CreditPack_Adds20()
    {
        var (service, _, entitlement) = Create();
        var verified = new PurchaseVerificationResult(PurchaseVerificationStatus.Verified, "com.alatech.droplet.credits.20", "tx2");

        Assert.Equal(PurchaseApplyOutcome.CreditsAdded, await service.ApplyAsync("t1", StorePlatform.Google, verified, default));
        Assert.Equal(20, (await entitlement.GetAsync("t1", default)).Credits.PackRemaining);
    }

    [Fact]
    public async Task Apply_UnknownProduct_GrantsNothing()
    {
        var (service, repository, _) = Create();
        var verified = new PurchaseVerificationResult(PurchaseVerificationStatus.Verified, "com.other.app", "tx3");

        Assert.Equal(PurchaseApplyOutcome.UnknownProduct, await service.ApplyAsync("t1", StorePlatform.Apple, verified, default));
        Assert.Equal(0, repository.Count);
    }

    [Fact]
    public async Task Apply_Unverified_Throws()
    {
        var (service, _, _) = Create();
        await Assert.ThrowsAsync<ArgumentException>(() =>
            service.ApplyAsync("t1", StorePlatform.Apple, new PurchaseVerificationResult(PurchaseVerificationStatus.Invalid), default));
    }
}

public class RateLimiterTests
{
    [Fact]
    public async Task TryAcquire_AllowsUpToLimitPerWindow()
    {
        var clock = Fixtures.Clock();
        var limiter = new RateLimiter(new InMemoryRepository(), clock);

        for (var i = 0; i < 3; i++)
            Assert.True(await limiter.TryAcquireAsync("login-email", "A@B.co", 3, TimeSpan.FromMinutes(15), default));
        Assert.False(await limiter.TryAcquireAsync("login-email", "a@b.co ", 3, TimeSpan.FromMinutes(15), default));

        clock.Advance(TimeSpan.FromMinutes(16));
        Assert.True(await limiter.TryAcquireAsync("login-email", "a@b.co", 3, TimeSpan.FromMinutes(15), default));
    }
}
