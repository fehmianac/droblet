using Domain.Entity;
using Domain.Enum;
using Domain.Options;
using Domain.Services;
using Infrastructure.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Tests.Shared;

namespace InfrastructureTests;

public class PhotoServiceTests
{
    private const string Tenant = "01JTENANT0000000000000000A";
    private readonly InMemoryRepository _repository = new();
    private readonly FakeObjectStorage _storage = new();

    private PhotoService Service() => new(_repository, _storage, Fixtures.Monitor(new PhotoOptions { MaxUploadBytes = 1024 * 1024 }), Fixtures.Clock(), NullLogger<PhotoService>.Instance);

    private async Task<string> UploadAsync(PhotoService service, PhotoKind kind, byte[] bytes)
    {
        var slot = await service.CreateUploadAsync(Tenant, kind, "image/jpeg", default);
        await _storage.PutAsync(StorageKeys.Upload(Tenant, slot.UploadId), bytes, "image/jpeg", default);
        return slot.UploadId;
    }

    [Fact]
    public async Task CreateUpload_KeyIsUnderTenantTmpPrefix()
    {
        var slot = await Service().CreateUploadAsync(Tenant, PhotoKind.Body, "image/jpeg", default);

        Assert.Equal(StorageKeys.Upload(Tenant, slot.UploadId), slot.Upload.Fields["key"]);
    }

    [Fact]
    public async Task Activate_StripsExif_StoresUnderBodyPrefix_DeletesTmp()
    {
        var service = Service();
        var uploadId = await UploadAsync(service, PhotoKind.Body, TestImages.JpegWithExif());

        var result = await service.ActivateAsync(Tenant, PhotoKind.Body, uploadId, Domain.Extensions.Ulid.New(), default);

        Assert.Equal(ActivatePhotoOutcome.Activated, result.Outcome);
        var stored = Assert.Single(_storage.Objects);
        Assert.StartsWith($"tenant/{Tenant}/body/", stored.Key);
        Assert.False(TestImages.Contains(stored.Value.Data, TestImages.ExifGps));
        Assert.Contains("X-Amz-Expires=", result.Photo!.Url);
    }

    [Fact]
    public async Task Activate_SameClientMutationIdTwice_AppliesOnce()
    {
        var service = Service();
        var uploadId = await UploadAsync(service, PhotoKind.Face, TestImages.Png(withText: true));
        var mutation = Domain.Extensions.Ulid.New();

        var first = await service.ActivateAsync(Tenant, PhotoKind.Face, uploadId, mutation, default);
        var second = await service.ActivateAsync(Tenant, PhotoKind.Face, uploadId, mutation, default);

        Assert.Equal(ActivatePhotoOutcome.Activated, first.Outcome);
        Assert.Equal(ActivatePhotoOutcome.AlreadyApplied, second.Outcome);
        Assert.Equal(first.Photo!.Id, second.Photo!.Id);
    }

    [Fact]
    public async Task Activate_WhenReplacingBodyPhoto_DeletesOldPhotoAndItsTryOns()
    {
        var service = Service();
        var first = await service.ActivateAsync(Tenant, PhotoKind.Body, await UploadAsync(service, PhotoKind.Body, TestImages.JpegWithExif()), Domain.Extensions.Ulid.New(), default);
        var tryOnKey = $"{StorageKeys.TryOnPrefix(Tenant)}x.webp";
        await _storage.PutAsync(tryOnKey, [1], "image/webp", default);
        await _repository.SaveAsync(new TryOnImageEntity { Id = "x", TenantId = Tenant, BodyPhotoId = first.Photo!.Id, TargetKind = TryOnTargetKind.Item, TargetId = "i1", TargetVersion = 1, S3Key = tryOnKey });

        var second = await service.ActivateAsync(Tenant, PhotoKind.Body, await UploadAsync(service, PhotoKind.Body, TestImages.JpegWithExif()), Domain.Extensions.Ulid.New(), default);

        var photos = await _repository.GetAllAsync<PhotoEntity>(PhotoEntity.GetPk(Tenant));
        Assert.Equal(second.Photo!.Id, Assert.Single(photos).Id);
        Assert.Empty(await _repository.GetAllAsync<TryOnImageEntity>(TryOnImageEntity.GetPk(Tenant)));
        Assert.False(_storage.Objects.ContainsKey(tryOnKey));
        Assert.Single(_storage.Objects);
    }

