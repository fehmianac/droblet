using Domain.Entity;
using Domain.Enum;
using Domain.Options;
using Domain.Services;
using Domain.Services.Admin;
using Infrastructure.Services;
using Infrastructure.Services.Admin;
using Microsoft.Extensions.Logging.Abstractions;
using Tests.Shared;

namespace InfrastructureTests;

/// <summary>Durable AI usage counters: the recorder, deletion, the backfill and the admin views over them.</summary>
public class AiUsageTests
{
    private const string Tenant = "01JTENANTUSAGE000000000000";
    private const string User = "01JUSERUSAGE00000000000000";
    private static readonly DateOnly Today = DateOnly.FromDateTime(Fixtures.Now);

    private static AiUsageRecorder Recorder(InMemoryRepository repository) => new(repository, NullLogger<AiUsageRecorder>.Instance);

    private static AiUsageRecord Record(string tenant, string marker, DateTime at, long costMicro = 30_000, JobKind kind = JobKind.StylistOutfit,
        AiUsageOutcome outcome = AiUsageOutcome.Completed, string op = "outfit", string model = "gpt-6-astra") =>
        new(tenant, marker, kind, outcome, [new AiUsageCall(op, model, 200, 1000, 300, 50, 10, costMicro)], at);

    private static async Task<IReadOnlyDictionary<string, long>> RowAsync(InMemoryRepository repository, string pk, string sk) =>
        (await repository.GetAsync<AiUsageEntity>(pk, sk))?.Counters ?? new Dictionary<string, long>();

    [Fact]
    public async Task Recorder_WritesTenantGlobalPlanAndIndexRows_InOneGo_WithRetention()
    {
        var repository = new InMemoryRepository();
        await repository.SaveAsync(Fixtures.Premium(Tenant, Fixtures.Now.AddDays(-3)));

        Assert.True(await Recorder(repository).RecordAsync(Record(Tenant, "job1", Fixtures.Now), default));

        foreach (var (pk, sk) in new[]
                 {
                     (AiUsageEntity.GetPk(Tenant), AiUsageEntity.DaySk(Today)), (AiUsageEntity.GetPk(Tenant), AiUsageEntity.MonthSk(Today)),
                     (AiUsageEntity.AllPk, AiUsageEntity.DaySk(Today)), (AiUsageEntity.AllPk, AiUsageEntity.MonthSk(Today)),
                     (AiUsageEntity.PlanPk(AiUsagePlans.Premium), AiUsageEntity.DaySk(Today)), (AiUsageEntity.PlanPk(AiUsagePlans.Premium), AiUsageEntity.MonthSk(Today)),
                 })
        {
            var row = await RowAsync(repository, pk, sk);
            Assert.Equal(30_000, row[AiUsageCounters.Cost]);
            Assert.Equal(1, row[AiUsageCounters.Op(AiUsageOperations.StylistOutfit, AiUsageCounters.Calls)]);
            Assert.Equal(1000, row[AiUsageCounters.Model("gpt-6-astra", AiUsageCounters.Input)]);
        }
        Assert.Null(await repository.GetAsync<AiUsageEntity>(AiUsageEntity.PlanPk(AiUsagePlans.Free), AiUsageEntity.DaySk(Today)));

        var day = (await repository.GetAsync<AiUsageEntity>(AiUsageEntity.GetPk(Tenant), AiUsageEntity.DaySk(Today)))!;
        var month = (await repository.GetAsync<AiUsageEntity>(AiUsageEntity.GetPk(Tenant), AiUsageEntity.MonthSk(Today)))!;
        Assert.Equal(Fixtures.Now.Date.AddDays(400), DateTimeOffset.FromUnixTimeSeconds(day.Ttl).UtcDateTime);
        Assert.True(DateTimeOffset.FromUnixTimeSeconds(month.Ttl).UtcDateTime >= new DateTime(2029, 11, 1, 0, 0, 0, DateTimeKind.Utc));
        Assert.Equal(("2026-11-18", "2026-11"), (day.Period, month.Period));

        var index = Assert.Single(await repository.GetAllAsync<AiUsageDayIndexEntity>(AiUsageDayIndexEntity.GetPk(Today)));
        Assert.Equal((Tenant, AiUsagePlans.Premium, 30_000L, 1L), (index.TenantId, index.Plan, index.Cost, index.Calls));
    }

