using System.Net;
using Domain.Domain;
using Domain.Entity;
using Domain.Enum;
using Domain.Events;
using Domain.Extensions;
using Domain.Services;
using Domain.Services.Styling;
using Tests.Shared;

namespace ApiTests;

/// <summary>
/// "Kombini ayırmadan üzerimde gör" (docs/api/wardrobe-looks-plan-stylist.md §7): POST v1/tenant/tryon with target kind
/// photo (an item upload / draft) or importPhoto (an outfit import photo). The outfit photo is EXIF-stripped, hashed and
/// copied for the worker; the hash is the cache / credit identity. No AI is called here (the worker is not run).
/// </summary>
public class TryOnPhotoEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static object TryOn(string id, string kind = "photo", int? index = null) => new { requestId = Ulid.New(), target = new { kind, id, index } };

    private async Task<(HttpClient Client, string Tenant, PhotoEntity Body)> ArrangeAsync(bool grantConsents = true, bool premium = true)
    {
        var (client, auth) = await factory.RegisterAsync(grantConsents: grantConsents);
        if (premium)
            await factory.PremiumAsync(auth.TenantId);
        var body = await factory.PhotoAsync(auth.TenantId, PhotoKind.Body);
        return (client, auth.TenantId, body);
    }

    /// <summary>What POST v1/tenant/item/upload-url + the S3 POST leave behind.</summary>
    private async Task<string> UploadAsync(string tenant, byte[] image)
    {
        var id = Ulid.New();
        var key = StorageKeys.Upload(tenant, id);
        await factory.Storage.PutAsync(key, image, "image/jpeg", default);
        await factory.Repository.SaveAsync(new ItemUploadEntity { UploadId = id, TenantId = tenant, ContentType = "image/jpeg", S3Key = key, CreatedAt = DateTime.UtcNow });
        return id;
    }

    [Fact]
    public async Task Start_PhotoTarget_ReservesOneCredit_CopiesTheStrippedPhoto_SamePhotoAgainIsTheSameJob()
    {
        var (client, tenant, body) = await ArrangeAsync();
        var first = await UploadAsync(tenant, TestImages.JpegWithExif());
        var sameBytes = await UploadAsync(tenant, TestImages.JpegWithExif());   // the same photo picked again elsewhere

        var start = await client.PostJsonAsync("v1/tenant/tryon", TryOn(first));
        var again = await client.PostJsonAsync("v1/tenant/tryon", TryOn(sameBytes));

        Assert.Equal(HttpStatusCode.Accepted, start.StatusCode);
        var started = await start.ReadAsync<TryOnStartDto>();
        Assert.Equal(started.Job!.Id, (await again.ReadAsync<TryOnStartDto>()).Job!.Id);
        Assert.Equal(29, await factory.CreditsAsync(tenant));

        var message = Assert.Single(factory.Events.Of<TryOnRequestedEvent>(tenant));
        Assert.Equal(TryOnTargetKind.Photo, message.Target.Kind);
        Assert.Matches("^[0-9a-f]{32}$", message.Target.Id);
        Assert.Equal(body.Id, message.BodyPhotoId);
        Assert.Equal(CreditLedger.TryOnIdempotencyKey(body.Id, TryOnTargetKind.Photo, message.Target.Id, 0), message.CreditIdempotencyKey);

        var job = (await factory.Repository.GetAsync<JobEntity>(JobEntity.GetPk(tenant), JobEntity.GetSk(started.Job.Id)))!;
        var input = StylingJson.TryDeserialize<TryOnJobInput>(job.Input)!;
        Assert.Empty(input.Pieces);
        Assert.Equal(StorageKeys.TryOnReferenceUpload(tenant, message.Target.Id), input.ReferenceKey);
        var copy = factory.Storage.Objects[input.ReferenceKey!].Data;
        Assert.False(TestImages.Contains(copy, TestImages.ExifGps));           // location never reaches the AI provider
        Assert.Equal(TryOnRules.ReferenceHash(copy), message.Target.Id);
    }

    [Fact]
    public async Task Start_DraftAndImportPhoto_ResolveToTheSamePhotoIdentity()
    {
        var (client, tenant, _) = await ArrangeAsync();
        var image = TestImages.JpegSized(640, 960);

        // A draft of 12 whose upload the item processor already took: its EXIF-stripped original is used.
        var draft = new ItemDraftEntity { Id = Ulid.New(), TenantId = tenant, Kind = ItemDraftKind.Outfit, Status = ItemDraftStatus.Ready, CreatedAt = DateTime.UtcNow };
        draft.OriginalKey = StorageKeys.ItemOriginal(tenant, draft.Id, "jpg");
        await factory.Storage.PutAsync(draft.OriginalKey, image, "image/jpeg", default);
        await factory.Repository.SaveAsync(draft);

        // Photo 3 of an outfit import session.
        var session = Ulid.New();
        var photo = new OutfitImportPhotoEntity
        {
            TenantId = tenant, SessionId = session, Index = 3, Status = OutfitImportPhotoStatus.Ready, LookId = Ulid.New(),
            UploadKey = StorageKeys.ImportUpload(tenant, session, 3), PhotoKey = StorageKeys.ImportPhoto(tenant, session, 3, "jpg"), CreatedAt = DateTime.UtcNow,
        };
        await factory.Storage.PutAsync(photo.PhotoKey, image, "image/jpeg", default);
        await factory.Repository.SaveAsync(photo);

        var fromDraft = await client.PostJsonAsync("v1/tenant/tryon", TryOn(draft.Id));
        var fromImport = await client.PostJsonAsync("v1/tenant/tryon", TryOn(session, "importPhoto", 3));
        var noIndex = await client.PostJsonAsync("v1/tenant/tryon", TryOn(session, "importPhoto"));
        var unknownPhoto = await client.PostJsonAsync("v1/tenant/tryon", TryOn(session, "importPhoto", 4));

        Assert.Equal(HttpStatusCode.Accepted, fromDraft.StatusCode);
        Assert.Equal((await fromDraft.ReadAsync<TryOnStartDto>()).Job!.Id, (await fromImport.ReadAsync<TryOnStartDto>()).Job!.Id);
        Assert.Equal(HttpStatusCode.BadRequest, noIndex.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, unknownPhoto.StatusCode);
        Assert.Equal(29, await factory.CreditsAsync(tenant));
    }

    [Fact]
    public async Task Start_CachedPhotoImage_200_NoCredit_WithTheSourcePhoto_FindAndGetToo()
    {
        var (client, tenant, body) = await ArrangeAsync();
        var upload = await UploadAsync(tenant, TestImages.JpegWithExif());
        var hash = TryOnRules.ReferenceHash(ImageMetadataStripper.Strip(TestImages.JpegWithExif())!.Data);
        var image = new TryOnImageEntity
        {
            Id = Ulid.New(), TenantId = tenant, BodyPhotoId = body.Id, SourcePhotoId = body.Id, TargetKind = TryOnTargetKind.Photo, TargetId = hash, CreatedAt = DateTime.UtcNow,
        };
        image.S3Key = $"{StorageKeys.TryOnPrefix(tenant)}{image.Id}.webp";
        image.ReferenceKey = StorageKeys.TryOnReference(tenant, image.Id, "jpg");
        await factory.Repository.SaveAsync(image);

        var cached = await client.PostJsonAsync("v1/tenant/tryon", TryOn(upload));
        var found = await client.GetAsync($"v1/tenant/tryon?kind=photo&id={upload}");
        var byId = await client.GetAsync($"v1/tenant/tryon/{image.Id}");

        Assert.Equal(HttpStatusCode.OK, cached.StatusCode);
        var dto = await cached.ReadAsync<TryOnStartDto>();
        Assert.Equal(StartStatus.Cached, dto.Status);
        Assert.Contains($"tenant/{tenant}/tryon/{image.Id}-ref.jpg", dto.Image!.ReferenceUrl);
        Assert.Equal(30, await factory.CreditsAsync(tenant));
        Assert.Empty(factory.Events.Of<TryOnRequestedEvent>(tenant));
        Assert.Equal(image.Id, (await found.ReadAsync<TryOnImageDto>()).Id);
        Assert.NotNull((await byId.ReadAsync<TryOnImageDto>()).ReferenceUrl);
    }

    [Fact]
    public async Task Start_PhotoTarget_Guards()
    {
        var (client, tenant, _) = await ArrangeAsync();
        var (other, otherTenant, _) = await ArrangeAsync();
        var notAnImage = await UploadAsync(tenant, "%PDF-1.7 not an image"u8.ToArray());
        var foreign = await UploadAsync(otherTenant, TestImages.JpegWithExif());

        var invalid = await client.PostJsonAsync("v1/tenant/tryon", TryOn(notAnImage));
        var unknown = await client.PostJsonAsync("v1/tenant/tryon", TryOn(Ulid.New()));
        var stranger = await client.PostJsonAsync("v1/tenant/tryon", TryOn(foreign));   // another tenant's upload id

        Assert.Equal((HttpStatusCode.UnprocessableEntity, "tryon_reference_invalid"), (invalid.StatusCode, await invalid.CodeAsync()));
        Assert.Equal((HttpStatusCode.NotFound, "target_not_found"), (unknown.StatusCode, await unknown.CodeAsync()));
        Assert.Equal(HttpStatusCode.NotFound, stranger.StatusCode);
        Assert.Equal(30, await factory.CreditsAsync(tenant));
        Assert.Empty(factory.Events.Of<TryOnRequestedEvent>(tenant));
        _ = other;
    }

    [Fact]
    public async Task Start_PhotoTarget_NeedsTheTryOnConsent_ThePlan_AndCredits()
    {
        var (noConsent, t1, _) = await ArrangeAsync(grantConsents: false);
        var (free, t2, _) = await ArrangeAsync(premium: false);

        var consent = await noConsent.PostJsonAsync("v1/tenant/tryon", TryOn(await UploadAsync(t1, TestImages.JpegWithExif())));
        var paywall = await free.PostJsonAsync("v1/tenant/tryon", TryOn(await UploadAsync(t2, TestImages.JpegWithExif())));

        Assert.Equal((HttpStatusCode.Forbidden, "consent_required"), (consent.StatusCode, await consent.CodeAsync()));
        Assert.Equal(HttpStatusCode.Forbidden, paywall.StatusCode);
        Assert.Empty(factory.Events.Of<TryOnRequestedEvent>(t1));
        Assert.Empty(factory.Events.Of<TryOnRequestedEvent>(t2));
    }

    [Fact]
    public async Task DeletingTheBodyPhoto_RemovesPhotoTryOnImages_AndTheirSourcePhotos()
    {
        var (client, tenant, body) = await ArrangeAsync();
        var image = new TryOnImageEntity
        {
            Id = Ulid.New(), TenantId = tenant, BodyPhotoId = body.Id, SourcePhotoId = body.Id, TargetKind = TryOnTargetKind.Photo,
            TargetId = "0123456789abcdef0123456789abcdef", CreatedAt = DateTime.UtcNow,
        };
        image.S3Key = $"{StorageKeys.TryOnPrefix(tenant)}{image.Id}.webp";
        image.ReferenceKey = StorageKeys.TryOnReference(tenant, image.Id, "jpg");
        await factory.Storage.PutAsync(image.S3Key, [1], "image/webp", default);
        await factory.Storage.PutAsync(image.ReferenceKey, [2], "image/jpeg", default);
        await factory.Repository.SaveAsync(image);

        var delete = await client.DeleteAsync($"v1/tenant/photo/body/{body.Id}");

        Assert.Equal(HttpStatusCode.NoContent, delete.StatusCode);
        Assert.Empty(await factory.Repository.GetAllAsync<TryOnImageEntity>(TryOnImageEntity.GetPk(tenant)));
        Assert.False(factory.Storage.Objects.ContainsKey(image.S3Key));
        Assert.False(factory.Storage.Objects.ContainsKey(image.ReferenceKey));
    }

    [Fact]
    public void AccountDeletion_CoversTheSourcePhotos()
    {
        // Both the job copy (uploads/tmp/) and the kept copy (tenant/…/tryon/) sit under prefixes account deletion removes.
        var tenant = "01JTENANT0000000000000000A";
        var prefixes = DeletionPlan.AccountS3Prefixes(tenant);
        Assert.Contains(prefixes, p => StorageKeys.TryOnReferenceUpload(tenant, "0123456789abcdef0123456789abcdef").StartsWith(p, StringComparison.Ordinal));
        Assert.Contains(prefixes, p => StorageKeys.TryOnReference(tenant, Ulid.New(), "jpg").StartsWith(p, StringComparison.Ordinal));
        Assert.Contains(DeletionPlan.PhotoS3Prefixes(tenant), p => StorageKeys.TryOnReference(tenant, Ulid.New(), "jpg").StartsWith(p, StringComparison.Ordinal));
    }
}
