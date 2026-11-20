using Domain.Constant;
using Microsoft.Extensions.Time.Testing;
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
        var analytics = new AnalyticsService(repository, Fixtures.Clock(), NullLogger<AnalyticsService>.Instance);
        await analytics.RecordBatchAsync(tenant, [new AnalyticsEventInput("paywall_viewed", null, null), new AnalyticsEventInput("signup_completed", Fixtures.Now.AddDays(-2), null)], "ios", "1.0", default);
        await analytics.RecordServerEventAsync(AnalyticsRules.Share, tenant, null, default);
        await analytics.RecordServerEventAsync(AnalyticsRules.Share, "t2", null, default);
        var othersEvents = repository.Keys.Where(k => k.Pk == AnalyticsActorEventEntity.GetPk("t2")
            || (k.Pk.StartsWith("analytics#", StringComparison.Ordinal) && repository.Raw(k.Pk, k.Sk).Contains(AnalyticsRules.Actor("t2")))).ToList();
        Assert.Equal(2, othersEvents.Count);
        Assert.Equal(8, repository.Keys.Count(k => k.Pk.StartsWith("analytics", StringComparison.Ordinal)));
        await storage.PutAsync("tenant/t1/body/p.jpg", [1], "image/jpeg", default);
        await storage.PutAsync("uploads/tmp/t1/u", [1], "image/jpeg", default);
        await storage.PutAsync("tenant/t2/body/p.jpg", [1], "image/jpeg", default);
        var mine = StorageKeys.PublicItemImage(tenant, "i1", "0123456789abcdef0123456789abcdef", "full");
        var theirs = StorageKeys.PublicItemImage("t2", "i2", "0123456789abcdef0123456789abcdef", "full");
        await storage.PutAsync(mine, [1], "image/webp", default);
        await storage.PutAsync(theirs, [1], "image/webp", default);
        var cdn = new FakeCdnCache();

        await new AccountDeletionService(repository, storage,
            new Infrastructure.Services.Social.CrossTenantCleanup(repository, TimeProvider.System, NullLogger<Infrastructure.Services.Social.CrossTenantCleanup>.Instance),
            cdn, NullLogger<AccountDeletionService>.Instance).DeleteAccountAsync(user, tenant, default);

        Assert.Equal([(HandleEntity.GetPk(), "someone"), .. othersEvents], repository.Keys.OrderBy(k => k.Pk == HandleEntity.GetPk() ? 0 : 1).ThenBy(k => k.Pk, StringComparer.Ordinal).ToArray());
        Assert.Equal(new[] { theirs, "tenant/t2/body/p.jpg" }.Order(StringComparer.Ordinal), storage.Objects.Keys.Order(StringComparer.Ordinal));
        Assert.Contains(StorageKeys.PublicItemsRoot(tenant), storage.DeletedPrefixes);
        Assert.Equal([mine], cdn.Purged);
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
        var lifecycle = new JobLifecycle(repository, credits, new ItemRecognitionQuotaService(repository, Fixtures.Entitlements(), clock), new AiUsageRecorder(repository, NullLogger<AiUsageRecorder>.Instance), clock, NullLogger<JobLifecycle>.Instance);

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

public class ItemRecognitionQuotaServiceTests
{
    private const string Tenant = "tenant-q";
    private static readonly DateTime Now = new(2026, 11, 18, 9, 0, 0, DateTimeKind.Utc);

    private static (ItemRecognitionQuotaService Quota, JobLifecycle Jobs, EntitlementService Entitlements, InMemoryRepository Repository, FakeTimeProvider Clock) Create(int limit = 3)
    {
        var repository = new InMemoryRepository();
        var clock = new FakeTimeProvider(new DateTimeOffset(Now));
        var options = Fixtures.Monitor(new EntitlementOptions { Premium = { TryOnCreditsPerMonth = 30 }, Free = { ItemRecognitionLimit = limit } });
        var quota = new ItemRecognitionQuotaService(repository, options, clock);
        var credits = new CreditService(repository, options, clock, NullLogger<CreditService>.Instance);
        return (quota, new JobLifecycle(repository, credits, quota, new AiUsageRecorder(repository, NullLogger<AiUsageRecorder>.Instance), clock, NullLogger<JobLifecycle>.Instance), new EntitlementService(repository, options, clock), repository, clock);
    }

    private static async Task<JobEntity> JobAsync(InMemoryRepository repository, string id, JobKind kind = JobKind.ItemProcess)
    {
        var job = new JobEntity { Id = id, TenantId = Tenant, Kind = kind, Status = JobStatus.Queued, CreatedAt = Now, UpdatedAt = Now };
        await repository.SaveAsync(job);
        return job;
    }

    private static Task PremiumAsync(InMemoryRepository repository) => repository.SaveAsync(new EntitlementEntity
    {
        Id = "tx", TenantId = Tenant, Tier = Tier.Premium, Source = EntitlementSource.Store, StartsAt = Now.AddDays(-1), ExpiresAt = Now.AddMonths(1), PeriodAnchor = Now.AddDays(-1),
    });