    [Fact]
    public async Task Activate_WhenNotAnImage_RejectsAndDiscardsUpload()
    {
        var service = Service();
        var uploadId = await UploadAsync(service, PhotoKind.Body, "%PDF-1.7 not an image"u8.ToArray());

        var result = await service.ActivateAsync(Tenant, PhotoKind.Body, uploadId, Domain.Extensions.Ulid.New(), default);

        Assert.Equal(ActivatePhotoOutcome.UnsupportedImage, result.Outcome);
        Assert.Empty(_storage.Objects);
    }

    [Fact]
    public async Task Activate_WhenKindDiffersFromUploadSlot_Rejects()
    {
        var service = Service();
        var uploadId = await UploadAsync(service, PhotoKind.Face, TestImages.JpegWithExif());

        Assert.Equal(ActivatePhotoOutcome.KindMismatch, (await service.ActivateAsync(Tenant, PhotoKind.Body, uploadId, Domain.Extensions.Ulid.New(), default)).Outcome);
    }

    [Fact]
    public async Task Activate_WhenUploadSlotOfAnotherTenant_NotFound()
    {
        var service = Service();
        var uploadId = await UploadAsync(service, PhotoKind.Body, TestImages.JpegWithExif());

        var result = await service.ActivateAsync("01JOTHER00000000000000000B", PhotoKind.Body, uploadId, Domain.Extensions.Ulid.New(), default);

        Assert.Equal(ActivatePhotoOutcome.UploadNotFound, result.Outcome);
    }

    [Fact]
    public async Task Activate_WhenFileNeverUploaded_UploadMissing()
    {
        var service = Service();
        var slot = await service.CreateUploadAsync(Tenant, PhotoKind.Body, "image/jpeg", default);

        Assert.Equal(ActivatePhotoOutcome.UploadMissing, (await service.ActivateAsync(Tenant, PhotoKind.Body, slot.UploadId, Domain.Extensions.Ulid.New(), default)).Outcome);
    }

    [Fact]
    public async Task DeleteAll_RemovesPhotosTryOnsPaletteAndPendingUploads_KeepsItems()
    {
        var service = Service();
        await service.ActivateAsync(Tenant, PhotoKind.Body, await UploadAsync(service, PhotoKind.Body, TestImages.JpegWithExif()), Domain.Extensions.Ulid.New(), default);
        await service.ActivateAsync(Tenant, PhotoKind.Face, await UploadAsync(service, PhotoKind.Face, TestImages.JpegWithExif()), Domain.Extensions.Ulid.New(), default);
        var pending = await UploadAsync(service, PhotoKind.Body, TestImages.JpegWithExif());
        await _storage.PutAsync($"{StorageKeys.TryOnPrefix(Tenant)}t.webp", [1], "image/webp", default);
        await _repository.SaveAsync(new TryOnImageEntity { Id = "t", TenantId = Tenant, BodyPhotoId = "p", TargetId = "i", S3Key = $"{StorageKeys.TryOnPrefix(Tenant)}t.webp" });
        await _repository.SaveAsync(new PaletteResultEntity { TenantId = Tenant, SeasonTypeId = "warm-autumn" });
        var itemKey = $"{StorageKeys.ItemsPrefix(Tenant)}i1.webp";
        await _storage.PutAsync(itemKey, [1], "image/webp", default);

        await service.DeleteAllAsync(Tenant, default);

        Assert.Equal([itemKey], _storage.Objects.Keys.ToArray());
        Assert.False(_storage.Objects.ContainsKey(StorageKeys.Upload(Tenant, pending)));
        foreach (var pk in DeletionPlan.PhotoPartitionKeys(Tenant))
            Assert.Empty(await _repository.GetKeysAsync(pk));
        Assert.Empty(await service.GetActiveAsync(Tenant, default));
    }
}
