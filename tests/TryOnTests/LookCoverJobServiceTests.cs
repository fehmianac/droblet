using Domain.Entity;
using Domain.Enum;
using Domain.Events;
using Domain.Options;
using Domain.Services;
using Domain.Services.Ai;
using Domain.Services.Styling;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using Tests.Shared;
using TryOn.Services;

namespace TryOnTests;

/// <summary>AI flat-lay look cover worker (canvas 21c): stale / ready / failed paths. The renderer is a fake — no AI call.</summary>
public class LookCoverJobServiceTests
{
    private const string Tenant = "01JTENANT0000000000000000A";
    private const string Other = "01JTENANT0000000000000000B";

    private sealed class FakeRenderer : ILookCoverRenderer
    {
        public bool IsConfigured { get; set; } = true;
        public List<IReadOnlyList<ImageInput>> Calls { get; } = [];
        public Exception? Throw { get; set; }
        public Func<Task>? During { get; set; }

        public async Task<ImageInput> RenderFlatlayAsync(IReadOnlyList<ImageInput> pieces, CancellationToken ct)
        {
            Calls.Add(pieces);
            if (During is not null)
                await During();
            if (Throw is not null)
                throw Throw;
            return new ImageInput([7, 7, 7], "image/webp");
        }
    }

    private sealed class NoGlobalImages : ICatalogProductLookup
    {
        public Task<ProductSnapshot?> GetAsync(string productId, CancellationToken ct) => Task.FromResult<ProductSnapshot?>(null);
        public Task<ImageInput?> ReadImageAsync(ProductSnapshot product, CancellationToken ct) => Task.FromResult<ImageInput?>(null);
    }

    private sealed record Arranged(WorkerTestHost Host, FakeRenderer Renderer, LookEntity Look, JobEntity Job, LookCoverRequestedEvent Message)
    {
        public ILookCoverJobService Service => Host.Get<ILookCoverJobService>();
        public Task<LookCoverEntity?> CoverAsync() => Host.Repository.GetAsync<LookCoverEntity>(LookCoverEntity.GetPk(Tenant), LookCoverEntity.GetSk(Look.Id));
        public Task<LookEntity?> StoredLookAsync() => Host.Repository.GetAsync<LookEntity>(Look.Pk, Look.Sk);
        public string Key => StorageKeys.LookCover(Tenant, Look.Id, Message.SlotsHash);
    }

    /// <summary>A saved look of two own pieces with images, its cover row Pending for this job (what the Api writes).</summary>
    private static async Task<Arranged> ArrangeAsync(Action<IServiceCollection>? configure = null)
    {
        var renderer = new FakeRenderer();
        var host = new WorkerTestHost(services =>
        {
            services.AddSingleton<ILookCoverJobService, LookCoverJobService>();
            services.RemoveAll<ILookCoverRenderer>();
            services.AddSingleton<ILookCoverRenderer>(renderer);
            services.RemoveAll<ICatalogProductLookup>();
            services.AddSingleton<ICatalogProductLookup>(new NoGlobalImages());
            configure?.Invoke(services);
        });
        await AddItemAsync(host, Tenant, "top1", 1);
        await AddItemAsync(host, Tenant, "bottom1", 2);
        var look = new LookEntity
        {
            Id = "01JLOOK00000000000000000AA", TenantId = Tenant, Name = "Ofis", Source = LookSource.User, CreatedAt = WorkerTestHost.Now, UpdatedAt = WorkerTestHost.Now,
            Slots = [new LookSlotValue { Slot = OutfitSlot.Top, ItemId = "top1" }, new LookSlotValue { Slot = OutfitSlot.Bottom, ItemId = "bottom1" }],
        };
        await host.Repository.SaveIfVersionAsync(look, 0);
        var job = await host.QueueJobAsync(Tenant, JobKind.LookCover);
        var hash = LookCoverRules.SlotsHash(look.Slots);
        await host.Repository.SaveIfVersionAsync(new LookCoverEntity
        {
            TenantId = Tenant, LookId = look.Id, SlotsHash = hash, Status = LookCoverStatus.Pending, JobId = job.Id, RequestedAt = WorkerTestHost.Now,
            UpdatedAt = WorkerTestHost.Now,
        }, 0);
        return new Arranged(host, renderer, look, job, new LookCoverRequestedEvent(Tenant, job.Id, look.Id, hash));
    }

