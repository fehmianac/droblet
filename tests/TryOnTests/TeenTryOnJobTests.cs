using Domain.Entity;
using Domain.Enum;
using Domain.Events;
using Domain.Options;
using Domain.Services;
using Domain.Services.Ai;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Tests.Shared;
using TryOn.Services;

namespace TryOnTests;

/// <summary>
/// The worker side of teen try-on (docs/api/teen.md §6): the three conditions are read again before the image call, the
/// photo check's minor rule is relaxed only for such an account, the render carries the teen guard, photo try-on never.
/// </summary>
public class TeenTryOnJobTests
{
    private const string Tenant = "01JTENANT0000000000000000T";

    private sealed class Renderer : ITryOnRenderer
    {
        public int Adult { get; private set; }
        public int TeenRenders { get; private set; }

        public Task<ImageInput> RenderAsync(ImageInput bodyPhoto, IReadOnlyList<ImageInput> garments, CancellationToken ct, string? quality = null)
        {
            Adult++;
            return Task.FromResult(new ImageInput([1, 2, 3], "image/webp"));
        }

        public Task<ImageInput> RenderFromFaceAsync(ImageInput facePhoto, IReadOnlyList<ImageInput> garments, TryOnFigure figure, CancellationToken ct, string? quality = null) =>
            RenderAsync(facePhoto, garments, ct, quality);

        public Task<ImageInput> RenderOutfitPhotoAsync(ImageInput subject, ImageInput outfitPhoto, TryOnFigure? figure, CancellationToken ct, string? quality = null) =>
            RenderAsync(subject, [outfitPhoto], ct, quality);

        public Task<ImageInput> RenderTeenAsync(ImageInput photo, IReadOnlyList<ImageInput> garments, TryOnFigure? figure, CancellationToken ct, string? quality = null)
        {
            TeenRenders++;
            return Task.FromResult(new ImageInput([4, 5, 6], "image/webp"));
        }
    }

    /// <summary>Every photo "appears to be under 18" (the teen's own photo).</summary>
    private sealed class MinorInspector : IPhotoInspector
    {
        public bool IsConfigured => true;
        public Task<PhotoInspection> InspectAsync(ImageInput photo, PhotoKind kind, CancellationToken ct) =>
            Task.FromResult(new PhotoInspection(1, true, true, false, false, AppearsMinor: true));
        public Task<ReferenceInspection> InspectReferenceAsync(ImageInput outfitPhoto, CancellationToken ct) =>
            Task.FromResult(new ReferenceInspection(1, true, false));
    }

    private static async Task<(WorkerTestHost Host, Renderer Renderer, JobEntity Job, TryOnRequestedEvent Message)> ArrangeAsync(
        bool teen, bool flag, ParentalConsentStatus status = ParentalConsentStatus.Active, bool parentBox = true, bool ownConsent = true)
    {
        var renderer = new Renderer();
        var host = new WorkerTestHost(services =>
        {
            services.AddSingleton<ITryOnJobService, TryOnJobService>();
            services.RemoveAll<ITryOnRenderer>();
            services.AddSingleton<ITryOnRenderer>(renderer);
            services.RemoveAll<IPhotoInspector>();
            services.AddSingleton<IPhotoInspector>(new MinorInspector());
            services.PostConfigure<TeenOptions>(o => o.TryOnEnabled = flag);
        });
        await host.Repository.SaveAsync(new TenantEntity { Id = Tenant, OwnerUserId = "u1", AgeBand = teen ? AgeBand.Teen : AgeBand.Adult });
        if (teen)
        {
            await host.Repository.SaveAsync(new ParentalConsentEntity { TenantId = Tenant, UserId = "u1", Status = status, ParentAllowedTryOn = parentBox });
            if (ownConsent)
                await host.Repository.SaveAsync(new ConsentEntity { TenantId = Tenant, Type = ConsentType.TeenTryOn, Granted = true, Version = ConsentOptions.DefaultVersion });
        }
        await host.MakePremiumAsync(Tenant);
        var body = await host.AddPhotoAsync(Tenant, PhotoKind.Body);
        var target = new TryOnTarget(TryOnTargetKind.Look, "look1", 1);
        var key = CreditLedger.TryOnIdempotencyKey(body.Id, target.Kind, target.Id, target.Version);
        var job = await host.QueueJobAsync(Tenant, JobKind.TryOn, key);
        await host.Get<ICreditService>().ReserveAsync(Tenant, key, job.Id, default);
        return (host, renderer, job, new TryOnRequestedEvent(Tenant, job.Id, target, body.Id, key));
    }

    [Fact]
    public async Task Adult_WhoAppearsMinor_IsStillRefused()
    {
        var (host, renderer, job, message) = await ArrangeAsync(teen: false, flag: true);
        await host.Get<ITryOnJobService>().ProcessAsync(message, false, default);
        Assert.Equal(JobFailure.GuardRejected, (await host.JobAsync(job))!.Failure);
        Assert.Equal(0, renderer.Adult + renderer.TeenRenders);
    }

    [Theory]
    [InlineData(false, ParentalConsentStatus.Active, true, true)]     // the flag (default false)
    [InlineData(true, ParentalConsentStatus.Withdrawn, true, true)]   // the parent withdrew after the request
    [InlineData(true, ParentalConsentStatus.Active, false, true)]     // no try-on box
    [InlineData(true, ParentalConsentStatus.Active, true, false)]     // no own consent
    public async Task Teen_MissingAnyCondition_IsRefusedBeforeTheImageCall_AndRefunded(bool flag, ParentalConsentStatus status, bool box, bool own)
    {
        var (host, renderer, job, message) = await ArrangeAsync(teen: true, flag, status, box, own);
        await host.Get<ITryOnJobService>().ProcessAsync(message, false, default);

        Assert.Equal(JobFailure.GuardRejected, (await host.JobAsync(job))!.Failure);
        Assert.Equal(0, renderer.Adult + renderer.TeenRenders);
        Assert.Equal(30, await host.RemainingCreditsAsync(Tenant));
    }

    [Fact]
    public async Task Teen_WithAllThree_MinorRuleRelaxed_RenderedWithTheTeenGuard()
    {
        var (host, renderer, job, message) = await ArrangeAsync(teen: true, flag: true);
        await host.Get<ITryOnJobService>().ProcessAsync(message, false, default);

        Assert.Equal(JobStatus.Completed, (await host.JobAsync(job))!.Status);
        Assert.Equal((1, 0), (renderer.TeenRenders, renderer.Adult));
    }
}
