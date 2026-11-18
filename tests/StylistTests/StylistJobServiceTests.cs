using Domain.Enum;
using Domain.Events;
using Domain.Services.Ai;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Stylist.Services;
using Tests.Shared;

namespace StylistTests;

public class StylistJobServiceTests
{
    private const string Tenant = "01JTENANT0000000000000000A";

    [Fact]
    public async Task Process_WhenProviderNotConfigured_ProviderError()
    {
        var host = new WorkerTestHost(s => s.AddSingleton<IStylistJobService, StylistJobService>());
        var job = await host.QueueJobAsync(Tenant, JobKind.StylistOutfit);

        await host.Get<IStylistJobService>().ProcessAsync(new StylistRequestedEvent(Tenant, job.Id, JobKind.StylistOutfit), false, default);

        Assert.Equal(JobFailure.ProviderError, (await host.JobAsync(job))!.Failure);
    }

    [Fact]
    public async Task Process_ModelOutputWithoutGuard_IsRejected_NeverStored()
    {
        var host = new WorkerTestHost(s =>
        {
            s.AddSingleton<IStylistJobService, StylistJobService>();
            s.RemoveAll<IStylistModel>();
            s.AddSingleton<IStylistModel>(new FixedModel("""{"looks":[{"itemId":"not-mine"}]}"""));
        });
        var job = await host.QueueJobAsync(Tenant, JobKind.StylistOutfit);

        await host.Get<IStylistJobService>().ProcessAsync(new StylistRequestedEvent(Tenant, job.Id, JobKind.StylistOutfit), false, default);

        var stored = await host.JobAsync(job);
        Assert.Equal(JobFailure.GuardRejected, stored!.Failure);
        Assert.Null(stored.Result);
    }

    private sealed class FixedModel(string output) : IStylistModel
    {
        public Task<string> GenerateAsync(StylistPrompt prompt, CancellationToken ct) => Task.FromResult(output);
    }
}
