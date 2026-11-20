using Domain.Entity;
using Domain.Enum;
using Domain.Events;
using Domain.Services;
using Domain.Services.Ai;
using Domain.Services.Styling;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Tests.Shared;
using TryOn.Services;

namespace TryOnTests;

/// <summary>
/// "Kombini ayırmadan üzerimde gör": the worker side of a photo try-on — the outfit photo replaces the garment images,
/// passes its own check (one person, clothing visible, no minor) and is kept next to the image. Fakes only: no AI call.
/// </summary>
public class TryOnPhotoJobTests
{
    private const string Tenant = "01JTENANT0000000000000000A";
    private const string Hash = "0123456789abcdef0123456789abcdef";

    private static async Task<(WorkerTestHost Host, JobEntity Job, TryOnRequestedEvent Message, string ReferenceKey)> ArrangeAsync(
        PhotoRenderer renderer, ReferenceInspection? verdict = null, bool face = false)
    {
        var host = new WorkerTestHost(services =>
        {
            services.AddSingleton<ITryOnJobService, TryOnJobService>();
            services.RemoveAll<ITryOnRenderer>();
            services.AddSingleton<ITryOnRenderer>(renderer);
            services.RemoveAll<IPhotoInspector>();
            services.AddSingleton<IPhotoInspector>(new ReferenceInspector(verdict ?? new ReferenceInspection(1, true, false)));
        });
        await host.MakePremiumAsync(Tenant);
        var photo = await host.AddPhotoAsync(Tenant, face ? PhotoKind.Face : PhotoKind.Body);
        var subject = face ? TryOnRules.FaceSubjectKey(photo.Id, BodyType.Pear, 168, ClothingSize.M) : photo.Id;
        var target = new TryOnTarget(TryOnTargetKind.Photo, Hash, 0);
        var key = CreditLedger.TryOnIdempotencyKey(subject, target.Kind, target.Id, target.Version);

        var referenceKey = StorageKeys.TryOnReferenceUpload(Tenant, Hash);
        await host.Storage.PutAsync(referenceKey, TestImages.JpegSized(600, 800), "image/jpeg", default);
        var job = await host.QueueJobAsync(Tenant, JobKind.TryOn, key);
        job.Input = StylingJson.Serialize(new TryOnJobInput([], referenceKey, "image/jpeg"));
        await host.Repository.SaveAsync(job);
        await host.Get<ICreditService>().ReserveAsync(Tenant, key, job.Id, default);

        var message = face
            ? new TryOnRequestedEvent(Tenant, job.Id, target, subject, key, TryOnSource.Face, photo.Id, BodyType.Pear, 168, ClothingSize.M)
            : new TryOnRequestedEvent(Tenant, job.Id, target, subject, key);
        return (host, job, message, referenceKey);
    }

    [Fact]
    public async Task Process_PhotoTryOn_RendersTheUserWithTheOutfitPhoto_KeepsItAsTheSourcePhoto_AndCommits()
    {
        var renderer = new PhotoRenderer();
        var (host, job, message, referenceKey) = await ArrangeAsync(renderer);

        await host.Get<ITryOnJobService>().ProcessAsync(message, false, default);

        Assert.Equal(JobStatus.Completed, (await host.JobAsync(job))!.Status);
        var call = Assert.Single(renderer.Calls);
        Assert.Null(call.Figure);
        Assert.Equal(TestImages.JpegSized(600, 800), call.Outfit.Data);
        var image = Assert.Single(await host.Repository.GetAllAsync<TryOnImageEntity>(TryOnImageEntity.GetPk(Tenant)));
        Assert.Equal(TryOnTargetKind.Photo, image.TargetKind);
        Assert.Equal(Hash, image.TargetId);
        Assert.Equal($"tenant/{Tenant}/tryon/{image.Id}-ref.jpg", image.ReferenceKey);
        Assert.True(host.Storage.Objects.ContainsKey(image.ReferenceKey!));
        Assert.False(host.Storage.Objects.ContainsKey(referenceKey));   // the job copy under uploads/tmp/ is gone
        Assert.Equal(29, await host.RemainingCreditsAsync(Tenant));
        var reservation = await host.Repository.GetAsync<CreditReservationEntity>(CreditReservationEntity.GetPk(Tenant), CreditReservationEntity.GetSk(message.CreditIdempotencyKey));
        Assert.Equal(CreditReservationStatus.Committed, reservation!.Status);
    }

    [Fact]
    public async Task Process_PhotoTryOn_FacePath_PassesTheFigure()
    {
        var renderer = new PhotoRenderer();
        var (host, job, message, _) = await ArrangeAsync(renderer, face: true);

        await host.Get<ITryOnJobService>().ProcessAsync(message, false, default);

        Assert.Equal(JobStatus.Completed, (await host.JobAsync(job))!.Status);
        Assert.Equal(new TryOnFigure(BodyType.Pear, 168, ClothingSize.M), Assert.Single(renderer.Calls).Figure);
        Assert.Equal(TryOnSource.Face, Assert.Single(await host.Repository.GetAllAsync<TryOnImageEntity>(TryOnImageEntity.GetPk(Tenant))).Source);
    }