    private static async Task AddItemAsync(WorkerTestHost host, string tenant, string id, byte marker)
    {
        var key = StorageKeys.ItemImage(tenant, id);
        await host.Storage.PutAsync(key, [marker], "image/webp", default);
        await host.Repository.SaveAsync(new ItemEntity { Id = id, TenantId = tenant, Category = ItemCategory.Top, ImageKey = key, Version = 1 });
    }

    [Fact]
    public async Task Process_RendersThePiecesImages_WritesTheCover_LeavesTheLookVersionAlone()
    {
        var a = await ArrangeAsync();

        await a.Service.ProcessAsync(a.Message, false, default);

        Assert.Equal([[1], [2]], Assert.Single(a.Renderer.Calls).Select(i => i.Data));
        Assert.Equal(JobStatus.Completed, (await a.Host.JobAsync(a.Job))!.Status);
        var cover = (await a.CoverAsync())!;
        Assert.Equal((LookCoverStatus.Ready, a.Key, a.Message.SlotsHash), (cover.Status, cover.ImageKey, cover.ImageHash));
        Assert.Equal($"tenant/{Tenant}/look-cover/{a.Look.Id}-{a.Message.SlotsHash}.webp", a.Key);
        Assert.Equal([7, 7, 7], a.Host.Storage.Objects[a.Key].Data);
        Assert.Equal(1L, (await a.StoredLookAsync())!.Version);   // the app's edit base is untouched
    }

    [Fact]
    public async Task Process_ReplacingAnOlderImage_DeletesIt()
    {
        var a = await ArrangeAsync();
        var oldKey = StorageKeys.LookCover(Tenant, a.Look.Id, "0000000000000000");
        await a.Host.Storage.PutAsync(oldKey, [1], "image/webp", default);
        var cover = (await a.CoverAsync())!;
        cover.ImageKey = oldKey;
        cover.ImageHash = "0000000000000000";
        await a.Host.Repository.SaveIfVersionAsync(cover, cover.Version);

        await a.Service.ProcessAsync(a.Message, false, default);

        Assert.False(a.Host.Storage.Objects.ContainsKey(oldKey));
        Assert.True(a.Host.Storage.Objects.ContainsKey(a.Key));
    }

    [Fact]
    public async Task Process_RecordsTheCost_UnderLookCover_WithoutACredit()
    {
        var a = await ArrangeAsync();

        using (AiUsageProbe.Run("image_look_cover", costUsd: 0.02m))
            await a.Service.ProcessAsync(a.Message, false, default);

        var day = await AiUsageProbe.DayAsync(a.Host.Repository, Tenant, WorkerTestHost.Now);
        Assert.Equal(1, AiUsageProbe.Op(day, AiUsageOperations.LookCover, AiUsageCounters.Completed));
        Assert.Equal(1, AiUsageProbe.Op(day, AiUsageOperations.LookCover, AiUsageCounters.Calls));
        Assert.Equal(0, day.GetValueOrDefault(AiUsageCounters.Refunded));
    }

    [Fact]
    public async Task Process_PiecesChangedSince_CompletesAsStale_NoAiCall()
    {
        var a = await ArrangeAsync();
        var look = (await a.StoredLookAsync())!;
        look.Slots.RemoveAt(1);
        look.Slots.Add(new LookSlotValue { Slot = OutfitSlot.Shoes, ItemId = "bottom1" });
        await a.Host.Repository.SaveIfVersionAsync(look, look.Version);

        await a.Service.ProcessAsync(a.Message, false, default);

        Assert.Empty(a.Renderer.Calls);
        var job = (await a.Host.JobAsync(a.Job))!;
        Assert.Equal(JobStatus.Completed, job.Status);
        Assert.Contains("stale", job.Result);
        Assert.Null((await a.CoverAsync())!.ImageKey);
    }

