using Domain.Entity;
using Domain.Enum;
using Domain.Events;
using Domain.Services;
using Domain.Services.Ai;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Palette.Services;
using Tests.Shared;

namespace PaletteTests;

public class PaletteGuardWorkerTests
{
    private const string Tenant = "01JTENANT0000000000000000A";

    private sealed class FakeAnalyzer(PaletteAnalysis analysis) : IPaletteAnalyzer
    {
        public Task<PaletteAnalysis> AnalyzeAsync(ImageInput facePhoto, CancellationToken ct) => Task.FromResult(analysis);
    }

    private static async Task<(WorkerTestHost Host, JobEntity Job)> RunAsync(PaletteAnalysis analysis)
    {
        var host = new WorkerTestHost(services =>
        {
            services.AddSingleton<IPaletteJobService, PaletteJobService>();
            services.RemoveAll<IPaletteAnalyzer>();
            services.AddSingleton<IPaletteAnalyzer>(new FakeAnalyzer(analysis));
        });
        var face = await host.AddPhotoAsync(Tenant, PhotoKind.Face);
        var job = await host.QueueJobAsync(Tenant, JobKind.Palette);
        await host.Get<IPaletteJobService>().ProcessAsync(new PaletteRequestedEvent(Tenant, job.Id, face.Id), false, default);
        return (host, (await host.JobAsync(job))!);
    }

    private static Task<PaletteResultEntity?> ResultAsync(WorkerTestHost host) =>
        host.Repository.GetAsync<PaletteResultEntity>(PaletteResultEntity.GetPk(Tenant), PaletteResultEntity.GetSk());

    [Fact]
    public async Task Process_StoresTheColoursOfTheSeasonTable_NotTheModelsOwnColours()
    {
        var (host, job) = await RunAsync(new PaletteAnalysis("warm-autumn", ["fuchsia"], ["camel"], 1, 0.9));

        var stored = await ResultAsync(host);
        var season = SeasonTypeCatalog.Find("warm-autumn")!;
        Assert.Equal(JobStatus.Completed, job.Status);
        Assert.Equal(season.FlatteringColorIds, stored!.FlatteringColorIds);
        Assert.Equal(season.AvoidColorIds, stored.AvoidColorIds);
        Assert.False(stored.LowConfidence);
    }

    [Fact]
    public async Task Process_LowConfidence_IsMarked()
    {
        var (host, _) = await RunAsync(new PaletteAnalysis("cool-winter", [], [], 1, 0.2));

        Assert.True((await ResultAsync(host))!.LowConfidence);
    }

    [Fact]
    public async Task Process_SeasonOutsideTheTable_GuardRejected_NothingStored()
    {
        var (host, job) = await RunAsync(new PaletteAnalysis("sunny-monsoon", [], [], 1, 0.9));

        Assert.Equal(JobFailure.GuardRejected, job.Failure);
        Assert.Null(await ResultAsync(host));
    }

    [Fact]
    public async Task Process_PhotoUnsuitable_AsksForANewPhoto()
    {
        var (host, job) = await RunAsync(new PaletteAnalysis("", [], [], 1, 0, "photo_unsuitable"));

        Assert.Equal(JobFailure.NoFaceDetected, job.Failure);
        Assert.Null(await ResultAsync(host));
    }
}
