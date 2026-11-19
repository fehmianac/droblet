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

    private static async Task<(WorkerTestHost Host, JobEntity Job, TryOnRequestedEvent Message)> ArrangeAsync(ITryOnRenderer? renderer = null, IPhotoInspector? inspector = null,
        Action<IServiceCollection>? configure = null)
    {
        var host = new WorkerTestHost(services =>
        {
            services.AddSingleton<ITryOnJobService, TryOnJobService>();
            configure?.Invoke(services);
            if (renderer is not null)
            {
                services.RemoveAll<ITryOnRenderer>();
                services.AddSingleton(renderer);
            }
            if (inspector is not null)
            {
                services.RemoveAll<IPhotoInspector>();
                services.AddSingleton(inspector);
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

    private sealed class QualityRenderer : ITryOnRenderer
    {
        public List<string?> Qualities { get; } = [];
        public Func<Task>? BeforeSecond { get; set; }

        public async Task<ImageInput> RenderAsync(ImageInput bodyPhoto, IReadOnlyList<ImageInput> garments, CancellationToken ct, string? quality = null)
        {
            Qualities.Add(quality);
            if (Qualities.Count == 2 && BeforeSecond is not null)
                await BeforeSecond();
            return new ImageInput([(byte)Qualities.Count, 1, 1], "image/webp");
        }

        public Task<ImageInput> RenderFromFaceAsync(ImageInput facePhoto, IReadOnlyList<ImageInput> garments, TryOnFigure figure, CancellationToken ct, string? quality = null) =>
            RenderAsync(facePhoto, garments, ct, quality);
    }

    [Fact]
    public async Task Process_WithPreview_CompletesWithTheFastImage_ThenTheFullImageReplacesIt_OneCredit()
    {
        var renderer = new QualityRenderer();
        WorkerTestHost? hostRef = null;
        JobStatus? statusDuringFullRender = null;
        var (host, job, message) = await ArrangeAsync(renderer, configure: s => s.Configure<Domain.Options.AiOptions>(o => o.Image.TryOnPreview = true));
        hostRef = host;
        renderer.BeforeSecond = async () => statusDuringFullRender = (await hostRef.JobAsync(job))!.Status;

        await host.Get<ITryOnJobService>().ProcessAsync(message, false, default);

        Assert.Equal(["low", null], renderer.Qualities);
        Assert.Equal(JobStatus.Completed, statusDuringFullRender); // the user already had the preview
        var image = Assert.Single(await host.Repository.GetAllAsync<TryOnImageEntity>(TryOnImageEntity.GetPk(Tenant)));
        Assert.Equal(2, host.Storage.Objects[image.S3Key].Data[0]); // the full render under the same key
        Assert.Equal(29, await host.RemainingCreditsAsync(Tenant));
    }

    [Fact]
    public async Task Process_WithPreview_FullRenderCutByTheTimeBudgetOnTheLastAttempt_JobStaysCompleted()
    {
        // The full-quality render runs after the job completed; the worker's time budget (CancelAfter) can end it.
        var renderer = new QualityRenderer();
        using var budget = new CancellationTokenSource();
        var (host, job, message) = await ArrangeAsync(renderer, configure: s => s.Configure<Domain.Options.AiOptions>(o => o.Image.TryOnPreview = true));
        renderer.BeforeSecond = async () =>
        {
            await budget.CancelAsync();
            budget.Token.ThrowIfCancellationRequested();
        };

        await host.Get<ITryOnJobService>().ProcessAsync(message, isLastAttempt: true, budget.Token);

        var stored = await host.JobAsync(job);
        Assert.Equal(JobStatus.Completed, stored!.Status);
        Assert.Null(stored.Failure);
        var image = Assert.Single(await host.Repository.GetAllAsync<TryOnImageEntity>(TryOnImageEntity.GetPk(Tenant)));
        Assert.Equal(1, host.Storage.Objects[image.S3Key].Data[0]); // the preview stays
        Assert.Equal(29, await host.RemainingCreditsAsync(Tenant));
    }

    [Fact]
    public async Task Process_WithPreview_ImageDeletedBeforeTheFullRender_IsNotWrittenBack()
    {
        var renderer = new QualityRenderer();
        WorkerTestHost? hostRef = null;
        var (host, job, message) = await ArrangeAsync(renderer, configure: s => s.Configure<Domain.Options.AiOptions>(o => o.Image.TryOnPreview = true));
        hostRef = host;
        renderer.BeforeSecond = async () =>
        {
            foreach (var image in await hostRef.Repository.GetAllAsync<TryOnImageEntity>(TryOnImageEntity.GetPk(Tenant)))
            {
                await hostRef.Repository.DeleteAsync(image.Pk, image.Sk);
                await hostRef.Storage.DeleteAsync(image.S3Key, default);
            }
        };

        await host.Get<ITryOnJobService>().ProcessAsync(message, false, default);

        Assert.Equal(JobStatus.Completed, (await host.JobAsync(job))!.Status);
        Assert.DoesNotContain(host.Storage.Objects.Keys, k => k.Contains("/tryon/", StringComparison.Ordinal));
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

    // ── Face path (owner decision 4) and the photo check (canvas 11 "Fotoğraf uygun değil") ─────────────────────────

    private static async Task<(WorkerTestHost Host, JobEntity Job, TryOnRequestedEvent Message, PhotoEntity Face)> ArrangeFaceAsync(
        FakeRenderer renderer, IPhotoInspector? inspector = null)
    {
        var (host, _, _) = await ArrangeAsync(renderer, inspector);
        foreach (var key in await host.Repository.GetKeysAsync(PhotoEntity.GetPk(Tenant)))
            await host.Repository.DeleteAsync(key.Pk, key.Sk);
        var face = await host.AddPhotoAsync(Tenant, PhotoKind.Face);
        var subject = TryOnRules.FaceSubjectKey(face.Id, BodyType.Pear, 168, ClothingSize.M);
        var target = new TryOnTarget(TryOnTargetKind.Look, "look2", 1);
        var key2 = CreditLedger.TryOnIdempotencyKey(subject, target.Kind, target.Id, target.Version);
        var job = await host.QueueJobAsync(Tenant, JobKind.TryOn, key2);
        await host.Get<ICreditService>().ReserveAsync(Tenant, key2, job.Id, default);
        return (host, job, new TryOnRequestedEvent(Tenant, job.Id, target, subject, key2, TryOnSource.Face, face.Id, BodyType.Pear, 168, ClothingSize.M), face);
    }

    [Fact]
    public async Task Process_FacePath_RendersFromTheFacePhotoWithTheFigure_AndMarksTheImageFace()
    {
        var renderer = new FakeRenderer();
        var (host, job, message, face) = await ArrangeFaceAsync(renderer);

        await host.Get<ITryOnJobService>().ProcessAsync(message, false, default);

        Assert.Equal(JobStatus.Completed, (await host.JobAsync(job))!.Status);
        Assert.Equal(new TryOnFigure(BodyType.Pear, 168, ClothingSize.M), Assert.Single(renderer.Figures));
        Assert.Equal(0, renderer.BodyRenders);
        var image = Assert.Single(await host.Repository.GetAllAsync<TryOnImageEntity>(TryOnImageEntity.GetPk(Tenant)));
        Assert.Equal(TryOnSource.Face, image.Source);
        Assert.Equal(face.Id, image.SourcePhotoId);
        Assert.Equal(message.BodyPhotoId, image.BodyPhotoId);
        Assert.Equal(28, await host.RemainingCreditsAsync(Tenant)); // the body-path arrange reserved one too
    }

    [Fact]
    public async Task Process_FacePath_WhenFacePhotoGone_SourceDeleted_Refunds()
    {
        var (host, job, message, face) = await ArrangeFaceAsync(new FakeRenderer());
        await host.Repository.DeleteAsync(face.Pk, face.Sk);

        await host.Get<ITryOnJobService>().ProcessAsync(message, false, default);

        Assert.Equal(JobFailure.SourceDeleted, (await host.JobAsync(job))!.Failure);
    }

    [Theory]
    [InlineData(2, true, false, false, "multiplePeople")]
    [InlineData(1, false, false, false, "notFullBody")]
    [InlineData(1, true, true, false, "tooDark")]
    [InlineData(1, true, false, true, "blurry")]
    public async Task Process_BodyPhotoRejectedByTheCheck_NoCredit_PhotoRemoved_IssueInResult(int people, bool fullBody, bool dark, bool blurry, string issue)
    {
        var renderer = new FakeRenderer();
        var (host, job, message) = await ArrangeAsync(renderer, new FakeInspector(new PhotoInspection(people, fullBody, true, dark, blurry, false)));

        await host.Get<ITryOnJobService>().ProcessAsync(message, false, default);

        var stored = (await host.JobAsync(job))!;
        Assert.Equal(JobFailure.PhotoUnsuitable, stored.Failure);
        Assert.Contains($"\"photoIssue\":\"{issue}\"", stored.Result);
        Assert.Contains("\"photoKind\":\"body\"", stored.Result);
        Assert.Equal(0, renderer.BodyRenders);
        Assert.Empty(await host.Repository.GetAllAsync<PhotoEntity>(PhotoEntity.GetPk(Tenant)));
        Assert.DoesNotContain(host.Storage.Objects.Keys, k => k.Contains("/photos/body/", StringComparison.Ordinal) || k.Contains("/body/", StringComparison.Ordinal));
        Assert.Equal(30, await host.RemainingCreditsAsync(Tenant));
    }

    [Fact]
    public async Task Process_PhotoPassesTheCheck_IsInspectedOnce()
    {
        var inspector = new FakeInspector(new PhotoInspection(1, true, true, false, false, false));
        var (host, job, message) = await ArrangeAsync(new FakeRenderer(), inspector);

        await host.Get<ITryOnJobService>().ProcessAsync(message, false, default);

        Assert.Equal(JobStatus.Completed, (await host.JobAsync(job))!.Status);
        Assert.Equal(1, inspector.Calls);
        var photo = Assert.Single(await host.Repository.GetAllAsync<PhotoEntity>(PhotoEntity.GetPk(Tenant)));
        Assert.NotNull(photo.InspectedAt);
    }

    [Fact]
    public async Task Process_FacePhotoOfAMinor_GuardRejected_NoRender()
    {
        var renderer = new FakeRenderer();
        var (host, job, message, _) = await ArrangeFaceAsync(renderer, new FakeInspector(new PhotoInspection(1, false, true, false, false, AppearsMinor: true)));

        await host.Get<ITryOnJobService>().ProcessAsync(message, false, default);

        Assert.Equal(JobFailure.GuardRejected, (await host.JobAsync(job))!.Failure);
        Assert.Empty(renderer.Figures);
    }

    [Fact]
    public void PhotoIssue_FaceNeedsExactlyOneVisibleFace()
    {
        Assert.Equal(PhotoIssue.NoFace, TryOnRules.IssueOf(PhotoKind.Face, new PhotoInspection(1, false, false, false, false, false)));
        Assert.Equal(PhotoIssue.MultiplePeople, TryOnRules.IssueOf(PhotoKind.Face, new PhotoInspection(3, false, true, false, false, false)));
        Assert.Null(TryOnRules.IssueOf(PhotoKind.Face, new PhotoInspection(1, false, true, false, false, false)));
    }

    private sealed class FakeInspector(PhotoInspection verdict) : IPhotoInspector
    {
        public int Calls { get; private set; }
        public bool IsConfigured => true;

        public Task<PhotoInspection> InspectAsync(ImageInput photo, PhotoKind kind, CancellationToken ct)
        {
            Calls++;
            return Task.FromResult(verdict);
        }
    }

    private sealed class FakeRenderer(Func<Task>? during = null) : ITryOnRenderer
    {
        public FakeRenderer(Action during) : this(() => { during(); return Task.CompletedTask; }) { }

        public int BodyRenders { get; private set; }
        public List<TryOnFigure> Figures { get; } = [];

        public async Task<ImageInput> RenderAsync(ImageInput bodyPhoto, IReadOnlyList<ImageInput> garments, CancellationToken ct, string? quality = null)
        {
            BodyRenders++;
            if (during is not null) await during();
            return new ImageInput([9, 9, 9], "image/webp");
        }

        public async Task<ImageInput> RenderFromFaceAsync(ImageInput facePhoto, IReadOnlyList<ImageInput> garments, TryOnFigure figure, CancellationToken ct, string? quality = null)
        {
            Figures.Add(figure);
            if (during is not null) await during();
            return new ImageInput([8, 8, 8], "image/webp");
        }
    }
}
