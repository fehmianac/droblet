using Domain.Entity;
using Domain.Enum;
using Domain.Events;
using Domain.Services.Ai;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Palette.Services;
using Tests.Shared;

namespace PaletteTests;

public class PaletteJobServiceTests
{
    private const string Tenant = "01JTENANT0000000000000000A";

    private static async Task<(WorkerTestHost, JobEntity, PaletteRequestedEvent)> ArrangeAsync(IPaletteAnalyzer? analyzer = null)
    {
        var host = new WorkerTestHost(services =>
        {
            services.AddSingleton<IPaletteJobService, PaletteJobService>();
            if (analyzer is not null)
            {
                services.RemoveAll<IPaletteAnalyzer>();
                services.AddSingleton(analyzer);
            }
        });
        var face = await host.AddPhotoAsync(Tenant, PhotoKind.Face);
        var job = await host.QueueJobAsync(Tenant, JobKind.Palette);
        return (host, job, new PaletteRequestedEvent(Tenant, job.Id, face.Id));
    }

    [Fact]
    public async Task Process_WhenProviderNotConfigured_ProviderError()
    {
        var (host, job, message) = await ArrangeAsync();

        await host.Get<IPaletteJobService>().ProcessAsync(message, false, default);

        Assert.Equal(JobFailure.ProviderError, (await host.JobAsync(job))!.Failure);
    }

    [Fact]
    public async Task Process_WhenOneFace_StoresIdsOnly()
    {
        var (host, job, message) = await ArrangeAsync(new FakeAnalyzer(new PaletteAnalysis("warm-autumn", ["rust", "olive"], ["icy-blue"], 1)));

        await host.Get<IPaletteJobService>().ProcessAsync(message, false, default);

        Assert.Equal(JobStatus.Completed, (await host.JobAsync(job))!.Status);
        var result = await host.Repository.GetAsync<PaletteResultEntity>(PaletteResultEntity.GetPk(Tenant), PaletteResultEntity.GetSk());
        Assert.Equal("warm-autumn", result!.SeasonTypeId);
        Assert.Equal(message.FacePhotoId, result.SourcePhotoId);
        Assert.Single(host.Storage.Objects); // only the face photo — no copy or crop
    }

    [Fact]
    public async Task Process_AiUsage_PaletteIsCountedOnce_AsFreePlan()
    {
        var (host, _, message) = await ArrangeAsync(new FakeAnalyzer(new PaletteAnalysis("warm-autumn", ["rust", "olive"], ["icy-blue"], 1)));

        using (AiUsageProbe.Run("palette_season", "gpt-6.1-terra", 0.0008m))
        {
            await host.Get<IPaletteJobService>().ProcessAsync(message, false, default);
            await host.Get<IPaletteJobService>().ProcessAsync(message, false, default);
        }

        var day = await AiUsageProbe.DayAsync(host.Repository, Tenant, WorkerTestHost.Now);
        Assert.Equal((1L, 800L), (AiUsageProbe.Op(day, Domain.Services.AiUsageOperations.Palette, Domain.Services.AiUsageCounters.Calls), day[Domain.Services.AiUsageCounters.Cost]));
        var index = Assert.Single(await host.Repository.GetAllAsync<AiUsageDayIndexEntity>(AiUsageDayIndexEntity.GetPk(DateOnly.FromDateTime(WorkerTestHost.Now))));
        Assert.Equal((Tenant, "free", 800L), (index.TenantId, index.Plan, index.Cost));
    }

    [Theory]
    [InlineData(0, JobFailure.NoFaceDetected)]
    [InlineData(2, JobFailure.NoFaceDetected)]
    public async Task Process_WhenNotExactlyOneFace_NoFaceDetected(int faces, JobFailure failure)
    {
        var (host, job, message) = await ArrangeAsync(new FakeAnalyzer(new PaletteAnalysis("warm-autumn", ["rust"], ["icy-blue"], faces)));

        await host.Get<IPaletteJobService>().ProcessAsync(message, false, default);

        Assert.Equal(failure, (await host.JobAsync(job))!.Failure);
    }

    [Fact]
    public async Task Process_WhenFlatteringAndAvoidOverlap_GuardRejected()
    {
        var (host, job, message) = await ArrangeAsync(new FakeAnalyzer(new PaletteAnalysis("warm-autumn", ["rust"], ["rust"], 1)));

        await host.Get<IPaletteJobService>().ProcessAsync(message, false, default);

        Assert.Equal(JobFailure.GuardRejected, (await host.JobAsync(job))!.Failure);
        Assert.Null(await host.Repository.GetAsync<PaletteResultEntity>(PaletteResultEntity.GetPk(Tenant), PaletteResultEntity.GetSk()));
    }

    private sealed class FakeAnalyzer(PaletteAnalysis analysis) : IPaletteAnalyzer
    {
        public Task<PaletteAnalysis> AnalyzeAsync(ImageInput facePhoto, CancellationToken ct) => Task.FromResult(analysis);
    }
}