    [Fact]
    public async Task Recorder_SameMarkerTwice_CountsOnce_NumbersOnly()
    {
        var repository = new InMemoryRepository();
        var recorder = Recorder(repository);

        Assert.True(await recorder.RecordAsync(Record(Tenant, "job1", Fixtures.Now), default));
        Assert.False(await recorder.RecordAsync(Record(Tenant, "job1", Fixtures.Now), default));   // SQS retry / backfill replay
        Assert.True(await recorder.RecordAsync(Record(Tenant, "job2", Fixtures.Now, 10_000), default));

        var day = await RowAsync(repository, AiUsageEntity.GetPk(Tenant), AiUsageEntity.DaySk(Today));
        Assert.Equal((2L, 40_000L), (day[AiUsageCounters.Jobs], day[AiUsageCounters.Cost]));
        // Only numbers and short keys: no prompt, answer or image field on any row.
        var raw = repository.Raw(AiUsageEntity.GetPk(Tenant), AiUsageEntity.DaySk(Today));
        Assert.DoesNotContain("prompt", raw, StringComparison.OrdinalIgnoreCase);
        Assert.All(day.Keys, k => Assert.Matches(@"^[a-zA-Z]+$|^(op|model)\|[A-Za-z0-9._:_\-]+\|[a-zA-Z]+$", k));
    }

