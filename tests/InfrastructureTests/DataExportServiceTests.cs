using System.Reflection;
using Domain.Entity;
using Domain.Events;
using Domain.Manager;
using Domain.Services;
using Infrastructure.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Tests.Shared;

namespace InfrastructureTests;

/// <summary>"Verilerimi indir" start: the per-tenant lock that makes "one active export" hold under concurrency.</summary>
public class DataExportServiceTests
{
    private const string Tenant = "t-export";

    private sealed class CountingEvents : IEventManager
    {
        private int _published;
        public int Published => _published;

        public Task PublishAsync(IJobRequestedEvent jobEvent, CancellationToken ct = default)
        {
            Interlocked.Increment(ref _published);
            return Task.CompletedTask;
        }
    }

    /// <summary>
    /// Holds every caller right after it read the lock row until all callers have read it: the requests' checks all
    /// see the same snapshot (no export, no lock), exactly the window two simultaneous POSTs hit in production.
    /// </summary>
    public class RacingRepository : DispatchProxy
    {
        public IRepository Inner { get; set; } = null!;
        public Barrier? Gate { get; set; }

        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args)
        {
            var result = targetMethod!.Invoke(Inner, args);
            if (Gate is { } gate && targetMethod is { Name: nameof(IRepository.GetAsync), IsGenericMethod: true }
                && targetMethod.GetGenericArguments()[0] == typeof(DataExportLockEntity))
                Assert.True(gate.SignalAndWait(TimeSpan.FromSeconds(10)), "the other request never reached the lock");
            return result;
        }
    }

    private static (DataExportService Service, InMemoryRepository Store, CountingEvents Events, RacingRepository Proxy) Create()
    {
        var store = new InMemoryRepository();
        var repository = DispatchProxy.Create<IRepository, RacingRepository>();
        var proxy = (RacingRepository)(object)repository;
        proxy.Inner = store;
        var events = new CountingEvents();
        var service = new DataExportService(repository, new FakeObjectStorage(), events, Fixtures.Clock(), NullLogger<DataExportService>.Instance);
        return (service, store, events, proxy);
    }

    [Fact]
    public async Task Start_TwoSimultaneousRequests_OnlyOneExportOneEventOneLock()
    {
        var (service, store, events, proxy) = Create();
        proxy.Gate = new Barrier(2);

        var results = await Task.WhenAll(
            Task.Run(() => service.StartAsync(Tenant, "u1", "tr", default)),
            Task.Run(() => service.StartAsync(Tenant, "u1", "tr", default)));

        Assert.Equal([DataExportStartOutcome.Started, DataExportStartOutcome.InProgress], results.Select(r => r.Outcome).Order().ToArray());
        var export = Assert.Single(await store.GetAllAsync<DataExportEntity>(DataExportEntity.GetPk(Tenant)));
        Assert.Equal(1, events.Published);
        var held = await store.GetAsync<DataExportLockEntity>(DataExportLockEntity.GetPk(Tenant), DataExportLockEntity.GetSk());
        Assert.Equal((export.Id, 1L), (held!.ExportId, held.Version));
        // The loser reports the winner's export.
        Assert.All(results, r => Assert.Equal(export.Id, r.State.Export!.Id));
    }

    [Fact]
    public async Task Start_LockOfAnActiveExport_Blocks_EvenIfTheRowCheckMissedIt()
    {
        var (service, store, events, _) = Create();
        var started = await service.StartAsync(Tenant, "u1", "tr", default);
        Assert.Equal(DataExportStartOutcome.Started, started.Outcome);

        Assert.Equal(DataExportStartOutcome.InProgress, (await service.StartAsync(Tenant, "u1", "tr", default)).Outcome);
        Assert.Single(await store.GetAllAsync<DataExportEntity>(DataExportEntity.GetPk(Tenant)));
        Assert.Equal(1, events.Published);
    }

    [Theory]
    [InlineData(DataExportStatus.Failed, 0)]       // failed: released at once
    [InlineData(DataExportStatus.Processing, 2)]   // abandoned: stale after the same 1 h rule
    [InlineData(DataExportStatus.Queued, 2)]
    public async Task Start_LockOfAFinishedOrAbandonedExport_IsOverwritten(DataExportStatus status, int hoursSinceTouched)
    {
        var (service, store, events, _) = Create();
        var first = (await service.StartAsync(Tenant, "u1", "tr", default)).State.Export!.Id;
        var row = await store.GetAsync<DataExportEntity>(DataExportEntity.GetPk(Tenant), DataExportEntity.GetSk(first));
        row!.Status = status;
        row.CreatedAt = Fixtures.Now.AddHours(-hoursSinceTouched - 1);
        row.UpdatedAt = Fixtures.Now.AddHours(-hoursSinceTouched);
        await store.SaveAsync(row);

        var again = await service.StartAsync(Tenant, "u1", "tr", default);

        Assert.Equal(DataExportStartOutcome.Started, again.Outcome);
        var held = await store.GetAsync<DataExportLockEntity>(DataExportLockEntity.GetPk(Tenant), DataExportLockEntity.GetSk());
        Assert.Equal((again.State.Export!.Id, 2L), (held!.ExportId, held.Version));
        Assert.Equal(2, events.Published);
    }

    [Fact]
    public async Task Start_ReadyExport_IsTooSoon_ThenTheLockIsReusedTheNextDay()
    {
        var (service, store, _, _) = Create();
        var first = (await service.StartAsync(Tenant, "u1", "tr", default)).State.Export!.Id;
        var row = await store.GetAsync<DataExportEntity>(DataExportEntity.GetPk(Tenant), DataExportEntity.GetSk(first));
        row!.Status = DataExportStatus.Ready;
        await store.SaveAsync(row);

        Assert.Equal(DataExportStartOutcome.TooSoon, (await service.StartAsync(Tenant, "u1", "tr", default)).Outcome);

        row.CreatedAt = Fixtures.Now.AddDays(-2);
        await store.SaveAsync(row);
        Assert.Equal(DataExportStartOutcome.Started, (await service.StartAsync(Tenant, "u1", "tr", default)).Outcome);
    }
}
