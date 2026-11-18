using Amazon.Lambda.SQSEvents;
using Amazon.Lambda.TestUtilities;
using Domain.Entity;
using Domain.Enum;
using Domain.Events;
using Domain.Services;
using Domain.Services.Ai;
using Infrastructure.Serialization;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Tests.Shared;
using TryOn;
using TryOn.Services;

namespace TryOnTests;

public class TryOnJobServiceTests
{
    private const string Tenant = "01JTENANT0000000000000000A";

    private static async Task<(WorkerTestHost Host, JobEntity Job, TryOnRequestedEvent Message)> ArrangeAsync(ITryOnRenderer? renderer = null)
    {
        var host = new WorkerTestHost(services =>
        {
            services.AddSingleton<ITryOnJobService, TryOnJobService>();
            if (renderer is not null)
            {
                services.RemoveAll<ITryOnRenderer>();
                services.AddSingleton(renderer);
            }
        });
        await host.MakePremiumAsync(Tenant);
        var body = await host.AddPhotoAsync(Tenant, PhotoKind.Body);
        var target = new TryOnTarget(TryOnTargetKind.Look, "look1", 1);
        var key = CreditLedger.TryOnIdempotencyKey(body.Id, target.Kind, target.Id, target.Version);
        var job = await host.QueueJobAsync(Tenant, JobKind.TryOn, key);
        await host.Get<ICreditService>().ReserveAsync(Tenant, key, job.Id, default);
        return (host, job, new TryOnRequestedEvent(Tenant, job.Id, target, body.Id, key));
    }

    [Fact]
    public async Task Process_WhenProviderNotConfigured_FailsWithProviderError_AndRefunds()
    {
        var (host, job, message) = await ArrangeAsync();
        Assert.Equal(29, await host.RemainingCreditsAsync(Tenant));

        await host.Get<ITryOnJobService>().ProcessAsync(message, isLastAttempt: false, default);

        var stored = await host.JobAsync(job);
        Assert.Equal(JobStatus.Failed, stored!.Status);
        Assert.Equal(JobFailure.ProviderError, stored.Failure);
        Assert.Equal(30, await host.RemainingCreditsAsync(Tenant));
    }

    [Fact]
    public async Task Process_WhenRendered_WritesOnlyUnderTenantTryOnPrefix_AndCommits()
    {
        var (host, job, message) = await ArrangeAsync(new FakeRenderer());

        await host.Get<ITryOnJobService>().ProcessAsync(message, false, default);

        Assert.Equal(JobStatus.Completed, (await host.JobAsync(job))!.Status);
        var image = Assert.Single(await host.Repository.GetAllAsync<TryOnImageEntity>(TryOnImageEntity.GetPk(Tenant)));
        Assert.StartsWith($"tenant/{Tenant}/tryon/", image.S3Key);
        Assert.True(host.Storage.Objects.ContainsKey(image.S3Key));
        Assert.Equal(29, await host.RemainingCreditsAsync(Tenant));
        var reservation = await host.Repository.GetAsync<CreditReservationEntity>(CreditReservationEntity.GetPk(Tenant), CreditReservationEntity.GetSk(message.CreditIdempotencyKey));
        Assert.Equal(CreditReservationStatus.Committed, reservation!.Status);
    }

    [Fact]
    public async Task Process_WhenBodyPhotoDeletedDuringRender_DiscardsOutput_SourceDeleted_Refunds()
    {
        WorkerTestHost? hostRef = null;
        var renderer = new FakeRenderer(async () =>
        {
            foreach (var key in await hostRef!.Repository.GetKeysAsync(PhotoEntity.GetPk(Tenant)))
                await hostRef.Repository.DeleteAsync(key.Pk, key.Sk);
        });
        var (host, job, message) = await ArrangeAsync(renderer);
        hostRef = host;

        await host.Get<ITryOnJobService>().ProcessAsync(message, false, default);

        Assert.Equal(JobFailure.SourceDeleted, (await host.JobAsync(job))!.Failure);
        Assert.Empty(await host.Repository.GetAllAsync<TryOnImageEntity>(TryOnImageEntity.GetPk(Tenant)));
        Assert.DoesNotContain(host.Storage.Objects.Keys, k => k.Contains("/tryon/", StringComparison.Ordinal));
        Assert.Equal(30, await host.RemainingCreditsAsync(Tenant));
    }

    [Fact]
    public async Task Process_WhenBodyPhotoAlreadyGone_SourceDeleted()
    {
        var (host, job, message) = await ArrangeAsync(new FakeRenderer());
        foreach (var key in await host.Repository.GetKeysAsync(PhotoEntity.GetPk(Tenant)))
            await host.Repository.DeleteAsync(key.Pk, key.Sk);

        await host.Get<ITryOnJobService>().ProcessAsync(message, false, default);

        Assert.Equal(JobFailure.SourceDeleted, (await host.JobAsync(job))!.Failure);
    }

    [Fact]
    public async Task Process_WhenUnexpectedErrorBeforeLastAttempt_Rethrows_ForSqsRetry()
    {
        var (host, job, message) = await ArrangeAsync(new FakeRenderer(() => throw new TimeoutException("network")));

        await Assert.ThrowsAsync<TimeoutException>(() => host.Get<ITryOnJobService>().ProcessAsync(message, false, default));
        Assert.Equal(JobStatus.Processing, (await host.JobAsync(job))!.Status);

        await host.Get<ITryOnJobService>().ProcessAsync(message, isLastAttempt: true, default);
    }

    [Fact]
    public async Task Process_OnLastAttempt_UnexpectedError_FailsAndRefunds()
    {
        var (host, job, message) = await ArrangeAsync(new FakeRenderer(() => throw new TimeoutException("network")));

        await host.Get<ITryOnJobService>().ProcessAsync(message, isLastAttempt: true, default);

        Assert.Equal(JobStatus.Failed, (await host.JobAsync(job))!.Status);
        Assert.Equal(30, await host.RemainingCreditsAsync(Tenant));
    }

    [Fact]
    public async Task Entrypoint_DeserializesMessage_ReportsNoFailure_DropsMalformed()
    {
        var (host, job, message) = await ArrangeAsync();
        var entrypoint = new Entrypoint(host.Services);
        var sqs = new SQSEvent
        {
            Records =
            [
                new SQSEvent.SQSMessage { MessageId = "m1", Body = MessageSerializer.Serialize(message), Attributes = new Dictionary<string, string> { ["ApproximateReceiveCount"] = "1" } },
                new SQSEvent.SQSMessage { MessageId = "m2", Body = "{not json" },
            ],
        };

        var response = await entrypoint.FunctionHandler(sqs, new TestLambdaContext { RemainingTime = TimeSpan.FromMinutes(2) });

        Assert.Empty(response.BatchItemFailures);
        Assert.Equal(JobStatus.Failed, (await host.JobAsync(job))!.Status);
    }

    private sealed class FakeRenderer(Func<Task>? during = null) : ITryOnRenderer
    {
        public FakeRenderer(Action during) : this(() => { during(); return Task.CompletedTask; }) { }

        public async Task<ImageInput> RenderAsync(ImageInput bodyPhoto, IReadOnlyList<ImageInput> garments, CancellationToken ct)
        {
            if (during is not null) await during();
            return new ImageInput([9, 9, 9], "image/webp");
        }
    }
}