    [Fact]
    public async Task Recorder_AdminTrial_IsItsOwnTenant_NeverAUserPlanOrIndex()
    {
        var repository = new InMemoryRepository();

        await Recorder(repository).RecordAsync(Record(AiUsageEntity.AdminTenant, "trial#t1", Fixtures.Now, kind: JobKind.AiTrial), default);

        var admin = await RowAsync(repository, AiUsageEntity.GetPk(AiUsageEntity.AdminTenant), AiUsageEntity.DaySk(Today));
        Assert.Equal(30_000, admin[AiUsageCounters.Op(AiUsageOperations.AdminTrial, AiUsageCounters.Cost)]);
        Assert.Equal(30_000, (await RowAsync(repository, AiUsageEntity.AllPk, AiUsageEntity.DaySk(Today)))[AiUsageCounters.Cost]);
        Assert.Empty(await repository.GetAllAsync<AiUsageDayIndexEntity>(AiUsageDayIndexEntity.GetPk(Today)));
        Assert.DoesNotContain(repository.Keys, k => k.Pk.StartsWith("ai#usage#plan#", StringComparison.Ordinal));
        Assert.DoesNotContain(repository.Keys, k => k.Pk.StartsWith("tenant#", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Recorder_StoreFailure_IsSwallowed_TheJobNeverFails()
    {
        var recorder = new AiUsageRecorder(new ThrowingRepository(new InMemoryRepository()), NullLogger<AiUsageRecorder>.Instance);
        Assert.False(await recorder.RecordAsync(Record(Tenant, "job1", Fixtures.Now), default));
    }

    private sealed class ThrowingRepository(InMemoryRepository inner) : DelegatingRepository(inner)
    {
        public override Task<bool> AddCountersOnceAsync(Domain.Entity.Base.IEntity marker, IReadOnlyList<Domain.Manager.CounterUpdate> updates, CancellationToken ct = default) =>
            throw new InvalidOperationException("DynamoDB down");
    }

    [Fact]
    public async Task JobLifecycle_CompleteThenFail_CountsTheOutcome_FailedWithCreditIsRefunded()
    {
        var repository = new InMemoryRepository();
        var clock = Fixtures.Clock();
        var credits = new CreditService(repository, Fixtures.Entitlements(), clock, NullLogger<CreditService>.Instance);
        var lifecycle = new JobLifecycle(repository, credits, new ItemRecognitionQuotaService(repository, Fixtures.Entitlements(), clock), Recorder(repository), clock, NullLogger<JobLifecycle>.Instance);
        var done = new JobEntity { Id = "j1", TenantId = Tenant, Kind = JobKind.Palette, CreatedAt = Fixtures.Now, UpdatedAt = Fixtures.Now };
        var failed = new JobEntity { Id = "j2", TenantId = Tenant, Kind = JobKind.TryOn, CreditIdempotencyKey = "k", CreatedAt = Fixtures.Now, UpdatedAt = Fixtures.Now };
        await repository.SaveAsync(done);
        await repository.SaveAsync(failed);

        using (AiUsageProbe.Run("palette_season", costUsd: 0.008m))
            await lifecycle.CompleteAsync(done, "{}", default);
        using (AiUsageProbe.Run("image_tryon", "gpt-image-2.5-sunburst", 0m))
            await lifecycle.FailAsync(failed, JobFailure.ProviderError, default);

        var day = await RowAsync(repository, AiUsageEntity.GetPk(Tenant), AiUsageEntity.DaySk(Today));
        Assert.Equal((2L, 1L, 1L, 1L), (day[AiUsageCounters.Jobs], day[AiUsageCounters.Completed], day[AiUsageCounters.Failed], day[AiUsageCounters.Refunded]));
        Assert.Equal(8_000, day[AiUsageCounters.Op(AiUsageOperations.Palette, AiUsageCounters.Cost)]);
        Assert.Equal(1, day[AiUsageCounters.Op(AiUsageOperations.TryOn, AiUsageCounters.Refunded)]);
    }

    [Fact]
    public async Task AccountDeletion_RemovesCounters_Markers_AndTheDayIndex_KeepsAnonymousAggregates()
    {
        var repository = new InMemoryRepository();
        var recorder = Recorder(repository);
        await recorder.RecordAsync(Record(Tenant, "job1", Fixtures.Now), default);
        await recorder.RecordAsync(Record(Tenant, "job2", Fixtures.Now.AddDays(-40)), default);
        await recorder.RecordAsync(Record("01JOTHERTENANT000000000000", "job3", Fixtures.Now), default);

        await new AccountDeletionService(repository, new FakeObjectStorage(),
            new Infrastructure.Services.Social.CrossTenantCleanup(repository, TimeProvider.System, NullLogger<Infrastructure.Services.Social.CrossTenantCleanup>.Instance),
            new FakeCdnCache(), NullLogger<AccountDeletionService>.Instance).DeleteAccountAsync(User, Tenant, default);

        Assert.DoesNotContain(repository.Keys, k => k.Pk.Contains(Tenant, StringComparison.Ordinal) || k.Sk.Contains(Tenant, StringComparison.Ordinal));
        Assert.Single(await repository.GetAllAsync<AiUsageDayIndexEntity>(AiUsageDayIndexEntity.GetPk(Today)));   // the other user's
        Assert.Equal(60_000, (await RowAsync(repository, AiUsageEntity.AllPk, AiUsageEntity.DaySk(Today)))[AiUsageCounters.Cost]);
    }

    [Fact]
    public async Task Backfill_ReplaysFinishedJobsAndPhotos_FromTheirAiCost_Idempotent_SkipsWhatTheLivePathCounted()
    {
        var repository = new InMemoryRepository();
        var recorder = Recorder(repository);
        await repository.SaveAsync(new TenantEntity { Id = Tenant, OwnerUserId = User, CreatedAt = Fixtures.Now, UpdatedAt = Fixtures.Now });
        await repository.SaveAsync(new JobEntity
        {
            Id = "old", TenantId = Tenant, Kind = JobKind.ItemProcess, Status = JobStatus.Completed, CreatedAt = Fixtures.Now.AddDays(-2), UpdatedAt = Fixtures.Now.AddDays(-2),
            AiCost = new() { ["item_detection"] = 2900, ["calls.item_detection"] = 1, ["image_cleanup"] = 25000, ["calls.image_cleanup"] = 2, ["total"] = 27900 },
            AiModels = ["gpt-6.1-terra", "gpt-image-2.5-sunburst"],
        });
        await repository.SaveAsync(new JobEntity
        {
            Id = "live", TenantId = Tenant, Kind = JobKind.Palette, Status = JobStatus.Completed, CreatedAt = Fixtures.Now, UpdatedAt = Fixtures.Now,
            AiCost = new() { ["palette_season"] = 800, ["calls.palette_season"] = 1, ["total"] = 800 },
        });
        await repository.SaveAsync(new JobEntity { Id = "queued", TenantId = Tenant, Kind = JobKind.TryOn, Status = JobStatus.Queued, CreatedAt = Fixtures.Now, UpdatedAt = Fixtures.Now });
        await repository.SaveAsync(new OutfitImportPhotoEntity
        {
            TenantId = Tenant, SessionId = "s1", Index = 1, Status = OutfitImportPhotoStatus.Ready, UploadKey = "k", LookId = "l", CreatedAt = Fixtures.Now, UpdatedAt = Fixtures.Now,
            AiCost = new() { ["item_detection"] = 3000, ["calls.item_detection"] = 1, ["total"] = 3000 },
        });
        await recorder.RecordAsync(Record(Tenant, "live", Fixtures.Now, 800, JobKind.Palette, op: "palette_season"), default);   // counted live
        var backfill = new AiUsageBackfill(repository, recorder, Fixtures.Clock());

        var dry = await backfill.RunAsync(7, dryRun: true, default);
        var first = await backfill.RunAsync(7, dryRun: false, default);
        var second = await backfill.RunAsync(7, dryRun: false, default);

        Assert.Equal((1, 2, 1, 0), (dry.Tenants, dry.Jobs, dry.Photos, dry.Written));
        Assert.Equal((2, 1), (first.Written, first.AlreadyCounted));
        Assert.Equal((0, 3), (second.Written, second.AlreadyCounted));
        var old = await RowAsync(repository, AiUsageEntity.GetPk(Tenant), AiUsageEntity.DaySk(Today.AddDays(-2)));
        Assert.Equal((2L, 25_000L), (old[AiUsageCounters.Op(AiUsageOperations.Cleanup, AiUsageCounters.Calls)], old[AiUsageCounters.Op(AiUsageOperations.Cleanup, AiUsageCounters.Cost)]));
        Assert.Equal(27_900, old[AiUsageCounters.Cost]);
        var today = await RowAsync(repository, AiUsageEntity.GetPk(Tenant), AiUsageEntity.DaySk(Today));
        Assert.Equal((800L, 3_000L), (today[AiUsageCounters.Op(AiUsageOperations.Palette, AiUsageCounters.Cost)], today[AiUsageCounters.Op(AiUsageOperations.ImportDetect, AiUsageCounters.Cost)]));
    }

    // ── Admin views ───────────────────────────────────────────────────────────────────────────────────────────────

    private sealed class CapturingAudit : IAuditLog
    {
        public List<(string Action, string? TargetId, object? After)> Entries { get; } = [];

        public Task WriteAsync(AdminUserEntity? actor, string action, string? targetType, string? targetId, object? before, object? after, string? ip, CancellationToken ct)
        {
            Entries.Add((action, targetId, after));
            return Task.CompletedTask;
        }

        public Task<AuditPageDto> QueryAsync(AuditQuery query, CancellationToken ct) => Task.FromResult(new AuditPageDto([], null));
    }

    private static readonly AdminUserEntity Admin = new() { Id = "a1", Email = "owner@example.com", Name = "Owner", Role = AdminRole.SuperAdmin };

    private static (AdminAiUsageService Service, CapturingAudit Audit) Service(InMemoryRepository repository, AiUsageOptions? options = null)
    {
        var audit = new CapturingAudit();
        var entitlements = new EntitlementService(repository, Fixtures.Entitlements(), Fixtures.Clock());
        return (new AdminAiUsageService(repository, entitlements, audit, Fixtures.Monitor(options ?? new AiUsageOptions())), audit);
    }

    private static async Task SeedUserAsync(InMemoryRepository repository, string tenant, string user, string email, string handle)
    {
        await repository.SaveAsync(new UserEntity { Id = user, TenantId = tenant, Email = email, CreatedAt = Fixtures.Now });
        await repository.SaveAsync(new TenantEntity { Id = tenant, OwnerUserId = user, Handle = handle, CreatedAt = Fixtures.Now, UpdatedAt = Fixtures.Now });
    }

    [Fact]
    public async Task UserUsage_TotalsPerOperationAndDay_RecentJobsWithCredits_AndTheViewIsAudited()
    {
        var repository = new InMemoryRepository();
        await SeedUserAsync(repository, Tenant, User, "ayse.kaya@gmail.com", "aysekaya");
        var recorder = Recorder(repository);
        await recorder.RecordAsync(Record(Tenant, "j1", Fixtures.Now, 30_000), default);
        await recorder.RecordAsync(Record(Tenant, "j2", Fixtures.Now.AddDays(-1), 31_000, JobKind.TryOn, op: "image_tryon", model: "gpt-image-2.5-sunburst"), default);
        await recorder.RecordAsync(Record(Tenant, "j3", Fixtures.Now.AddDays(-45), 99_000), default);   // outside the range
        await repository.SaveAsync(new JobEntity
        {
            Id = "j2", TenantId = Tenant, Kind = JobKind.TryOn, Status = JobStatus.Failed, Failure = JobFailure.ProviderError, CreditIdempotencyKey = "key2",
            AiModels = ["gpt-image-2.5-sunburst"], AiCost = new() { ["total"] = 31_000 }, CreatedAt = Fixtures.Now.AddDays(-1), UpdatedAt = Fixtures.Now.AddDays(-1).AddSeconds(14),
        });
        await repository.SaveAsync(new CreditLedgerEntryEntity { Id = "l1", TenantId = Tenant, Kind = CreditLedgerEntryKind.AllowanceReserved, AllowanceDelta = -1, IdempotencyKey = "key2", CreatedAt = Fixtures.Now.AddDays(-1) });
        await repository.SaveAsync(new CreditLedgerEntryEntity { Id = "l2", TenantId = Tenant, Kind = CreditLedgerEntryKind.Refunded, AllowanceDelta = 1, IdempotencyKey = "key2", CreatedAt = Fixtures.Now.AddDays(-1).AddSeconds(14) });
        var (service, audit) = Service(repository);

        var usage = (await service.GetUserUsageAsync(Admin, User, Today.AddDays(-29), Today, "1.2.3.4", default))!;

        Assert.Equal((61_000L, 2L, 2L), (usage.Totals.CostMicroUsd, usage.Totals.Calls, usage.Totals.Jobs));
        Assert.Equal([AiUsageOperations.TryOn, AiUsageOperations.StylistOutfit], usage.Operations.Select(o => o.Operation));
        Assert.Equal(["2026-11-17", "2026-11-18"], usage.Days.Select(d => d.Period));
        Assert.Equal(["2026-10", "2026-11"], usage.Months.Select(m => m.Period));   // the range touches two months
        Assert.Equal(AiUsagePlans.Free, usage.Plan);
        var job = Assert.Single(usage.RecentJobs);
        Assert.Equal(("refunded", 1, 1, 14_000L, 31_000L), (job.Outcome, job.CreditsCharged, job.CreditsRefunded, job.DurationMs!.Value, job.CostMicroUsd!.Value));
        Assert.Equal(["gpt-image-2.5-sunburst"], job.Models);
        var entry = Assert.Single(audit.Entries);
        Assert.Equal(("user.ai_usage_view", User), (entry.Action, entry.TargetId));

        Assert.Null(await service.GetUserUsageAsync(Admin, "missing", Today, Today, null, default));
        Assert.Single(audit.Entries);   // nothing viewed, nothing audited
    }

    [Fact]
    public async Task Summary_DailyCost_PlanMargin_TopUsersMasked_AdminApart_Anomalies()
    {
        var repository = new InMemoryRepository();
        const string heavy = "01JTENANTHEAVY000000000000";
        await SeedUserAsync(repository, Tenant, User, "ayse.kaya@gmail.com", "aysekaya");
        await SeedUserAsync(repository, heavy, "01JUSERHEAVY00000000000000", "mehmet@example.org", "me");
        await repository.SaveAsync(Fixtures.Premium(heavy, Fixtures.Now.AddDays(-60)));
        var recorder = Recorder(repository);
        // The heavy premium user: $0.10 a day for 10 days, then $1.20 today (12× the median) → anomaly.
        for (var i = 1; i <= 10; i++)
            await recorder.RecordAsync(Record(heavy, $"h{i}", Fixtures.Now.AddDays(-i), 100_000), default);
        await recorder.RecordAsync(Record(heavy, "h0", Fixtures.Now, 1_200_000), default);
        await recorder.RecordAsync(Record(Tenant, "f1", Fixtures.Now, 20_000, JobKind.Palette, op: "palette_season"), default);
        await recorder.RecordAsync(Record(AiUsageEntity.AdminTenant, "trial#1", Fixtures.Now, 5_000, JobKind.AiTrial), default);
        var (service, _) = Service(repository);

        var summary = await service.GetSummaryAsync(Today.AddDays(-29), Today, default);

        Assert.Equal(30, summary.Days.Count);
        Assert.Equal(1_225_000, summary.Days[^1].CostMicroUsd);
        Assert.Equal(1_200_000 + 1_000_000 + 20_000 + 5_000, summary.Totals.CostMicroUsd);
        Assert.Equal(5_000, summary.Admin.CostMicroUsd);
        Assert.Equal(AiUsageOperations.StylistOutfit, summary.Operations[0].Operation);
        Assert.Equal("gpt-6-astra", summary.Models[0].Model);

        var premium = summary.Plans.Single(p => p.Plan == AiUsagePlans.Premium);
        Assert.Equal((1, 2_200_000L, 2_200_000L), (premium.ActiveUsers, premium.Totals.CostMicroUsd, premium.CostPerActiveUserPer30DaysMicroUsd));
        Assert.Equal(Math.Round(2.2m * 43m / 141.66m, 4), premium.ShareOfMonthlyNet);
        Assert.Equal(Math.Round(2.2m * 43m / 88.54m, 4), premium.ShareOfYearlyNet);
        var free = summary.Plans.Single(p => p.Plan == AiUsagePlans.Free);
        Assert.Equal((1, 20_000L), (free.ActiveUsers, free.CostPerActiveUserMicroUsd));
        Assert.Null(free.ShareOfMonthlyNet);

        Assert.Equal([heavy, Tenant], summary.TopUsers.Select(u => u.TenantId));
        Assert.Equal(("m***", "m***@e***.org", 11), (summary.TopUsers[0].Handle, summary.TopUsers[0].Email, summary.TopUsers[0].ActiveDays));
        Assert.Equal(("ay***", "a***@g***.com", User), (summary.TopUsers[1].Handle, summary.TopUsers[1].Email, summary.TopUsers[1].UserId));
        Assert.DoesNotContain(summary.TopUsers, u => u.TenantId == AiUsageEntity.AdminTenant);

        var anomaly = Assert.Single(summary.Anomalies);
        Assert.Equal(("2026-11-18", heavy, 100_000L, 12m), (anomaly.Day, anomaly.TenantId, anomaly.MedianMicroUsd!.Value, anomaly.Multiple!.Value));
        Assert.Equal([AiUsageMath.ReasonMedian], anomaly.Reasons);

        // A lower absolute threshold flags it for both reasons.
        var (strict, _) = Service(repository, new AiUsageOptions { AnomalyAbsoluteDayUsd = 1m });
        Assert.Equal([AiUsageMath.ReasonMedian, AiUsageMath.ReasonAbsolute], Assert.Single((await strict.GetSummaryAsync(Today, Today, default)).Anomalies).Reasons);
    }
}