    [Fact]
    public async Task Process_LookDeleted_CompletesAsStale_NoAiCall()
    {
        var a = await ArrangeAsync();
        await a.Host.Repository.DeleteAsync(a.Look.Pk, a.Look.Sk);

        await a.Service.ProcessAsync(a.Message, false, default);

        Assert.Empty(a.Renderer.Calls);
        Assert.Equal(JobStatus.Completed, (await a.Host.JobAsync(a.Job))!.Status);
    }

    [Fact]
    public async Task Process_ANewerJobOwnsTheCover_CompletesAsStale_NoAiCall()
    {
        var a = await ArrangeAsync();
        var cover = (await a.CoverAsync())!;
        cover.JobId = "01JNEWERJOB000000000000000";
        await a.Host.Repository.SaveIfVersionAsync(cover, cover.Version);

        await a.Service.ProcessAsync(a.Message, false, default);

        Assert.Empty(a.Renderer.Calls);
        Assert.Equal(JobStatus.Completed, (await a.Host.JobAsync(a.Job))!.Status);
    }

    [Fact]
    public async Task Process_PiecesChangeWhileRendering_TheImageIsDropped_NothingRecorded()
    {
        var a = await ArrangeAsync();
        a.Renderer.During = async () =>
        {
            var look = (await a.StoredLookAsync())!;
            look.Slots.RemoveAt(1);
            await a.Host.Repository.SaveIfVersionAsync(look, look.Version);
        };

        await a.Service.ProcessAsync(a.Message, false, default);

        Assert.Single(a.Renderer.Calls);
        Assert.False(a.Host.Storage.Objects.ContainsKey(a.Key));
        Assert.Null((await a.CoverAsync())!.ImageKey);
        Assert.Equal(JobStatus.Completed, (await a.Host.JobAsync(a.Job))!.Status);
    }

    [Fact]
    public async Task Process_LookDeletedWhileRendering_TheCoverRowIsNotBroughtBack()
    {
        var a = await ArrangeAsync();
        a.Renderer.During = async () =>
        {
            await a.Host.Repository.DeleteAsync(a.Look.Pk, a.Look.Sk);
            await a.Host.Repository.DeleteAsync(LookCoverEntity.GetPk(Tenant), LookCoverEntity.GetSk(a.Look.Id));
        };

        await a.Service.ProcessAsync(a.Message, false, default);

        Assert.Null(await a.CoverAsync());
        Assert.False(a.Host.Storage.Objects.ContainsKey(a.Key));
    }

    [Fact]
    public async Task Process_KillSwitchOff_FailsQuietly_NoAiCall()
    {
        var a = await ArrangeAsync();
        a.Host.Get<IOptionsMonitor<AiOptions>>().CurrentValue.LookCover.Enabled = false;

        await a.Service.ProcessAsync(a.Message, false, default);

        Assert.Empty(a.Renderer.Calls);
        Assert.Equal(JobStatus.Failed, (await a.Host.JobAsync(a.Job))!.Status);
        Assert.Equal(LookCoverStatus.Failed, (await a.CoverAsync())!.Status);
    }

    [Fact]
    public async Task Process_ProviderNotConfigured_FailsQuietly_NoAiCall()
    {
        var a = await ArrangeAsync();
        a.Renderer.IsConfigured = false;

        await a.Service.ProcessAsync(a.Message, false, default);

        Assert.Empty(a.Renderer.Calls);
        Assert.Equal(LookCoverStatus.Failed, (await a.CoverAsync())!.Status);
    }

    [Fact]
    public async Task Process_NoPieceHasAnImage_FailsQuietly_NoAiCall()
    {
        var a = await ArrangeAsync();
        a.Host.Storage.Objects.Clear();

        await a.Service.ProcessAsync(a.Message, false, default);

        Assert.Empty(a.Renderer.Calls);
        Assert.Equal(JobFailure.SourceDeleted, (await a.Host.JobAsync(a.Job))!.Failure);
        Assert.Equal(LookCoverStatus.Failed, (await a.CoverAsync())!.Status);
    }

