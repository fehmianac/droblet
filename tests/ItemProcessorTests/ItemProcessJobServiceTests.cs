using Domain.Enum;
using Domain.Events;
using Domain.Services;
using ItemProcessor.Services;
using Microsoft.Extensions.DependencyInjection;
using Tests.Shared;

namespace ItemProcessorTests;

public class ItemProcessJobServiceTests
{
    private const string Tenant = "01JTENANT0000000000000000A";

    [Fact]
    public async Task Process_WhenOriginalMissing_SourceDeleted()
    {
        var host = new WorkerTestHost(s => s.AddSingleton<IItemProcessJobService, ItemProcessJobService>());
        var job = await host.QueueJobAsync(Tenant, JobKind.ItemProcess);

        await host.Get<IItemProcessJobService>().ProcessAsync(new ItemProcessRequestedEvent(Tenant, job.Id, "draft1"), false, default);

        Assert.Equal(JobFailure.SourceDeleted, (await host.JobAsync(job))!.Failure);
    }

    [Fact]
    public async Task Process_WhenProviderNotConfigured_ProviderError_NothingWritten()
    {
        var host = new WorkerTestHost(s => s.AddSingleton<IItemProcessJobService, ItemProcessJobService>());
        var job = await host.QueueJobAsync(Tenant, JobKind.ItemProcess);
        await host.Storage.PutAsync(StorageKeys.Upload(Tenant, "draft1"), TestImages.JpegWithExif(), "image/jpeg", default);

        await host.Get<IItemProcessJobService>().ProcessAsync(new ItemProcessRequestedEvent(Tenant, job.Id, "draft1"), false, default);

        Assert.Equal(JobFailure.ProviderError, (await host.JobAsync(job))!.Failure);
        Assert.DoesNotContain(host.Storage.Objects.Keys, k => k.StartsWith(StorageKeys.ItemsPrefix(Tenant), StringComparison.Ordinal));
    }

    [Fact]
    public async Task Process_WhenJobAlreadyFinished_DoesNothing()
    {
        var host = new WorkerTestHost(s => s.AddSingleton<IItemProcessJobService, ItemProcessJobService>());
        var job = await host.QueueJobAsync(Tenant, JobKind.ItemProcess);
        job.Status = JobStatus.Completed;
        await host.Repository.SaveAsync(job);

        await host.Get<IItemProcessJobService>().ProcessAsync(new ItemProcessRequestedEvent(Tenant, job.Id, "draft1"), false, default);

        Assert.Equal(JobStatus.Completed, (await host.JobAsync(job))!.Status);
    }
}