    [Theory]
    [InlineData(0, true, false, "noPerson")]
    [InlineData(2, true, false, "multiplePeople")]
    [InlineData(1, false, false, "noClothing")]
    [InlineData(1, true, true, "minor")]
    public async Task Process_OutfitPhotoRejectedByTheCheck_GuardRejected_NoRender_Refunded(int people, bool clothing, bool minor, string issue)
    {
        var renderer = new PhotoRenderer();
        var (host, job, message, _) = await ArrangeAsync(renderer, new ReferenceInspection(people, clothing, minor));

        await host.Get<ITryOnJobService>().ProcessAsync(message, false, default);

        var stored = (await host.JobAsync(job))!;
        Assert.Equal(JobFailure.GuardRejected, stored.Failure);
        Assert.Contains($"\"referenceIssue\":\"{issue}\"", stored.Result);
        Assert.Empty(renderer.Calls);
        Assert.Empty(await host.Repository.GetAllAsync<TryOnImageEntity>(TryOnImageEntity.GetPk(Tenant)));
        Assert.Equal(30, await host.RemainingCreditsAsync(Tenant));
        // The user's own photo is not touched by a bad outfit photo.
        Assert.Single(await host.Repository.GetAllAsync<PhotoEntity>(PhotoEntity.GetPk(Tenant)));
    }

    [Fact]
    public async Task Process_OutfitPhotoGone_SourceDeleted_Refunded()
    {
        var renderer = new PhotoRenderer();
        var (host, job, message, referenceKey) = await ArrangeAsync(renderer);
        await host.Storage.DeleteAsync(referenceKey, default);

        await host.Get<ITryOnJobService>().ProcessAsync(message, false, default);

        Assert.Equal(JobFailure.SourceDeleted, (await host.JobAsync(job))!.Failure);
        Assert.Empty(renderer.Calls);
        Assert.Equal(30, await host.RemainingCreditsAsync(Tenant));
    }

    [Fact]
    public async Task Process_ReferenceKeyOfAnotherTenant_IsIgnored_NothingRendered()
    {
        var renderer = new PhotoRenderer();
        var (host, job, message, _) = await ArrangeAsync(renderer);
        job.Input = StylingJson.Serialize(new TryOnJobInput([], StorageKeys.TryOnReferenceUpload("01JTENANT0000000000000000B", Hash), "image/jpeg"));
        await host.Repository.SaveAsync(job);

        await host.Get<ITryOnJobService>().ProcessAsync(message, false, default);

        // Without a usable outfit photo the job is an empty outfit: rendered as the plain path, never with a foreign file.
        Assert.All(renderer.Calls, c => Assert.Fail("rendered with a foreign outfit photo"));
    }

    [Fact]
    public void ReferenceIssue_OnePersonWithClothingIsRequired()
    {
        Assert.Equal(ReferenceIssue.NoPerson, TryOnRules.ReferenceIssueOf(new ReferenceInspection(0, false, false)));
        Assert.Equal(ReferenceIssue.MultiplePeople, TryOnRules.ReferenceIssueOf(new ReferenceInspection(3, true, false)));
        Assert.Equal(ReferenceIssue.NoClothing, TryOnRules.ReferenceIssueOf(new ReferenceInspection(1, false, false)));
        Assert.Null(TryOnRules.ReferenceIssueOf(new ReferenceInspection(1, true, false)));
    }

    [Fact]
    public void ReferenceHash_IsStableAndLowerHex()
    {
        var a = TryOnRules.ReferenceHash([1, 2, 3]);
        Assert.Equal(a, TryOnRules.ReferenceHash([1, 2, 3]));
        Assert.NotEqual(a, TryOnRules.ReferenceHash([1, 2, 4]));
        Assert.Matches("^[0-9a-f]{32}$", a);
    }

    internal sealed record PhotoCall(ImageInput Subject, ImageInput Outfit, TryOnFigure? Figure);

    internal sealed class PhotoRenderer : ITryOnRenderer
    {
        public List<PhotoCall> Calls { get; } = [];

        public Task<ImageInput> RenderAsync(ImageInput bodyPhoto, IReadOnlyList<ImageInput> garments, CancellationToken ct, string? quality = null) =>
            Task.FromResult(new ImageInput([1, 1, 1], "image/webp"));

        public Task<ImageInput> RenderFromFaceAsync(ImageInput facePhoto, IReadOnlyList<ImageInput> garments, TryOnFigure figure, CancellationToken ct, string? quality = null) =>
            Task.FromResult(new ImageInput([2, 2, 2], "image/webp"));

        public Task<ImageInput> RenderOutfitPhotoAsync(ImageInput subject, ImageInput outfitPhoto, TryOnFigure? figure, CancellationToken ct, string? quality = null)
        {
            Calls.Add(new PhotoCall(subject, outfitPhoto, figure));
            return Task.FromResult(new ImageInput([3, 3, 3], "image/webp"));
        }
    }

    private sealed class ReferenceInspector(ReferenceInspection verdict) : IPhotoInspector
    {
        public bool IsConfigured => true;

        public Task<PhotoInspection> InspectAsync(ImageInput photo, PhotoKind kind, CancellationToken ct) =>
            Task.FromResult(new PhotoInspection(1, true, true, false, false, false));

        public Task<ReferenceInspection> InspectReferenceAsync(ImageInput outfitPhoto, CancellationToken ct) => Task.FromResult(verdict);
    }
}