    [Fact]
    public async Task CompletedJobs_ConsumeTheAllowance_FailedJobsDoNot()
    {
        var (quota, jobs, entitlements, repository, _) = Create(limit: 3);

        Assert.Equal(new ItemRecognitionGrant(2, 0, null), await quota.ReserveAsync(Tenant, ["a", "b"], default));
        Assert.Equal(new ItemRecognitionQuota(3, 2, 1), await quota.GetAsync(Tenant, default));           // in-flight counts as used
        await jobs.CompleteAsync(await JobAsync(repository, "a"), "{}", default);
        await jobs.FailAsync(await JobAsync(repository, "b", JobKind.ItemSplit), JobFailure.ProviderError, default);
        Assert.Equal(new ItemRecognitionQuota(3, 1, 2), await quota.GetAsync(Tenant, default));           // the failed one came back

        // Settling twice (SQS redelivery) changes nothing.
        await quota.CommitAsync(Tenant, "a", default);
        await quota.ReleaseAsync(Tenant, "b", default);
        await quota.ReleaseAsync(Tenant, "a", default);
        Assert.Equal(new ItemRecognitionQuota(3, 1, 2), (await entitlements.GetAsync(Tenant, default)).ItemRecognition);
    }

    [Fact]
    public async Task Bulk_AboveWhatIsLeft_GrantsTheFirstOnes_ThenTheLimitIsReached()
    {
        var (quota, jobs, _, repository, _) = Create(limit: 3);

        var bulk = await quota.ReserveAsync(Tenant, ["a", "b", "c", "d", "e"], default);
        var after = await quota.ReserveAsync(Tenant, ["f"], default);
        var usage = await repository.GetAsync<ItemRecognitionUsageEntity>(ItemRecognitionUsageEntity.GetPk(Tenant), ItemRecognitionUsageEntity.GetSk());
        foreach (var id in new[] { "a", "b", "c" })
            await jobs.CompleteAsync(await JobAsync(repository, id), "{}", default);
        var exhausted = await quota.ReserveAsync(Tenant, ["g"], default);

        Assert.Equal(new ItemRecognitionGrant(3, 2, null), bulk);
        Assert.Equal(["a", "b", "c"], usage!.Pending.Select(p => p.JobId).ToArray());
        Assert.Equal(new ItemRecognitionGrant(0, 1, ErrorCodes.ItemRecognitionLimitReached), after);
        Assert.Equal(new ItemRecognitionGrant(0, 1, ErrorCodes.ItemRecognitionLimitReached), exhausted);
        Assert.Equal(new ItemRecognitionQuota(3, 3, 0), await quota.GetAsync(Tenant, default));
    }

    [Fact]
    public async Task ZeroLimit_IsMembersOnly_AndMembersAreNeverCounted()
    {
        var (quota, jobs, _, repository, _) = Create(limit: 0);

        Assert.Equal(new ItemRecognitionGrant(0, 1, ErrorCodes.PremiumRequired), await quota.ReserveAsync(Tenant, ["a"], default));
        await PremiumAsync(repository);
        Assert.Equal(new ItemRecognitionGrant(30, 0, null), await quota.ReserveAsync(Tenant, Enumerable.Range(0, 30).Select(i => $"job-{i}").ToList(), default));
        await jobs.CompleteAsync(await JobAsync(repository, "job-0"), "{}", default);

        Assert.True((await quota.GetAsync(Tenant, default)).Unlimited);
        Assert.Null(await repository.GetAsync<ItemRecognitionUsageEntity>(ItemRecognitionUsageEntity.GetPk(Tenant), ItemRecognitionUsageEntity.GetSk()));
    }

    [Fact]
    public async Task AReservationWhoseJobDied_StopsCountingAfterADay_AndTheSameJobIdIsNeverCountedTwice()
    {
        var (quota, _, _, _, clock) = Create(limit: 1);

        await quota.ReserveAsync(Tenant, ["lost"], default);
        var retry = await quota.ReserveAsync(Tenant, ["lost"], default);            // the same request again
        var blocked = await quota.ReserveAsync(Tenant, ["other"], default);
        clock.Advance(ItemRecognitionQuotaService.PendingLifetime);
        var freed = await quota.ReserveAsync(Tenant, ["other"], default);

        Assert.Equal(new ItemRecognitionGrant(1, 0, null), retry);
        Assert.Equal(ErrorCodes.ItemRecognitionLimitReached, blocked.DenyReason);
        Assert.Equal(new ItemRecognitionGrant(1, 0, null), freed);
        Assert.Equal(new ItemRecognitionQuota(1, 1, 0), await quota.GetAsync(Tenant, default));
    }

    [Fact]
    public async Task OtherJobKinds_NeverTouchTheAllowance()
    {
        var (quota, jobs, _, repository, _) = Create(limit: 2);
        await quota.ReserveAsync(Tenant, ["x"], default);

        await jobs.CompleteAsync(await JobAsync(repository, "x", JobKind.Palette), "{}", default);

        Assert.Equal(new ItemRecognitionQuota(2, 1, 1), await quota.GetAsync(Tenant, default)); // still only reserved
    }
}