    [Fact]
    public async Task Process_APieceWithoutImage_IsLeftOut_AnotherTenantsItemIsNeverRead()
    {
        var a = await ArrangeAsync();
        await AddItemAsync(a.Host, Other, "theirs", 9);
        var look = (await a.StoredLookAsync())!;
        look.Slots.Add(new LookSlotValue { Slot = OutfitSlot.Shoes, ItemId = "theirs" });
        await a.Host.Repository.SaveIfVersionAsync(look, look.Version);
        var cover = (await a.CoverAsync())!;
        cover.SlotsHash = LookCoverRules.SlotsHash(look.Slots);
        await a.Host.Repository.SaveIfVersionAsync(cover, cover.Version);

        await a.Service.ProcessAsync(a.Message with { SlotsHash = cover.SlotsHash }, false, default);

        Assert.Equal([[1], [2]], Assert.Single(a.Renderer.Calls).Select(i => i.Data));
        Assert.Equal(LookCoverStatus.Ready, (await a.CoverAsync())!.Status);
    }

    [Fact]
    public async Task Process_ProviderRejects_FailsTheJobAndTheCover_NotRetried()
    {
        var a = await ArrangeAsync();
        a.Renderer.Throw = new AiProviderException("400");

        await a.Service.ProcessAsync(a.Message, false, default);

        Assert.Equal(JobFailure.ProviderError, (await a.Host.JobAsync(a.Job))!.Failure);
        Assert.Equal(LookCoverStatus.Failed, (await a.CoverAsync())!.Status);
    }

    [Fact]
    public async Task Process_TransientError_IsRetriedBySqs_UntilTheLastAttemptFailsQuietly()
    {
        var a = await ArrangeAsync();
        a.Renderer.Throw = new HttpRequestException("503");

        await Assert.ThrowsAsync<HttpRequestException>(() => a.Service.ProcessAsync(a.Message, false, default));
        Assert.Equal(LookCoverStatus.Pending, (await a.CoverAsync())!.Status);

        await a.Service.ProcessAsync(a.Message, true, default);
        Assert.Equal(LookCoverStatus.Failed, (await a.CoverAsync())!.Status);
        Assert.Equal(JobStatus.Failed, (await a.Host.JobAsync(a.Job))!.Status);
    }

    [Fact]
    public async Task Entrypoint_RoutesLookCoverMessages_ByKind()
    {
        Assert.True(TryOn.Entrypoint.IsLookCover(Infrastructure.Serialization.MessageSerializer.Serialize(new LookCoverRequestedEvent(Tenant, "j", "l", "h"))));
        Assert.False(TryOn.Entrypoint.IsLookCover(Infrastructure.Serialization.MessageSerializer.Serialize(
            new TryOnRequestedEvent(Tenant, "j", new TryOnTarget(TryOnTargetKind.Look, "x", 0), "b", "k"))));
        Assert.False(TryOn.Entrypoint.IsLookCover("not json"));
        Assert.Equal("tryon-queue", new QueueOptions { TryOnRequest = "tryon-queue", StylistRequest = "stylist" }.UrlFor(JobKind.LookCover));

        // End to end through the handler with the fake renderer.
        var a = await ArrangeAsync(services => services.AddSingleton<ITryOnJobService, TryOnJobService>());
        var entrypoint = new TryOn.Entrypoint(a.Host.Services);
        var response = await entrypoint.FunctionHandler(new Amazon.Lambda.SQSEvents.SQSEvent
        {
            Records = [new() { MessageId = "m1", Body = Infrastructure.Serialization.MessageSerializer.Serialize(a.Message), Attributes = new Dictionary<string, string>() }],
        }, new Amazon.Lambda.TestUtilities.TestLambdaContext { RemainingTime = TimeSpan.FromMinutes(2) });

        Assert.Empty(response.BatchItemFailures);
        Assert.Single(a.Renderer.Calls);
        Assert.Equal(LookCoverStatus.Ready, (await a.CoverAsync())!.Status);
    }
}
