using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Domain.Domain;
using Domain.Entity;
using Domain.Entity.Base;
using Domain.Enum;
using Domain.Events;
using Domain.Extensions;
using Domain.Services;
using Domain.Services.Ai;
using Domain.Services.Styling;
using Microsoft.Extensions.DependencyInjection;

namespace ApiTests;

/// <summary>Arrange helpers shared by the E2–E7 endpoint tests.</summary>
internal static class Seed
{
    public static readonly Season[] AllSeasons = [Season.Spring, Season.Summer, Season.Autumn, Season.Winter];

    public static async Task<ItemEntity> ItemAsync(this ApiFactory factory, string tenantId, ItemCategory category, string color = "black", string? id = null)
    {
        var item = new ItemEntity
        {
            Id = id ?? Ulid.New(), TenantId = tenantId, Name = category.ToString(), Category = category, ColorIds = [color],
            Seasons = AllSeasons.ToList(), Source = ItemSource.Photo, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
        };
        await factory.Repository.SaveIfVersionAsync(item, 0);
        return item;
    }

    public static async Task<LookEntity> LookAsync(this ApiFactory factory, string tenantId, params (OutfitSlot Slot, string ItemId)[] slots)
    {
        var look = new LookEntity
        {
            Id = Ulid.New(), TenantId = tenantId, Name = "Look", Source = LookSource.User, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
            Slots = slots.Select(s => new LookSlotValue { Slot = s.Slot, ItemId = s.ItemId }).ToList(),
        };
        await factory.Repository.SaveIfVersionAsync(look, 0);
        return look;
    }

    public static Task PremiumAsync(this ApiFactory factory, string tenantId)
    {
        var anchor = DateTime.UtcNow.AddDays(-3);
        return factory.Repository.SaveAsync(new EntitlementEntity
        {
            Id = "tx", TenantId = tenantId, Tier = Tier.Premium, Source = EntitlementSource.Store, Platform = StorePlatform.Apple,
            ProductId = "com.alatech.droplet.premium.monthly", StartsAt = anchor, ExpiresAt = anchor.AddMonths(1), PeriodAnchor = anchor,
        });
    }

    public static async Task<PhotoEntity> PhotoAsync(this ApiFactory factory, string tenantId, PhotoKind kind)
    {
        var photo = new PhotoEntity { Id = Ulid.New(), TenantId = tenantId, Kind = kind, ContentType = "image/jpeg", Active = true, CreatedAt = DateTime.UtcNow };
        photo.S3Key = StorageKeys.Photo(tenantId, kind, photo.Id, "jpg");
        await factory.Storage.PutAsync(photo.S3Key, [1], "image/jpeg", default);
        await factory.Repository.SaveAsync(photo);
        return photo;
    }

    public static async Task<JobEntity> CompletedJobAsync(this ApiFactory factory, string tenantId, JobKind kind, object result)
    {
        var job = new JobEntity
        {
            Id = Ulid.New(), TenantId = tenantId, Kind = kind, Status = JobStatus.Completed, Result = StylingJson.Serialize(result),
            CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
        };
        await factory.Repository.SaveAsync(job);
        return job;
    }

    public static async Task<int> CreditsAsync(this ApiFactory factory, string tenantId) =>
        (await factory.Services.GetRequiredService<IEntitlementService>().GetAsync(tenantId, default)).Credits.TotalRemaining;

    /// <summary>Repeatable read (the body is buffered), so one response can be asserted on more than once.</summary>
    public static async Task<T> ReadAsync<T>(this HttpResponseMessage response)
    {
        await response.Content.LoadIntoBufferAsync();
        return JsonSerializer.Deserialize<T>(await response.Content.ReadAsStringAsync(), ApiFactory.Json)!;
    }

    public static Task<T?> GetAsync<T>(this HttpClient client, string url) => client.GetFromJsonAsync<T>(url, ApiFactory.Json);

    /// <summary>A real catalog product (+ its brand) written to the global catalog partition; the Api's catalog cache is dropped.</summary>
    public static async Task<string> ProductAsync(this ApiFactory factory, string category = "bag", bool retired = false)
    {
        var id = $"prd-{Guid.NewGuid():N}";
        var now = DateTime.UtcNow;
        await factory.Repository.SaveAsync(new BrandEntity { Id = "marka", Name = "Marka", CreatedAt = now, UpdatedAt = now });
        await factory.Repository.SaveAsync(new CatalogProductEntity
        {
            Id = id, BrandId = "marka", Name = new() { ["tr"] = "Deri çanta", ["en"] = "Leather bag" },
            Category = Enum.Parse<ProductCategory>(category, ignoreCase: true), Colors = ["camel"], PriceMinor = 100_000,
            Images = ["https://cdn.example.com/catalog/bag.webp"], Retired = retired, CreatedAt = now, UpdatedAt = now,
        });
        factory.Services.GetRequiredService<ICatalogService>().InvalidateCache();
        return id;
    }
}

public class WardrobeEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static object Confirm(string draftId, string mutationId, bool reviewed = true, string[]? seasons = null) => new
    {
        items = new[]
        {
            new { draftId, clientMutationId = mutationId, reviewed, name = "Lacivert blazer", category = "outerwear", colorIds = new[] { "navy" }, fabric = "wool", seasons = seasons ?? ["autumn", "winter"], size = "M", brand = "Mango" },
        },
    };

    private async Task<string> UploadedDraftAsync(HttpClient client, bool split = false)
    {
        var uploads = await (await client.PostJsonAsync("v1/tenant/item/upload-url", new { count = 1, contentType = "image/jpeg" })).ReadAsync<ItemUploadsDto>();
        var upload = Assert.Single(uploads.Uploads);
        await factory.Storage.PutAsync(upload.Fields["key"], Tests.Shared.TestImages.JpegWithExif(), "image/jpeg", default);
        var started = await client.PostJsonAsync("v1/tenant/item-draft", new { requestId = Ulid.New(), uploadIds = new[] { upload.UploadId }, splitOutfit = split });
        Assert.Equal(HttpStatusCode.Accepted, started.StatusCode);
        return upload.UploadId;
    }

    private async Task MarkReadyAsync(string tenantId, string draftId, bool needsReview = false)
    {
        var draft = (await factory.Repository.GetAsync<ItemDraftEntity>(ItemDraftEntity.GetPk(tenantId), ItemDraftEntity.GetSk(draftId)))!;
        draft.Status = ItemDraftStatus.Ready;
        draft.Category = ItemCategory.Outerwear;
        draft.NeedsReview = needsReview;
        draft.ProcessedKey = StorageKeys.ItemImage(tenantId, draftId);
        draft.OriginalKey = StorageKeys.ItemOriginal(tenantId, draftId, "jpg");
        await factory.Storage.PutAsync(draft.ProcessedKey, [1], "image/webp", default);
        await factory.Storage.PutAsync(draft.OriginalKey, [2], "image/jpeg", default);
        await factory.Repository.SaveAsync(draft);
    }

    [Fact]
    public async Task UploadDraftConfirm_FullFlow_ItemIsCreatedOnlyOnConfirm_AndOnlyOnce()
    {
        var (client, auth) = await factory.RegisterAsync();
        var draftId = await UploadedDraftAsync(client);

        var queued = Assert.Single(factory.Events.Of<ItemProcessRequestedEvent>(auth.TenantId));
        Assert.Equal(draftId, queued.DraftId);
        Assert.Equal(JobKind.ItemProcess, queued.Kind);
        var pending = (await client.GetAsync<ItemDraftsDto>("v1/tenant/item-draft"))!;
        Assert.Equal(ItemDraftStatus.Uploaded, Assert.Single(pending.Drafts).Status);
        Assert.Equal((1, 0), (pending.Total, pending.Processed));
        Assert.Empty((await client.GetAsync<List<ItemDto>>("v1/tenant/item"))!); // the AI never writes the wardrobe

        var tooEarly = await (await client.PostJsonAsync("v1/tenant/item-draft/confirm", Confirm(draftId, Ulid.New()))).ReadAsync<ItemCreateResultsDto>();
        Assert.Equal("draft_not_ready", tooEarly.Results[0].Code);

        await MarkReadyAsync(auth.TenantId, draftId);
        var mutationId = Ulid.New();
        var confirmed = await (await client.PostJsonAsync("v1/tenant/item-draft/confirm", Confirm(draftId, mutationId))).ReadAsync<ItemCreateResultsDto>();
        var replay = await (await client.PostJsonAsync("v1/tenant/item-draft/confirm", Confirm(draftId, mutationId))).ReadAsync<ItemCreateResultsDto>();

        Assert.Equal(1, confirmed.CreatedCount);
        Assert.Equal(ItemCreateOutcome.Created, confirmed.Results[0].Outcome);
        Assert.Equal(ItemCreateOutcome.AlreadyApplied, replay.Results[0].Outcome);
        var item = Assert.Single((await client.GetAsync<List<ItemDto>>("v1/tenant/item"))!);
        Assert.Equal(mutationId, item.Id);
        Assert.Equal(ItemCategory.Outerwear, item.Category);
        Assert.Equal([Season.Autumn, Season.Winter], item.Seasons);
        Assert.Equal(ItemSource.Photo, item.Source);
        Assert.Equal(ItemListingStatus.None, item.ListingStatus);
        Assert.Equal(0, item.WearCount);
        Assert.True(item.HasOriginalImage);
        Assert.Contains($"tenant/{auth.TenantId}/items/", item.ImageUrl);
        Assert.Empty((await client.GetAsync<ItemDraftsDto>("v1/tenant/item-draft"))!.Drafts);
    }

    [Fact]
    public async Task Confirm_FlaggedDraftNeedsReviewed_AndSeasonIsMandatory()
    {
        var (client, auth) = await factory.RegisterAsync();
        var draftId = await UploadedDraftAsync(client);
        await MarkReadyAsync(auth.TenantId, draftId, needsReview: true);

        var selectAll = await (await client.PostJsonAsync("v1/tenant/item-draft/confirm", Confirm(draftId, Ulid.New(), reviewed: false))).ReadAsync<ItemCreateResultsDto>();
        var noSeason = await (await client.PostJsonAsync("v1/tenant/item-draft/confirm", Confirm(draftId, Ulid.New(), seasons: []))).ReadAsync<ItemCreateResultsDto>();
        var reviewed = await (await client.PostJsonAsync("v1/tenant/item-draft/confirm", Confirm(draftId, Ulid.New()))).ReadAsync<ItemCreateResultsDto>();

        Assert.Equal((ItemCreateOutcome.Rejected, "draft_review_required"), (selectAll.Results[0].Outcome, selectAll.Results[0].Code));
        Assert.Equal("validation_failed", noSeason.Results[0].Code);
        Assert.Contains("season_required", noSeason.Results[0].Errors!);
        Assert.Equal(ItemCreateOutcome.Created, reviewed.Results[0].Outcome);
    }

    [Fact]
    public async Task LegacySplitOutfitFlag_RunsTheSameDetection_OneItemProcessJob()
    {
        var (client, auth) = await factory.RegisterAsync();
        await UploadedDraftAsync(client, split: true);

        var queued = Assert.Single(factory.Events.Of<ItemProcessRequestedEvent>(auth.TenantId));
        Assert.Equal((JobKind.ItemProcess, false), (queued.Kind, queued.Split));
    }

    /// <summary>What the worker leaves after finding <paramref name="count"/> pieces: the photo is a group, each piece a detected draft with its crop.</summary>
    private async Task<List<ItemDraftEntity>> MakeGroupAsync(string tenantId, string draftId, int count)
    {
        var source = (await factory.Repository.GetAsync<ItemDraftEntity>(ItemDraftEntity.GetPk(tenantId), ItemDraftEntity.GetSk(draftId)))!;
        source.Kind = ItemDraftKind.Outfit;
        source.Status = ItemDraftStatus.Ready;
        source.ItemCount = count;
        source.PhotoWidth = 1000;
        source.PhotoHeight = 1500;
        source.OriginalKey = StorageKeys.ItemOriginal(tenantId, draftId, "jpg");
        await factory.Storage.PutAsync(source.OriginalKey, [2], "image/jpeg", default);
        await factory.Repository.SaveAsync(source);
        var pieces = new List<ItemDraftEntity>();
        for (var i = 0; i < count; i++)
        {
            var piece = new ItemDraftEntity
            {
                Id = Ulid.New(), TenantId = tenantId, Kind = ItemDraftKind.Piece, Status = ItemDraftStatus.Detected, ParentDraftId = draftId,
                Index = i + 1, Box = new BoundingBox(0.1 * i, 0.1, 0.1, 0.1), Confidence = i == count - 1 ? 0.5 : 0.9, NeedsReview = i == count - 1,
                Category = i == count - 1 ? ItemCategory.Accessory : ItemCategory.Top, Subcategory = i == count - 1 ? "necklace" : "t-shirt",
                ColorIds = ["white"], Seasons = [Season.Summer], CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
            };
            piece.OriginalKey = StorageKeys.ItemOriginal(tenantId, piece.Id, "jpg");
            await factory.Storage.PutAsync(piece.OriginalKey, [3], "image/jpeg", default);
            await factory.Repository.SaveAsync(piece);
            pieces.Add(piece);
        }
        return pieces;
    }

    private static async Task<int> RecognitionsUsedAsync(HttpClient client) =>
        (await (await client.GetAsync("v1/tenant/entitlement")).JsonAsync()).GetProperty("itemRecognition").GetProperty("used").GetInt32();

    [Fact]
    public async Task DraftGroup_Lifecycle_SelectKeepsTheChosenPieces_DiscardsTheRest_AndUsesNoRecognition()
    {
        var (client, auth) = await factory.RegisterAsync();
        var groupId = await UploadedDraftAsync(client);
        var pieces = await MakeGroupAsync(auth.TenantId, groupId, 3);
        var usedBefore = await RecognitionsUsedAsync(client);

        var listed = (await client.GetAsync<ItemDraftsDto>("v1/tenant/item-draft"))!;
        var group = listed.Drafts.Single(d => d.Id == groupId);
        Assert.Equal((ItemDraftKind.Outfit, groupId, 3, 1000, 1500), (group.Kind, group.GroupId, group.ItemCount!.Value, group.PhotoWidth!.Value, group.PhotoHeight!.Value));
        var listedPieces = listed.Drafts.Where(d => d.Kind == ItemDraftKind.Piece).OrderBy(d => d.Index).ToList();
        Assert.Equal(3, listedPieces.Count);
        Assert.All(listedPieces, p => Assert.Equal((ItemDraftStatus.Detected, groupId), (p.Status, p.GroupId)));
        Assert.All(listedPieces, p => Assert.NotNull(p.ImageUrl)); // the plain crop
        Assert.Equal(new BoundingBox(0.1, 0.1, 0.1, 0.1), listedPieces[1].Box);
        Assert.Equal(("necklace", 0.5, true), (listedPieces[2].Subcategory, listedPieces[2].Confidence!.Value, listedPieces[2].NeedsReview));

        // A detected piece and the group photo itself are never confirmed directly.
        var early = await (await client.PostJsonAsync("v1/tenant/item-draft/confirm", Confirm(pieces[0].Id, Ulid.New()))).ReadAsync<ItemCreateResultsDto>();
        Assert.Equal("draft_not_ready", early.Results[0].Code);

        var select = await client.PostJsonAsync($"v1/tenant/item-draft/{groupId}/select", new
        {
            draftIds = new[] { pieces[0].Id, pieces[2].Id },
            edits = new[] { new { draftId = pieces[2].Id, name = "Altın kolye", category = "accessory", subcategory = "necklace", colorIds = new[] { "beige" }, fabric = (string?)null, seasons = new[] { "spring", "summer", "autumn", "winter" } } },
        });
        var body = await select.ReadAsync<StartDraftsDto>();
        Assert.Equal(HttpStatusCode.Accepted, select.StatusCode);
        Assert.Equal([pieces[0].Id, pieces[2].Id], body.Drafts.Select(d => d.Id));
        Assert.All(body.Drafts, d => Assert.Equal((ItemDraftStatus.Processing, true), (d.Status, d.Selected)));
        Assert.All(body.Jobs, j => Assert.Equal(JobKind.ItemClean, j.Kind));
        Assert.Equal(2, body.Jobs.Count);
        var necklace = body.Drafts[1];
        Assert.Equal(("Altın kolye", false, 4), (necklace.Name, necklace.NeedsReview, necklace.Seasons.Count)); // edited = reviewed

        var cleanEvents = factory.Events.Of<ItemProcessRequestedEvent>(auth.TenantId).Where(e => e.Clean).ToList();
        Assert.Equal(new[] { pieces[0].Id, pieces[2].Id }.Order(StringComparer.Ordinal), cleanEvents.Select(e => e.DraftId).Order(StringComparer.Ordinal));
        Assert.All(cleanEvents, e => Assert.Equal(JobKind.ItemClean, e.Kind));
        // The dropped piece is gone with its crop: it never costs an image-model call.
        Assert.Null(await factory.Repository.GetAsync<ItemDraftEntity>(ItemDraftEntity.GetPk(auth.TenantId), ItemDraftEntity.GetSk(pieces[1].Id)));
        Assert.False(factory.Storage.Objects.ContainsKey(pieces[1].OriginalKey!));
        // One recognition for the photo, none for the pieces.
        Assert.Equal(usedBefore, await RecognitionsUsedAsync(client));

        // Replay: nothing new is queued, nothing selected is discarded.
        var replay = await (await client.PostJsonAsync($"v1/tenant/item-draft/{groupId}/select", new { draftIds = new[] { pieces[0].Id, pieces[2].Id } })).ReadAsync<StartDraftsDto>();
        Assert.Equal((2, 0), (replay.Drafts.Count, replay.Jobs.Count));

        // The group photo leaves the list once no piece waits for a choice; its selected pieces stay.
        var after = (await client.GetAsync<ItemDraftsDto>("v1/tenant/item-draft"))!;
        Assert.DoesNotContain(after.Drafts, d => d.Id == groupId);
        Assert.Equal(2, after.Drafts.Count(d => d.Kind == ItemDraftKind.Piece));
    }

    [Fact]
    public async Task DraftGroup_SelectErrors_AndDeletingTheGroupTakesItsWaitingPieces()
    {
        var (client, auth) = await factory.RegisterAsync();
        var groupId = await UploadedDraftAsync(client);
        var single = await UploadedDraftAsync(client);
        var notYet = await client.PostJsonAsync($"v1/tenant/item-draft/{groupId}/select", new { draftIds = Array.Empty<string>() });
        var pieces = await MakeGroupAsync(auth.TenantId, groupId, 2);

        var foreign = await client.PostJsonAsync($"v1/tenant/item-draft/{groupId}/select", new { draftIds = new[] { single } });
        var notGroup = await client.PostJsonAsync($"v1/tenant/item-draft/{single}/select", new { draftIds = Array.Empty<string>() });
        var unknown = await client.PostJsonAsync($"v1/tenant/item-draft/{Ulid.New()}/select", new { draftIds = Array.Empty<string>() });
        var invalid = await client.PostJsonAsync($"v1/tenant/item-draft/{groupId}/select", new { draftIds = new[] { "nope" } });

        Assert.Equal((HttpStatusCode.Conflict, "draft_not_group"), (notYet.StatusCode, await notYet.CodeAsync()));
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "draft_not_in_group"), (foreign.StatusCode, await foreign.CodeAsync()));
        Assert.Equal((HttpStatusCode.Conflict, "draft_not_group"), (notGroup.StatusCode, await notGroup.CodeAsync()));
        Assert.Equal((HttpStatusCode.NotFound, "draft_not_found"), (unknown.StatusCode, await unknown.CodeAsync()));
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"v1/tenant/item-draft/{groupId}")).StatusCode);
        var left = await factory.Repository.GetAllAsync<ItemDraftEntity>(ItemDraftEntity.GetPk(auth.TenantId));
        Assert.Equal([single], left.Select(d => d.Id));
        Assert.All(pieces, p => Assert.False(factory.Storage.Objects.ContainsKey(p.OriginalKey!)));
    }

    [Fact]
    public async Task DraftGroup_SelectNone_DiscardsEveryPiece_AndRetryOfAFailedCleanupQueuesItAgain()
    {
        var (client, auth) = await factory.RegisterAsync();
        var groupId = await UploadedDraftAsync(client);
        var pieces = await MakeGroupAsync(auth.TenantId, groupId, 2);
        await client.PostJsonAsync($"v1/tenant/item-draft/{groupId}/select", new { draftIds = new[] { pieces[0].Id } });
        var kept = (await factory.Repository.GetAsync<ItemDraftEntity>(ItemDraftEntity.GetPk(auth.TenantId), ItemDraftEntity.GetSk(pieces[0].Id)))!;
        kept.Status = ItemDraftStatus.Failed;
        kept.Failure = JobFailure.ProviderError;
        await factory.Repository.SaveAsync(kept);
        var usedBefore = await RecognitionsUsedAsync(client);

        var retry = await client.PostAsync($"v1/tenant/item-draft/{pieces[0].Id}/retry", null);
        var body = await retry.ReadAsync<StartDraftsDto>();

        Assert.Equal(HttpStatusCode.Accepted, retry.StatusCode);
        Assert.Equal(JobKind.ItemClean, Assert.Single(body.Jobs).Kind);
        Assert.Equal(usedBefore, await RecognitionsUsedAsync(client));
        Assert.Null(await factory.Repository.GetAsync<ItemDraftEntity>(ItemDraftEntity.GetPk(auth.TenantId), ItemDraftEntity.GetSk(pieces[1].Id)));

        // A failed cleanup can also be confirmed by hand: its crop is the photo.
        kept = (await factory.Repository.GetAsync<ItemDraftEntity>(ItemDraftEntity.GetPk(auth.TenantId), ItemDraftEntity.GetSk(pieces[0].Id)))!;
        kept.Status = ItemDraftStatus.Failed;
        await factory.Repository.SaveAsync(kept);
        var confirmed = await (await client.PostJsonAsync("v1/tenant/item-draft/confirm", Confirm(pieces[0].Id, Ulid.New()))).ReadAsync<ItemCreateResultsDto>();
        Assert.Equal(ItemCreateOutcome.Created, confirmed.Results[0].Outcome);
        Assert.True(confirmed.Results[0].Item!.UseOriginalImage);
    }

    [Fact]
    public async Task Drafts_Validation_BulkLimit_UnknownUpload_OtherTenantsUpload()
    {
        var (alice, _) = await factory.RegisterAsync();
        var (bob, _) = await factory.RegisterAsync();
        var aliceUpload = (await (await alice.PostJsonAsync("v1/tenant/item/upload-url", new { count = 30, contentType = "image/jpeg" })).ReadAsync<ItemUploadsDto>()).Uploads;
        await factory.Storage.PutAsync(aliceUpload[0].Fields["key"], [1], "image/jpeg", default);

        var tooMany = await alice.PostJsonAsync("v1/tenant/item/upload-url", new { count = 31, contentType = "image/jpeg" });
        var gif = await alice.PostJsonAsync("v1/tenant/item/upload-url", new { count = 1, contentType = "image/gif" });
        var unknown = await alice.PostJsonAsync("v1/tenant/item-draft", new { requestId = Ulid.New(), uploadIds = new[] { Ulid.New() } });
        var notUploaded = await alice.PostJsonAsync("v1/tenant/item-draft", new { requestId = Ulid.New(), uploadIds = new[] { aliceUpload[1].UploadId } });
        var stolen = await bob.PostJsonAsync("v1/tenant/item-draft", new { requestId = Ulid.New(), uploadIds = new[] { aliceUpload[0].UploadId } });
        var tooManyConfirm = await alice.PostJsonAsync("v1/tenant/item-draft/confirm", new { items = Enumerable.Range(0, 31).Select(_ => new { draftId = Ulid.New(), clientMutationId = Ulid.New(), reviewed = true }) });

        Assert.Equal(30, aliceUpload.Count);
        Assert.Equal(HttpStatusCode.BadRequest, tooMany.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, gif.StatusCode);
        Assert.Equal((HttpStatusCode.NotFound, "upload_not_found"), (unknown.StatusCode, await unknown.CodeAsync()));
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "upload_missing"), (notUploaded.StatusCode, await notUploaded.CodeAsync()));
        Assert.Equal(HttpStatusCode.NotFound, stolen.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, tooManyConfirm.StatusCode);
    }

    [Fact]
    public async Task Library_NamesFollowTheProfileLanguage_AndPiecesAreAddedWithoutAPhoto()
    {
        var (client, _) = await factory.RegisterAsync();

        var turkish = (await client.GetAsync<List<LibraryItemDto>>("v1/tenant/library/item"))!;
        await client.PutJsonAsync("v1/tenant/profile", new { displayName = "Ayşe", language = "en", baseVersion = 1 });
        var english = (await client.GetAsync<List<LibraryItemDto>>("v1/tenant/library/item"))!;

        Assert.Equal("Beyaz tişört", turkish.Single(i => i.Id == "lib-white-tshirt").Name);
        Assert.Equal("White T-shirt", english.Single(i => i.Id == "lib-white-tshirt").Name);

        var mutationId = Ulid.New();
        var body = new { items = new object[] { new { clientMutationId = mutationId, libraryItemId = "lib-white-tshirt", size = "S" }, new { clientMutationId = Ulid.New(), libraryItemId = "lib-nope" } } };
        var added = await (await client.PostJsonAsync("v1/tenant/item/from-library", body)).ReadAsync<ItemCreateResultsDto>();
        await client.PostJsonAsync("v1/tenant/item/from-library", body);

        Assert.Equal(1, added.CreatedCount);
        Assert.Equal("library_item_not_found", added.Results[1].Code);
        var item = Assert.Single((await client.GetAsync<List<ItemDto>>("v1/tenant/item"))!);
        Assert.Equal((ItemSource.Library, "lib-white-tshirt", "White T-shirt", "S"), (item.Source, item.LibraryItemId, item.Name, item.Size));
        Assert.Equal(ItemCategory.Top, item.Category);
    }

    [Fact]
    public async Task FromProduct_CreatesAPurchaseItem_Idempotent_UnknownOrRetired404()
    {
        var (client, _) = await factory.RegisterAsync();
        var productId = await factory.ProductAsync();
        var retiredId = await factory.ProductAsync(retired: true);
        var mutationId = Ulid.New();

        var created = await client.PostJsonAsync("v1/tenant/item/from-product", new { clientMutationId = mutationId, productId, size = "M" });
        var replay = await client.PostJsonAsync("v1/tenant/item/from-product", new { clientMutationId = mutationId, productId, size = "M" });
        var unknown = await client.PostJsonAsync("v1/tenant/item/from-product", new { clientMutationId = Ulid.New(), productId = "prd-nope" });
        var retired = await client.PostJsonAsync("v1/tenant/item/from-product", new { clientMutationId = Ulid.New(), productId = retiredId });

        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
        Assert.Equal((HttpStatusCode.NotFound, "product_not_found"), (unknown.StatusCode, await unknown.CodeAsync()));
        Assert.Equal(HttpStatusCode.NotFound, retired.StatusCode);
        var item = Assert.Single((await client.GetAsync<List<ItemDto>>("v1/tenant/item"))!);
        Assert.Equal((ItemSource.Purchase, productId, ItemCategory.Bag, "Marka"), (item.Source, item.ProductId, item.Category, item.Brand));
    }

    [Fact]
    public async Task Item_GetPutDelete_VersionConflict_Validation_TenantIsolation()
    {
        var (alice, auth) = await factory.RegisterAsync();
        var (bob, _) = await factory.RegisterAsync();
        var item = await factory.ItemAsync(auth.TenantId, ItemCategory.Top);
        var look = await factory.LookAsync(auth.TenantId, (OutfitSlot.Top, item.Id), (OutfitSlot.Shoes, (await factory.ItemAsync(auth.TenantId, ItemCategory.Shoes)).Id));
        object Update(long baseVersion, string[]? seasons = null) => new { name = "Krem kazak", category = "top", colorIds = new[] { "cream" }, fabric = "knit", seasons = seasons ?? ["winter"], baseVersion };

        var detail = (await alice.GetAsync<ItemDetailDto>($"v1/tenant/item/{item.Id}"))!;
        var ok = await alice.PutJsonAsync($"v1/tenant/item/{item.Id}", Update(1));
        var stale = await alice.PutJsonAsync($"v1/tenant/item/{item.Id}", Update(1));
        var noSeason = await alice.PutJsonAsync($"v1/tenant/item/{item.Id}", Update(2, []));
        var foreignGet = await bob.GetAsync($"v1/tenant/item/{item.Id}");
        var foreignPut = await bob.PutJsonAsync($"v1/tenant/item/{item.Id}", Update(2));
        var foreignDelete = await bob.DeleteAsync($"v1/tenant/item/{item.Id}");

        Assert.Equal(look.Id, Assert.Single(detail.Looks).Id);
        Assert.Equal(("Krem kazak", 2L), ((await ok.ReadAsync<ItemDto>()).Name, (await ok.ReadAsync<ItemDto>()).Version));
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        Assert.Equal(2, (await stale.ReadAsync<ItemDto>()).Version);
        Assert.Equal(HttpStatusCode.BadRequest, noSeason.StatusCode);
        Assert.Contains("season_required", (await noSeason.JsonAsync()).GetProperty("errors").GetProperty("seasons").EnumerateArray().Select(e => e.GetString()));
        Assert.Equal(HttpStatusCode.NotFound, foreignGet.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, foreignPut.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, foreignDelete.StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await alice.DeleteAsync($"v1/tenant/item/{item.Id}")).StatusCode);
        var after = (await alice.GetAsync<LookDto>($"v1/tenant/look/{look.Id}"))!;
        Assert.True(after.Slots.Single(s => s.Slot == OutfitSlot.Top).Unavailable); // "silinmiş parça"
        Assert.True(after.HasMissingPieces);
    }

    [Fact]
    public async Task Reference_ResolvesNamesForTheRequestedLanguage_WithTurkishFallback()
    {
        var (client, _) = await factory.RegisterAsync();

        var en = (await client.GetAsync<WardrobeReferenceDto>("v1/tenant/reference/wardrobe?language=en"))!;
        var fallback = (await client.GetAsync<WardrobeReferenceDto>("v1/tenant/reference/wardrobe?language=de"))!;

        Assert.Equal("Navy", en.Colors.Single(c => c.Id == "navy").Name);
        Assert.Equal("Warm Autumn", en.SeasonTypes.Single(s => s.Id == "warm-autumn").Name);
        Assert.Equal(("Lacivert", "tr"), (fallback.Colors.Single(c => c.Id == "navy").Name, fallback.Language));
        Assert.Equal(9, en.Categories.Count);
        Assert.Equal((2, 30), (en.LookMinPieces, en.MaxBulkItems));
        Assert.Equal([ItemCategory.Bag, ItemCategory.Accessory], en.Slots.Single(s => s.Slot == OutfitSlot.BagAccessory).Categories);
        Assert.Equal("Other", en.Colors.Single(c => c.Id == "other").Name);
    }

    [Fact]
    public async Task ManualPiece_WithoutAPhoto_IsCreatedOnce_KeepsTheLossyFields_AndIsValidated()
    {
        var (client, _) = await factory.RegisterAsync();
        var mutationId = Ulid.New();
        object Body(string id, string[]? seasons = null, string[]? colors = null, string? hex = "#a1b2c3", string? subcategory = "blazer") => new
        {
            clientMutationId = id, name = "Ekose ceket", category = "outerwear", subcategory, colorIds = colors ?? ["other", "navy"], colorHex = hex,
            fabricText = "Yün karışımlı tüvit", seasons = seasons ?? ["autumn"], size = "38", brand = "Vintage",
        };

        var created = await client.PostJsonAsync("v1/tenant/item", Body(mutationId));
        var replay = await client.PostJsonAsync("v1/tenant/item", Body(mutationId));
        var noSeason = await client.PostJsonAsync("v1/tenant/item", Body(Ulid.New(), seasons: []));
        var noColor = await client.PostJsonAsync("v1/tenant/item", Body(Ulid.New(), colors: []));
        var badHex = await client.PostJsonAsync("v1/tenant/item", Body(Ulid.New(), hex: "blue"));
        var badSubcategory = await client.PostJsonAsync("v1/tenant/item", Body(Ulid.New(), subcategory: "Blazer Ceket"));
        var noCategory = await client.PostJsonAsync("v1/tenant/item", new { clientMutationId = Ulid.New(), colorIds = new[] { "black" }, seasons = new[] { "winter" } });

        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
        Assert.Equal("alreadyApplied", (await replay.JsonAsync()).GetProperty("outcome").GetString());
        var item = Assert.Single((await client.GetAsync<List<ItemDto>>("v1/tenant/item"))!);
        Assert.Equal((mutationId, ItemSource.Manual, ItemCategory.Outerwear), (item.Id, item.Source, item.Category));
        Assert.Equal(("blazer", "Yün karışımlı tüvit", "#A1B2C3"), (item.Subcategory, item.FabricText, item.ColorHex));
        Assert.Equal(["other", "navy"], item.ColorIds);
        Assert.Null(item.ImageUrl);
        Assert.False(item.HasOriginalImage);
        Assert.Contains("season_required", (await noSeason.JsonAsync()).GetProperty("errors").GetProperty("seasons").EnumerateArray().Select(e => e.GetString()));
        Assert.Contains("color_required", (await noColor.JsonAsync()).GetProperty("errors").GetProperty("colorIds").EnumerateArray().Select(e => e.GetString()));
        Assert.Contains("color_hex_invalid", (await badHex.JsonAsync()).GetProperty("errors").GetProperty("colorHex").EnumerateArray().Select(e => e.GetString()));
        Assert.Contains("subcategory_invalid", (await badSubcategory.JsonAsync()).GetProperty("errors").GetProperty("subcategory").EnumerateArray().Select(e => e.GetString()));
        Assert.Equal(HttpStatusCode.BadRequest, noCategory.StatusCode);
    }

    [Fact]
    public async Task Put_KeepsSubcategoryAndFreeTextFabric_HexOnlyWithOther()
    {
        var (client, auth) = await factory.RegisterAsync();
        var item = await factory.ItemAsync(auth.TenantId, ItemCategory.Top);

        var withOther = await client.PutJsonAsync($"v1/tenant/item/{item.Id}", new
        {
            category = "top", subcategory = "crop-top", colorIds = new[] { "other" }, colorHex = "#112233", fabric = (string?)null, fabricText = "Modal",
            seasons = new[] { "summer" }, baseVersion = 1,
        });
        var withoutOther = await client.PutJsonAsync($"v1/tenant/item/{item.Id}", new
        {
            category = "top", colorIds = new[] { "white" }, colorHex = "#112233", seasons = new[] { "summer" }, baseVersion = 2,
        });

        var first = await withOther.ReadAsync<ItemDto>();
        var second = await withoutOther.ReadAsync<ItemDto>();
        Assert.Equal(("crop-top", "Modal", "#112233"), (first.Subcategory, first.FabricText, first.ColorHex));
        Assert.Equal(((string?)null, (string?)null, (string?)null), (second.Subcategory, second.FabricText, second.ColorHex)); // PUT replaces; hex needs "other"
    }
}

public class LookAndPlanEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static object LookBody(string id, params object[] slots) => new { id, name = "Ofis", occasion = "office", slots, favorite = true, source = "builder" };
    private static object Slot(string slot, string? itemId = null, string? productId = null) => new { slot, itemId, productId };

    [Fact]
    public async Task Look_CreateReplayGetUpdateDelete()
    {
        var (client, auth) = await factory.RegisterAsync();
        var top = await factory.ItemAsync(auth.TenantId, ItemCategory.Top);
        var bottom = await factory.ItemAsync(auth.TenantId, ItemCategory.Bottom);
        var productId = await factory.ProductAsync("bag");
        var id = Ulid.New();
        var body = LookBody(id, Slot("top", top.Id), Slot("bottom", bottom.Id), Slot("bagAccessory", productId: productId));

        var created = await client.PostJsonAsync("v1/tenant/look", body);
        var replay = await client.PostJsonAsync("v1/tenant/look", body);
        var look = await created.ReadAsync<LookDto>();

        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
        Assert.Equal((3, LookSource.Builder, Occasion.Office, true), (look.PieceCount, look.Source, look.Occasion!.Value, look.Favorite));
        Assert.True(look.HasMissingPieces); // a catalog product slot = a piece the user does not own
        Assert.True(look.Slots.Single(s => s.Slot == OutfitSlot.BagAccessory).Missing);
        Assert.Single((await client.GetAsync<List<LookDto>>("v1/tenant/look"))!);

        var update = new { name = "Ofis 2", occasion = "dinner", slots = new[] { Slot("top", top.Id), Slot("bottom", bottom.Id) }, favorite = false, baseVersion = 1 };
        var updated = await client.PutJsonAsync($"v1/tenant/look/{id}", update);
        var stale = await client.PutJsonAsync($"v1/tenant/look/{id}", update);

        Assert.Equal((2L, false), ((await updated.ReadAsync<LookDto>()).Version, (await updated.ReadAsync<LookDto>()).HasMissingPieces));
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"v1/tenant/look/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"v1/tenant/look/{id}")).StatusCode);
    }

    [Fact]
    public async Task Look_SlotRules_AreEnforced()
    {
        var (alice, auth) = await factory.RegisterAsync();
        var (_, bobAuth) = await factory.RegisterAsync();
        var top = await factory.ItemAsync(auth.TenantId, ItemCategory.Top);
        var dress = await factory.ItemAsync(auth.TenantId, ItemCategory.Dress);
        var bottom = await factory.ItemAsync(auth.TenantId, ItemCategory.Bottom);
        var shoes = await factory.ItemAsync(auth.TenantId, ItemCategory.Shoes);
        var bobsTop = await factory.ItemAsync(bobAuth.TenantId, ItemCategory.Top);

        async Task<(HttpStatusCode, string?)> Post(params object[] slots)
        {
            var response = await alice.PostJsonAsync("v1/tenant/look", LookBody(Ulid.New(), slots));
            return (response.StatusCode, response.StatusCode == HttpStatusCode.Created ? null : await response.CodeAsync());
        }

        Assert.Equal((HttpStatusCode.UnprocessableEntity, "look_min_pieces"), await Post(Slot("top", top.Id)));
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "slot_item_not_found"), await Post(Slot("top", bobsTop.Id), Slot("bottom", bottom.Id))); // another tenant's piece
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "slot_category_mismatch"), await Post(Slot("top", shoes.Id), Slot("bottom", bottom.Id)));
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "dress_closes_bottom"), await Post(Slot("top", dress.Id), Slot("bottom", bottom.Id)));
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "slot_duplicate"), await Post(Slot("top", top.Id), Slot("top", dress.Id)));
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "slot_source_invalid"), await Post(Slot("top", top.Id, "prd"), Slot("bottom", bottom.Id)));
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "slot_product_not_found"), await Post(Slot("top", top.Id), Slot("bagAccessory", productId: "prd-nope")));
        Assert.Equal((HttpStatusCode.Created, null), await Post(Slot("top", dress.Id), Slot("shoes", shoes.Id)));
        Assert.Equal(HttpStatusCode.BadRequest, (await alice.PostJsonAsync("v1/tenant/look", LookBody("not-a-ulid", Slot("top", top.Id)))).StatusCode);
    }

    [Fact]
    public async Task PlanDay_And_Today_Snapshot()
    {
        var (client, auth) = await factory.RegisterAsync();
        var top = await factory.ItemAsync(auth.TenantId, ItemCategory.Top);
        var productId = await factory.ProductAsync("shoes");
        var lookId = Ulid.New();
        await client.PostJsonAsync("v1/tenant/look", LookBody(lookId, Slot("top", top.Id), Slot("shoes", productId: productId)));

        var empty = (await client.GetAsync<TodayDto>("v1/tenant/today?date=2026-11-18"))!;
        var created = await client.PutJsonAsync("v1/tenant/plan-day/2026-11-18", new { occasion = "office", lookId, baseVersion = 0 });
        var stale = await client.PutJsonAsync("v1/tenant/plan-day/2026-11-18", new { occasion = "dinner", lookId, baseVersion = 0 });
        var unknownLook = await client.PutJsonAsync("v1/tenant/plan-day/2026-11-19", new { occasion = "office", lookId = Ulid.New(), baseVersion = 0 });
        await client.PutJsonAsync("v1/tenant/plan-day/2026-11-20", new { occasion = "weekend", baseVersion = 0 });
        var today = (await client.GetAsync<TodayDto>("v1/tenant/today?date=2026-11-18"))!;
        var range = (await client.GetAsync<List<PlanDayDto>>("v1/tenant/plan-day?from=2026-11-16&to=2026-11-22"))!;

        Assert.Null(empty.Plan);
        Assert.Null(empty.Look);
        Assert.Equal(HttpStatusCode.OK, created.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "look_not_found"), (unknownLook.StatusCode, await unknownLook.CodeAsync()));

        Assert.Equal(("2026-11-18", Season.Autumn, Occasion.Office), (today.Date, today.Season, today.Occasion!.Value));
        Assert.Null(today.Weather); // null weather service until a provider is plugged in
        Assert.Equal(lookId, today.Look!.Id);
        Assert.True(today.HasMissingPieces);
        Assert.Equal(productId, Assert.Single(today.MissingPieces).ProductId);
        Assert.False(today.Worn);
        Assert.Equal(7, today.Week.Count);
        Assert.Equal(["2026-11-18", "2026-11-20"], today.Week.Where(d => d.HasPlan).Select(d => d.Date));
        Assert.Equal(["2026-11-18", "2026-11-20"], range.Select(d => d.Date));

        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("v1/tenant/today?date=18.11.2026")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("v1/tenant/plan-day?from=2026-11-22&to=2026-11-16")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PutJsonAsync("v1/tenant/plan-day/tomorrow", new { baseVersion = 0 })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync("v1/tenant/plan-day/2026-11-18")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.DeleteAsync("v1/tenant/plan-day/2026-11-18")).StatusCode);
    }

    [Fact]
    public async Task WearLog_IncrementsOncePerDay_IsIdempotent_AndDeleteGivesTheCountBack()
    {
        var (client, auth) = await factory.RegisterAsync();
        var top = await factory.ItemAsync(auth.TenantId, ItemCategory.Top);
        var shoes = await factory.ItemAsync(auth.TenantId, ItemCategory.Shoes);
        var look = await factory.LookAsync(auth.TenantId, (OutfitSlot.Top, top.Id), (OutfitSlot.Shoes, shoes.Id));
        var today = DateTime.UtcNow.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
        var month = today[..7];
        var first = new { clientMutationId = Ulid.New(), date = today, occurredAt = DateTime.UtcNow, lookId = look.Id };

        var logged = await client.PostJsonAsync("v1/tenant/wear-log", first);
        var replay = await client.PostJsonAsync("v1/tenant/wear-log", first);
        var sameDayAgain = await client.PostJsonAsync("v1/tenant/wear-log", new { clientMutationId = Ulid.New(), date = today, occurredAt = DateTime.UtcNow, itemIds = new[] { top.Id } });

        Assert.Equal(HttpStatusCode.OK, logged.StatusCode);
        Assert.Equal((await logged.ReadAsync<WearLogResultDto>()).Log.Id, (await replay.ReadAsync<WearLogResultDto>()).Log.Id);
        Assert.Equal(HttpStatusCode.OK, sameDayAgain.StatusCode);
        var items = (await client.GetAsync<List<ItemDto>>("v1/tenant/item"))!;
        Assert.All(items, i => Assert.Equal((1, today), (i.WearCount, i.LastWornAt)));

        var summary = (await client.GetAsync<WearSummaryDto>($"v1/tenant/wear-log/summary?month={month}"))!;
        var logs = (await client.GetAsync<List<WearLogDto>>($"v1/tenant/wear-log?month={month}"))!;
        Assert.Equal((1, 2, 2), (summary.LoggedDays, summary.TotalWears, summary.MostWorn.Count));
        Assert.NotNull(summary.MostWorn[0].Item);
        Assert.Equal(2, logs.Count);
        Assert.True((await client.GetAsync<TodayDto>($"v1/tenant/today?date={today}"))!.Worn);

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"v1/tenant/wear-log/{today}/{first.clientMutationId}")).StatusCode);
        var afterOne = (await client.GetAsync<List<ItemDto>>("v1/tenant/item"))!;
        Assert.Equal(1, afterOne.Single(i => i.Id == top.Id).WearCount);   // still worn that day through the other log
        Assert.Equal(0, afterOne.Single(i => i.Id == shoes.Id).WearCount);
        Assert.Null(afterOne.Single(i => i.Id == shoes.Id).LastWornAt);
        Assert.Equal(HttpStatusCode.NotFound, (await client.DeleteAsync($"v1/tenant/wear-log/{today}/{first.clientMutationId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostJsonAsync("v1/tenant/wear-log", first)).StatusCode); // a deleted record never comes back
    }

    [Fact]
    public async Task WearLog_Validation_And_TenantIsolation()
    {
        var (alice, auth) = await factory.RegisterAsync();
        var (_, bobAuth) = await factory.RegisterAsync();
        var bobsItem = await factory.ItemAsync(bobAuth.TenantId, ItemCategory.Top);
        var mine = await factory.ItemAsync(auth.TenantId, ItemCategory.Top);
        object Body(object? itemIds = null, string? lookId = null, DateTime? at = null) =>
            new { clientMutationId = Ulid.New(), date = "2026-11-18", occurredAt = at ?? DateTime.UtcNow, itemIds, lookId };

        var foreign = await alice.PostJsonAsync("v1/tenant/wear-log", Body(new[] { bobsItem.Id }));
        var both = await alice.PostJsonAsync("v1/tenant/wear-log", Body(new[] { mine.Id }, Ulid.New()));
        var neither = await alice.PostJsonAsync("v1/tenant/wear-log", Body());
        var future = await alice.PostJsonAsync("v1/tenant/wear-log", Body(new[] { mine.Id }, at: DateTime.UtcNow.AddHours(2)));
        var unknownLook = await alice.PostJsonAsync("v1/tenant/wear-log", Body(lookId: Ulid.New()));

        Assert.Equal((HttpStatusCode.UnprocessableEntity, "item_not_found"), (foreign.StatusCode, await foreign.CodeAsync()));
        Assert.Equal(HttpStatusCode.BadRequest, both.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, neither.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, future.StatusCode);
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "look_not_found"), (unknownLook.StatusCode, await unknownLook.CodeAsync()));
        Assert.Equal(0, (await factory.Repository.GetAsync<ItemEntity>(bobsItem.Pk, bobsItem.Sk))!.WearCount);
    }
}

public class StylistAndTripEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private async Task<(HttpClient Client, string TenantId, ItemEntity Top, ItemEntity Bottom, ItemEntity Shoes)> ArrangeAsync(bool premium = true)
    {
        var (client, auth) = await factory.RegisterAsync();
        if (premium)
            await factory.PremiumAsync(auth.TenantId);
        return (client, auth.TenantId,
            await factory.ItemAsync(auth.TenantId, ItemCategory.Top), await factory.ItemAsync(auth.TenantId, ItemCategory.Bottom), await factory.ItemAsync(auth.TenantId, ItemCategory.Shoes));
    }

    private static OutfitResult Outfits(ItemEntity top, ItemEntity bottom, ItemEntity shoes, string? missingProductId = null) => new("2026-11-18", Occasion.Office, true, null,
    [
        new SuggestedOutfit(0, "Sakin Ofis", "Kısa not.", "model",
            [new SlotRef(OutfitSlot.Top, top.Id), new SlotRef(OutfitSlot.Bottom, bottom.Id), new SlotRef(OutfitSlot.Shoes, shoes.Id)],
            missingProductId is null ? [] : [new MissingPiece(OutfitSlot.BagAccessory, ItemCategory.Bag, MissingPieceReason.Suggested, missingProductId)]),
    ], "tr");

    [Fact]
    public async Task StartOutfit_NonMemberGetsThePaywallCode_MemberGetsAJob_ReplayIsTheSameJob()
    {
        var (free, freeTenant, _, _, _) = await ArrangeAsync(premium: false);
        var (member, tenant, top, _, _) = await ArrangeAsync();
        var body = new { requestId = Ulid.New(), date = "2026-11-18", occasion = "dinner", freeText = "akşam iş yemeği, yağmurlu", onlyMyWardrobe = false, pinnedItemId = top.Id };

        var denied = await free.PostJsonAsync("v1/tenant/stylist/outfit", new { requestId = Ulid.New(), date = "2026-11-18" });
        var accepted = await member.PostJsonAsync("v1/tenant/stylist/outfit", body);
        var replay = await member.PostJsonAsync("v1/tenant/stylist/outfit", body);
        var asWeek = await member.PostJsonAsync("v1/tenant/stylist/week", new { requestId = body.requestId, weekStart = "2026-11-16" });
        var unknownPin = await member.PostJsonAsync("v1/tenant/stylist/outfit", new { requestId = Ulid.New(), date = "2026-11-18", pinnedItemId = Ulid.New() });
        var longText = await member.PostJsonAsync("v1/tenant/stylist/outfit", new { requestId = Ulid.New(), date = "2026-11-18", freeText = new string('a', 201) });

        Assert.Equal((HttpStatusCode.Forbidden, "premium_required"), (denied.StatusCode, await denied.CodeAsync()));
        Assert.Empty(factory.Events.Of<StylistRequestedEvent>(freeTenant));
        Assert.Equal(HttpStatusCode.Accepted, accepted.StatusCode);
        Assert.Equal(HttpStatusCode.Accepted, replay.StatusCode);
        Assert.Equal((HttpStatusCode.Conflict, "request_id_reused"), (asWeek.StatusCode, await asWeek.CodeAsync()));
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "item_not_found"), (unknownPin.StatusCode, await unknownPin.CodeAsync()));
        Assert.Equal(HttpStatusCode.BadRequest, longText.StatusCode);
        Assert.Equal(JobKind.StylistOutfit, Assert.Single(factory.Events.Of<StylistRequestedEvent>(tenant)).Kind);

        var job = (await factory.Repository.GetAsync<JobEntity>(JobEntity.GetPk(tenant), JobEntity.GetSk(body.requestId)))!;
        var input = StylingJson.TryDeserialize<OutfitJobInput>(job.Input)!;
        Assert.Equal((Occasion.Dinner, false, top.Id, "tr"), (input.Occasion!.Value, input.OnlyMyWardrobe, input.PinnedItemId, input.Language));
        Assert.Null(job.CreditIdempotencyKey);                 // the text stylist never costs a credit
        Assert.Equal(30, await factory.CreditsAsync(tenant));
    }

    [Fact]
    public async Task StartOutfit_UsesTheProfileLanguageForTheGeneratedText()
    {
        var (client, tenant, _, _, _) = await ArrangeAsync();
        await client.PutJsonAsync("v1/tenant/profile", new { displayName = "Ayşe", language = "en", baseVersion = 1 });
        var requestId = Ulid.New();

        await client.PostJsonAsync("v1/tenant/stylist/outfit", new { requestId, date = "2026-11-18" });

        var job = (await factory.Repository.GetAsync<JobEntity>(JobEntity.GetPk(tenant), JobEntity.GetSk(requestId)))!;
        Assert.Equal("en", StylingJson.TryDeserialize<OutfitJobInput>(job.Input)!.Language);
    }

    [Fact]
    public async Task AcceptSuggestion_WritesLookAndPlanDay_OnlyOnUserAction_Idempotent()
    {
        var (client, tenant, top, bottom, shoes) = await ArrangeAsync();
        var productId = await factory.ProductAsync("bag");
        var job = await factory.CompletedJobAsync(tenant, JobKind.StylistOutfit, Outfits(top, bottom, shoes, productId));
        Assert.Empty((await client.GetAsync<List<LookDto>>("v1/tenant/look"))!); // a completed job alone writes nothing

        var body = new { clientMutationId = Ulid.New(), planDate = "2026-11-18", favorite = true };
        var accepted = await client.PostJsonAsync($"v1/tenant/stylist/suggestion/{job.Id}/0/accept", body);
        var replay = await client.PostJsonAsync($"v1/tenant/stylist/suggestion/{job.Id}/0/accept", body);
        var missing = await client.PostJsonAsync($"v1/tenant/stylist/suggestion/{job.Id}/5/accept", new { clientMutationId = Ulid.New() });
        var noJob = await client.PostJsonAsync($"v1/tenant/stylist/suggestion/{Ulid.New()}/0/accept", new { clientMutationId = Ulid.New() });

        var result = await accepted.ReadAsync<AcceptedSuggestionDto>();
        Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);
        Assert.Equal((LookSource.Stylist, "Sakin Ofis", Occasion.Office, true, 4), (result.Look.Source, result.Look.Name, result.Look.Occasion!.Value, result.Look.Favorite, result.Look.PieceCount));
        Assert.Equal(productId, result.Look.Slots.Single(s => s.Missing).ProductId);
        Assert.Equal(result.Look.Id, result.PlanDay!.LookId);
        Assert.Equal(result.Look.Id, (await replay.ReadAsync<AcceptedSuggestionDto>()).Look.Id);
        Assert.Single((await client.GetAsync<List<LookDto>>("v1/tenant/look"))!);
        Assert.Equal((HttpStatusCode.NotFound, "suggestion_not_found"), (missing.StatusCode, await missing.CodeAsync()));
        Assert.Equal((HttpStatusCode.NotFound, "job_not_found"), (noJob.StatusCode, await noJob.CodeAsync()));
    }

    [Fact]
    public async Task AcceptSuggestion_PieceDeletedMeanwhile_409Stale_JobNotFinished_409_Dislike_StoresFeedback()
    {
        var (client, tenant, top, bottom, shoes) = await ArrangeAsync();
        var job = await factory.CompletedJobAsync(tenant, JobKind.StylistOutfit, Outfits(top, bottom, shoes));
        var running = new JobEntity { Id = Ulid.New(), TenantId = tenant, Kind = JobKind.StylistOutfit, Status = JobStatus.Processing, CreatedAt = DateTime.UtcNow };
        await factory.Repository.SaveAsync(running);

        var dislike = await client.PostJsonAsync($"v1/tenant/stylist/suggestion/{job.Id}/0/dislike", new { reason = "notMyStyle" });
        await client.DeleteAsync($"v1/tenant/item/{top.Id}");
        var stale = await client.PostJsonAsync($"v1/tenant/stylist/suggestion/{job.Id}/0/accept", new { clientMutationId = Ulid.New() });
        var early = await client.PostJsonAsync($"v1/tenant/stylist/suggestion/{running.Id}/0/accept", new { clientMutationId = Ulid.New() });

        Assert.Equal(HttpStatusCode.NoContent, dislike.StatusCode);
        var feedback = Assert.Single(await factory.Repository.GetAllAsync<StylistFeedbackEntity>(StylistFeedbackEntity.GetPk(tenant)));
        Assert.Equal((DislikeReason.NotMyStyle, 3), (feedback.Reason, feedback.ItemIds.Count));
        Assert.Equal((HttpStatusCode.Conflict, "suggestion_stale"), (stale.StatusCode, await stale.CodeAsync()));
        Assert.Equal((HttpStatusCode.Conflict, "job_not_completed"), (early.StatusCode, await early.CodeAsync()));
        Assert.Empty((await client.GetAsync<List<LookDto>>("v1/tenant/look"))!);
    }

    [Fact]
    public async Task Week_StartTakesOccasionsFromThePlan_AcceptWritesLooksAndPlanDays()
    {
        var (client, tenant, top, bottom, shoes) = await ArrangeAsync();
        await client.PutJsonAsync("v1/tenant/plan-day/2026-11-17", new { occasion = "dinner", baseVersion = 0 });
        var requestId = Ulid.New();

        var started = await client.PostJsonAsync("v1/tenant/stylist/week", new { requestId, weekStart = "2026-11-16", days = new[] { new { date = "2026-11-16", occasion = "office" } } });
        var badDay = await client.PostJsonAsync("v1/tenant/stylist/week", new { requestId = Ulid.New(), weekStart = "2026-11-16", days = new[] { new { date = "2026-12-25", occasion = "office" } } });

        Assert.Equal(HttpStatusCode.Accepted, started.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, badDay.StatusCode);
        var input = StylingJson.TryDeserialize<WeekJobInput>((await factory.Repository.GetAsync<JobEntity>(JobEntity.GetPk(tenant), JobEntity.GetSk(requestId)))!.Input)!;
        Assert.Equal(7, input.Days.Count);
        Assert.Equal([Occasion.Office, Occasion.Dinner, null], input.Days.Take(3).Select(d => d.Occasion));

        var outfit = Outfits(top, bottom, shoes).Suggestions[0];
        var job = await factory.CompletedJobAsync(tenant, JobKind.StylistWeek, new WeekResult("2026-11-16", null,
            [new WeekDayPlan("2026-11-16", Occasion.Office, outfit), new WeekDayPlan("2026-11-17", Occasion.Dinner, outfit with { Index = 1 }), new WeekDayPlan("2026-11-18", null, null)], "tr"));
        var body = new { clientMutationId = Ulid.New() };

        var accepted = await client.PostJsonAsync($"v1/tenant/stylist/week/{job.Id}/accept", body);
        await client.PostJsonAsync($"v1/tenant/stylist/week/{job.Id}/accept", body);

        var days = (await accepted.ReadAsync<AcceptedWeekDto>()).Days;
        Assert.Equal(["2026-11-16", "2026-11-17"], days.Select(d => d.Date));
        Assert.All(days, d => Assert.Equal(LookSource.Stylist, d.Look!.Source));
        Assert.Equal(Occasion.Dinner, days[1].Occasion);
        Assert.Equal(2, (await client.GetAsync<List<LookDto>>("v1/tenant/look"))!.Count);
    }

    private static PackResult Pack(string tripId, ItemEntity top, ItemEntity bottom, ItemEntity shoes, params string[] dates) => new(tripId, false, dates.Length > 1, "rule", null,
        [new PackItem(top.Id, dates.Length), new PackItem(bottom.Id, dates.Length), new PackItem(shoes.Id, dates.Length)],
        dates.Select(d => new PackDay(d, "Gün", Occasion.Office, [new SlotRef(OutfitSlot.Top, top.Id), new SlotRef(OutfitSlot.Bottom, bottom.Id), new SlotRef(OutfitSlot.Shoes, shoes.Id)])).ToList(),
        [new MissingPiece(OutfitSlot.Outerwear, ItemCategory.Outerwear, MissingPieceReason.Rain)], "tr");

    [Fact]
    public async Task Trip_CreatePackAcceptChecklistArchiveDelete()
    {
        var (client, tenant, top, bottom, shoes) = await ArrangeAsync();
        var tripId = Ulid.New();
        var trip = new { id = tripId, cityId = "paris", cityName = "Paris", startDate = "2027-03-01", endDate = "2027-03-03", tripTypes = new[] { "business", "dinner" }, cabinOnly = true };

        var created = await client.PostJsonAsync("v1/tenant/trip", trip);
        var replay = await client.PostJsonAsync("v1/tenant/trip", trip);
        var requestId = Ulid.New();
        var pack = await client.PostJsonAsync($"v1/tenant/trip/{tripId}/pack", new { requestId });
        var packUnknown = await client.PostJsonAsync($"v1/tenant/trip/{Ulid.New()}/pack", new { requestId = Ulid.New() });

        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
        Assert.Equal((TripStatus.Upcoming, false, 3, 0), ((await created.ReadAsync<TripDto>()).Status, (await created.ReadAsync<TripDto>()).Archived, (await created.ReadAsync<TripDto>()).DayCount, (await created.ReadAsync<TripDto>()).ItemCount));
        Assert.Equal(HttpStatusCode.Accepted, pack.StatusCode);
        Assert.Equal((HttpStatusCode.NotFound, "trip_not_found"), (packUnknown.StatusCode, await packUnknown.CodeAsync()));
        Assert.Equal(JobKind.StylistPack, Assert.Single(factory.Events.Of<StylistRequestedEvent>(tenant)).Kind);
        Assert.Empty((await client.GetAsync<TripDetailDto>($"v1/tenant/trip/{tripId}"))!.Items); // nothing packed until the user accepts

        var job = await factory.CompletedJobAsync(tenant, JobKind.StylistPack, Pack(tripId, top, bottom, shoes, "2027-03-01", "2027-03-02", "2027-03-03"));
        var acceptBody = new { clientMutationId = Ulid.New() };
        var accepted = await client.PostJsonAsync($"v1/tenant/trip/{tripId}/pack/{job.Id}/accept", acceptBody);
        await client.PostJsonAsync($"v1/tenant/trip/{tripId}/pack/{job.Id}/accept", acceptBody);
        var detail = await accepted.ReadAsync<TripDetailDto>();

        Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);
        Assert.Equal((3, 3, true), (detail.Items.Count, detail.Days.Count, detail.Trip.EveryPieceWornTwice));
        Assert.All(detail.Items, i => Assert.Equal(3, i.PlannedWears));
        Assert.Equal(MissingPieceReason.Rain, Assert.Single(detail.Trip.Missing).Reason);
        Assert.Null(detail.Days[0].Weather);

        var markId = Ulid.New();
        var now = DateTime.UtcNow;
        var packed = await client.PutJsonAsync($"v1/tenant/trip/{tripId}/item/{top.Id}", new { packed = true, clientMutationId = markId, occurredAt = now });
        await client.PutJsonAsync($"v1/tenant/trip/{tripId}/item/{top.Id}", new { packed = true, clientMutationId = markId, occurredAt = now });
        var lateOldEvent = await client.PutJsonAsync($"v1/tenant/trip/{tripId}/item/{top.Id}", new { packed = false, clientMutationId = Ulid.New(), occurredAt = now.AddHours(-2) });
        var notOnList = await client.PutJsonAsync($"v1/tenant/trip/{tripId}/item/{Ulid.New()}", new { packed = true, clientMutationId = Ulid.New(), occurredAt = now });

        Assert.True((await packed.ReadAsync<TripItemDto>()).Packed);
        Assert.True((await lateOldEvent.ReadAsync<TripItemDto>()).Packed); // an older offline event never rewinds a newer mark
        Assert.Equal(HttpStatusCode.NotFound, notOnList.StatusCode);
        Assert.Equal(1, Assert.Single((await client.GetAsync<List<TripDto>>("v1/tenant/trip"))!).PackedCount);

        var archived = await (await client.PostAsync($"v1/tenant/trip/{tripId}/archive", null)).ReadAsync<TripDto>();
        var unarchived = await (await client.DeleteAsync($"v1/tenant/trip/{tripId}/archive")).ReadAsync<TripDto>();
        Assert.True(archived.Archived);
        Assert.NotNull(archived.ArchivedAt);
        Assert.False(unarchived.Archived);

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"v1/tenant/trip/{tripId}")).StatusCode);
        Assert.Empty(await factory.Repository.GetKeysAsync(TripItemEntity.GetPk(tenant)));
        Assert.Empty(await factory.Repository.GetKeysAsync(TripDayEntity.GetPk(tenant)));
    }

    [Fact]
    public async Task Trip_AcceptIsReValidatedByPackingRules_Validation_PastTripIsArchived_NonMember403()
    {
        var (client, tenant, top, bottom, shoes) = await ArrangeAsync();
        var (free, _, _, _, _) = await ArrangeAsync(premium: false);
        var tripId = Ulid.New();
        await client.PostJsonAsync("v1/tenant/trip", new { id = tripId, cityId = "paris", startDate = "2027-03-01", endDate = "2027-03-02" });
        var pastId = Ulid.New();
        await client.PostJsonAsync("v1/tenant/trip", new { id = pastId, cityId = "rome", startDate = "2025-03-01", endDate = "2025-03-02" });
        var freeTripId = Ulid.New();
        await free.PostJsonAsync("v1/tenant/trip", new { id = freeTripId, cityId = "rome", startDate = "2027-03-01", endDate = "2027-03-02" });

        // Draft made for other dates: the second trip day has no look -> rejected, nothing written.
        var wrongDays = await factory.CompletedJobAsync(tenant, JobKind.StylistPack, Pack(tripId, top, bottom, shoes, "2027-03-01"));
        var stale = await client.PostJsonAsync($"v1/tenant/trip/{tripId}/pack/{wrongDays.Id}/accept", new { clientMutationId = Ulid.New() });
        var otherTrip = await factory.CompletedJobAsync(tenant, JobKind.StylistPack, Pack(Ulid.New(), top, bottom, shoes, "2027-03-01", "2027-03-02"));
        var mismatch = await client.PostJsonAsync($"v1/tenant/trip/{tripId}/pack/{otherTrip.Id}/accept", new { clientMutationId = Ulid.New() });
        var backwards = await client.PostJsonAsync("v1/tenant/trip", new { id = Ulid.New(), cityId = "paris", startDate = "2027-03-05", endDate = "2027-03-01" });
        var tooLong = await client.PostJsonAsync("v1/tenant/trip", new { id = Ulid.New(), cityId = "paris", startDate = "2027-03-01", endDate = "2027-04-15" });
        var denied = await free.PostJsonAsync($"v1/tenant/trip/{freeTripId}/pack", new { requestId = Ulid.New() });

        Assert.Equal((HttpStatusCode.Conflict, "suggestion_stale"), (stale.StatusCode, await stale.CodeAsync()));
        Assert.Equal((HttpStatusCode.NotFound, "suggestion_not_found"), (mismatch.StatusCode, await mismatch.CodeAsync()));
        Assert.Empty(await factory.Repository.GetKeysAsync(TripItemEntity.GetPk(tenant)));
        Assert.Equal(HttpStatusCode.BadRequest, backwards.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, tooLong.StatusCode);
        Assert.Equal((HttpStatusCode.Forbidden, "premium_required"), (denied.StatusCode, await denied.CodeAsync()));
        var past = (await client.GetAsync<List<TripDto>>("v1/tenant/trip"))!.Single(t => t.Id == pastId);
        Assert.Equal((TripStatus.Past, true), (past.Status, past.Archived));

        var update = await client.PutJsonAsync($"v1/tenant/trip/{tripId}", new { cityId = "lyon", startDate = "2027-03-01", endDate = "2027-03-02", cabinOnly = true, baseVersion = 1 });
        var staleUpdate = await client.PutJsonAsync($"v1/tenant/trip/{tripId}", new { cityId = "nice", startDate = "2027-03-01", endDate = "2027-03-02", cabinOnly = true, baseVersion = 1 });
        Assert.Equal(("lyon", true), ((await update.ReadAsync<TripDto>()).CityId, (await update.ReadAsync<TripDto>()).CabinOnly));
        Assert.Equal(HttpStatusCode.Conflict, staleUpdate.StatusCode);
    }
}

public class TryOnAndPaletteEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private async Task<(HttpClient Client, string TenantId, LookEntity Look, PhotoEntity? Body)> ArrangeAsync(bool premium = true, bool bodyPhoto = true)
    {
        var (client, auth) = await factory.RegisterAsync();
        if (premium)
            await factory.PremiumAsync(auth.TenantId);
        var body = bodyPhoto ? await factory.PhotoAsync(auth.TenantId, PhotoKind.Body) : null;
        var top = await factory.ItemAsync(auth.TenantId, ItemCategory.Top);
        var bottom = await factory.ItemAsync(auth.TenantId, ItemCategory.Bottom);
        return (client, auth.TenantId, await factory.LookAsync(auth.TenantId, (OutfitSlot.Top, top.Id), (OutfitSlot.Bottom, bottom.Id)), body);
    }

    private static object TryOn(string id, string kind = "look", int? index = null) => new { requestId = Ulid.New(), target = new { kind, id, index } };

    [Fact]
    public async Task Start_ReservesOneCredit_SameOutfitAgainIsTheSameJob_NoSecondCharge()
    {
        var (client, tenant, look, body) = await ArrangeAsync();

        var first = await client.PostJsonAsync("v1/tenant/tryon", TryOn(look.Id));
        var second = await client.PostJsonAsync("v1/tenant/tryon", TryOn(look.Id)); // new requestId, same outfit + body photo

        var started = await first.ReadAsync<TryOnStartDto>();
        Assert.Equal(HttpStatusCode.Accepted, first.StatusCode);
        Assert.Equal(StartStatus.Queued, started.Status);
        Assert.Equal(HttpStatusCode.Accepted, second.StatusCode);
        Assert.Equal(started.Job!.Id, (await second.ReadAsync<TryOnStartDto>()).Job!.Id);
        Assert.Equal(29, await factory.CreditsAsync(tenant));

        var message = Assert.Single(factory.Events.Of<TryOnRequestedEvent>(tenant));
        Assert.Equal(body!.Id, message.BodyPhotoId);
        Assert.Equal(TryOnTargetKind.Look, message.Target.Kind);
        var job = (await factory.Repository.GetAsync<JobEntity>(JobEntity.GetPk(tenant), JobEntity.GetSk(started.Job.Id)))!;
        Assert.Equal(message.CreditIdempotencyKey, job.CreditIdempotencyKey); // the worker refunds through this key on failure
        Assert.Equal(2, StylingJson.TryDeserialize<TryOnJobInput>(job.Input)!.Pieces.Count);
    }

    [Fact]
    public async Task TripDay_RendersTheDaysLook_SharesTheLooksJob_AndCache_UnknownDay404()
    {
        var (client, tenant, look, _) = await ArrangeAsync();
        var tripId = Ulid.New();
        await factory.Repository.SaveAsync(new TripDayEntity
        {
            TenantId = tenant, TripId = tripId, Date = "2027-03-01", Occasion = Occasion.Dinner,
            Slots = look.Slots.Select(s => new LookSlotValue { Slot = s.Slot, ItemId = s.ItemId }).ToList(),
        });

        var day = await client.PostJsonAsync("v1/tenant/tryon", TryOn($"{tripId}/2027-03-01", "tripDay"));
        var sameOutfit = await client.PostJsonAsync("v1/tenant/tryon", TryOn(look.Id));
        var unknownDay = await client.PostJsonAsync("v1/tenant/tryon", TryOn($"{tripId}/2027-03-09", "tripDay"));
        var malformed = await client.PostJsonAsync("v1/tenant/tryon", TryOn(tripId, "tripDay"));
        var findBefore = await client.GetAsync($"v1/tenant/tryon?kind=tripDay&id={tripId}/2027-03-01");

        Assert.Equal(HttpStatusCode.Accepted, day.StatusCode);
        Assert.Equal((await day.ReadAsync<TryOnStartDto>()).Job!.Id, (await sameOutfit.ReadAsync<TryOnStartDto>()).Job!.Id); // one outfit, one job
        Assert.Equal(29, await factory.CreditsAsync(tenant));
        Assert.Equal((HttpStatusCode.NotFound, "target_not_found"), (unknownDay.StatusCode, await unknownDay.CodeAsync()));
        Assert.Equal(HttpStatusCode.NotFound, malformed.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, findBefore.StatusCode); // nothing rendered yet
    }

    [Fact]
    public async Task Start_Gates_BodyPhoto_Membership_Credits_Target()
    {
        var (noPhoto, _, lookA, _) = await ArrangeAsync(bodyPhoto: false);
        var (free, freeTenant, lookB, _) = await ArrangeAsync(premium: false);
        var (broke, brokeTenant, lookC, _) = await ArrangeAsync();
        var credits = factory.Services.GetRequiredService<ICreditService>();
        for (var i = 0; i < 30; i++)
            await credits.ReserveAsync(brokeTenant, $"used-{i}", $"job-{i}", default);

        var photoRequired = await noPhoto.PostJsonAsync("v1/tenant/tryon", TryOn(lookA.Id));
        var paywall = await free.PostJsonAsync("v1/tenant/tryon", TryOn(lookB.Id));
        var exhausted = await broke.PostJsonAsync("v1/tenant/tryon", TryOn(lookC.Id));
        var unknown = await broke.PostJsonAsync("v1/tenant/tryon", TryOn(Ulid.New()));
        var foreign = await broke.PostJsonAsync("v1/tenant/tryon", TryOn(lookB.Id)); // another tenant's look
        var editLook = await broke.PostJsonAsync("v1/tenant/tryon", TryOn("edit-1", "editLook"));
        var badKind = await broke.PostJsonAsync("v1/tenant/tryon", TryOn(lookC.Id, "selfie"));

        Assert.Equal((HttpStatusCode.UnprocessableEntity, "body_photo_required"), (photoRequired.StatusCode, await photoRequired.CodeAsync()));
        Assert.Equal((HttpStatusCode.Forbidden, "premium_required"), (paywall.StatusCode, await paywall.CodeAsync()));
        Assert.Equal((HttpStatusCode.PaymentRequired, "credits_exhausted"), (exhausted.StatusCode, await exhausted.CodeAsync()));
        Assert.Equal((HttpStatusCode.NotFound, "target_not_found"), (unknown.StatusCode, await unknown.CodeAsync()));
        Assert.Equal(HttpStatusCode.NotFound, foreign.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, editLook.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, badKind.StatusCode);
        Assert.Empty(factory.Events.Of<TryOnRequestedEvent>(freeTenant));
        Assert.Empty(factory.Events.Of<TryOnRequestedEvent>(brokeTenant));
        Assert.DoesNotContain(await factory.Repository.GetAllAsync<JobEntity>(JobEntity.GetPk(brokeTenant)), j => j.Kind == JobKind.TryOn); // no orphan job
    }

    [Fact]
    public async Task CachedImage_IsReturnedWithoutACharge_AlsoForASuggestionOfTheSamePieces_OwnerOnly()
    {
        var (client, tenant, look, body) = await ArrangeAsync();
        var (stranger, _, _, _) = await ArrangeAsync();
        var pieces = look.Slots.Select(s => new OutfitPiece(s.ItemId, null)).ToList();
        var image = new TryOnImageEntity
        {
            Id = Ulid.New(), TenantId = tenant, BodyPhotoId = body!.Id, TargetKind = TryOnTargetKind.Look, TargetId = TryOnFingerprint.Of(pieces), TargetVersion = 0,
            S3Key = $"{StorageKeys.TryOnPrefix(tenant)}img.webp", CreatedAt = DateTime.UtcNow,
        };
        await factory.Repository.SaveAsync(image);
        var suggestion = await factory.CompletedJobAsync(tenant, JobKind.StylistOutfit, new OutfitResult("2026-11-18", null, true, null,
            [new SuggestedOutfit(0, null, null, "rule", look.Slots.Select(s => new SlotRef(s.Slot, s.ItemId)).Reverse().ToList(), [])]));

        var cached = await client.PostJsonAsync("v1/tenant/tryon", TryOn(look.Id));
        var viaSuggestion = await client.PostJsonAsync("v1/tenant/tryon", TryOn(suggestion.Id, "suggestion", 0));
        var found = await client.GetAsync($"v1/tenant/tryon?kind=look&id={look.Id}");
        var byId = await client.GetAsync($"v1/tenant/tryon/{image.Id}");

        var dto = await cached.ReadAsync<TryOnStartDto>();
        Assert.Equal(HttpStatusCode.OK, cached.StatusCode);
        Assert.Equal((StartStatus.Cached, image.Id), (dto.Status, dto.Image!.Id));
        Assert.Contains($"tenant/{tenant}/tryon/", dto.Image.Url);
        Assert.Null(dto.Job);
        Assert.Equal(image.Id, (await viaSuggestion.ReadAsync<TryOnStartDto>()).Image!.Id); // same pieces = same image
        Assert.Equal(image.Id, (await found.ReadAsync<TryOnImageDto>()).Id);
        Assert.Equal(HttpStatusCode.OK, byId.StatusCode);
        Assert.Equal(30, await factory.CreditsAsync(tenant));
        Assert.Empty(factory.Events.Of<TryOnRequestedEvent>(tenant));

        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"v1/tenant/tryon/{image.Id}")).StatusCode); // never visible to anyone else
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"v1/tenant/tryon?kind=look&id={look.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("v1/tenant/tryon?kind=nope&id=x")).StatusCode);
    }

    [Fact]
    public async Task PlanWeek_ShowsTheRequiredCreditsFirst_ThenChargesExactlyThat()
    {
        var (client, tenant, look, _) = await ArrangeAsync();
        var shoes = await factory.ItemAsync(tenant, ItemCategory.Shoes);
        var second = await factory.LookAsync(tenant, (OutfitSlot.Top, look.Slots[0].ItemId!), (OutfitSlot.Shoes, shoes.Id));
        await client.PutJsonAsync("v1/tenant/plan-day/2026-11-16", new { lookId = look.Id, baseVersion = 0 });
        await client.PutJsonAsync("v1/tenant/plan-day/2026-11-17", new { lookId = second.Id, baseVersion = 0 });
        await client.PutJsonAsync("v1/tenant/plan-day/2026-11-19", new { lookId = look.Id, baseVersion = 0 }); // same outfit again: one image
        await client.PutJsonAsync("v1/tenant/plan-day/2026-11-20", new { occasion = "office", baseVersion = 0 }); // no look: nothing to render

        var quote = await (await client.PostJsonAsync("v1/tenant/tryon/plan-week/quote", new { weekStart = "2026-11-16" })).ReadAsync<TryOnQuoteDto>();
        Assert.Equal((2, 0, 30, true, 3), (quote.RequiredCredits, quote.CachedCount, quote.RemainingCredits, quote.Sufficient, quote.Items.Count));
        Assert.Equal(30, await factory.CreditsAsync(tenant)); // a quote charges nothing

        var changed = await client.PostJsonAsync("v1/tenant/tryon/plan-week", new { requestId = Ulid.New(), weekStart = "2026-11-16", expectedCredits = 3 });
        Assert.Equal((HttpStatusCode.Conflict, "credit_quote_changed"), (changed.StatusCode, await changed.CodeAsync()));
        Assert.Equal(30, await factory.CreditsAsync(tenant));

        var started = await client.PostJsonAsync("v1/tenant/tryon/plan-week", new { requestId = Ulid.New(), weekStart = "2026-11-16", expectedCredits = 2 });
        var batch = await started.ReadAsync<TryOnBatchDto>();
        Assert.Equal(HttpStatusCode.Accepted, started.StatusCode);
        Assert.Equal((2, 3), (batch.ChargedCredits, batch.Items.Count));
        Assert.Equal(batch.Items[0].Job!.Id, batch.Items[2].Job!.Id);
        Assert.Equal(28, await factory.CreditsAsync(tenant));
        Assert.Equal(2, factory.Events.Of<TryOnRequestedEvent>(tenant).Count);

        var again = await (await client.PostJsonAsync("v1/tenant/tryon/plan-week/quote", new { weekStart = "2026-11-16" })).ReadAsync<TryOnQuoteDto>();
        Assert.Equal(0, again.RequiredCredits); // already being rendered: already paid
    }

    [Fact]
    public async Task PlanWeek_NotEnoughCredits_402_ChargesNothing()
    {
        var (client, tenant, look, _) = await ArrangeAsync();
        var credits = factory.Services.GetRequiredService<ICreditService>();
        for (var i = 0; i < 30; i++)
            await credits.ReserveAsync(tenant, $"used-{i}", $"job-{i}", default);
        await client.PutJsonAsync("v1/tenant/plan-day/2026-11-16", new { lookId = look.Id, baseVersion = 0 });

        var quote = await (await client.PostJsonAsync("v1/tenant/tryon/plan-week/quote", new { weekStart = "2026-11-16" })).ReadAsync<TryOnQuoteDto>();
        var start = await client.PostJsonAsync("v1/tenant/tryon/plan-week", new { requestId = Ulid.New(), weekStart = "2026-11-16", expectedCredits = 1 });

        Assert.Equal((1, 0, false), (quote.RequiredCredits, quote.RemainingCredits, quote.Sufficient));
        Assert.Equal((HttpStatusCode.PaymentRequired, "credits_exhausted"), (start.StatusCode, await start.CodeAsync()));
        Assert.Empty(factory.Events.Of<TryOnRequestedEvent>(tenant));
    }

    [Fact]
    public async Task Palette_Analyze_Gates_And_Result_WithRuleBasedCompatibility()
    {
        var (client, auth) = await factory.RegisterAsync();
        var noPalette = await client.GetAsync("v1/tenant/palette");
        var noFace = await client.PostJsonAsync("v1/tenant/palette/analyze", new { requestId = Ulid.New() });
        var face = await factory.PhotoAsync(auth.TenantId, PhotoKind.Face);
        var paywall = await client.PostJsonAsync("v1/tenant/palette/analyze", new { requestId = Ulid.New() });
        await factory.PremiumAsync(auth.TenantId);
        var requestId = Ulid.New();
        var queued = await client.PostJsonAsync("v1/tenant/palette/analyze", new { requestId });
        var replay = await client.PostJsonAsync("v1/tenant/palette/analyze", new { requestId });

        Assert.Equal((HttpStatusCode.NotFound, "palette_not_found"), (noPalette.StatusCode, await noPalette.CodeAsync()));
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "face_photo_required"), (noFace.StatusCode, await noFace.CodeAsync()));
        Assert.Equal((HttpStatusCode.Forbidden, "premium_required"), (paywall.StatusCode, await paywall.CodeAsync()));
        Assert.Equal(HttpStatusCode.Accepted, queued.StatusCode);
        Assert.Equal(requestId, (await replay.ReadAsync<PaletteStartDto>()).Job!.Id);
        Assert.Equal(face.Id, Assert.Single(factory.Events.Of<PaletteRequestedEvent>(auth.TenantId)).FacePhotoId);
        Assert.Equal(30, await factory.CreditsAsync(auth.TenantId)); // palette analysis costs no image credit

        var season = SeasonTypeCatalog.Find("warm-autumn")!;
        await factory.Repository.SaveAsync(new PaletteResultEntity
        {
            TenantId = auth.TenantId, SeasonTypeId = season.Id, FlatteringColorIds = season.FlatteringColorIds.ToList(), AvoidColorIds = season.AvoidColorIds.ToList(),
            SourcePhotoId = face.Id, AnalyzedAt = DateTime.UtcNow,
        });
        await factory.ItemAsync(auth.TenantId, ItemCategory.Top, "camel");
        await factory.ItemAsync(auth.TenantId, ItemCategory.Bottom, "navy");
        var clash = await factory.ItemAsync(auth.TenantId, ItemCategory.Shoes, "black");

        var palette = (await client.GetAsync<PaletteDto>("v1/tenant/palette"))!;
        var mismatch = (await client.GetAsync<PaletteMismatchDto>("v1/tenant/palette/mismatch"))!;
        var upToDate = await client.PostJsonAsync("v1/tenant/palette/analyze", new { requestId = Ulid.New() });

        Assert.Equal(("warm-autumn", "Sıcak Sonbahar", true), (palette.SeasonTypeId, palette.SeasonName, palette.SourcePhotoActive));
        Assert.Contains(palette.Flattering, c => c is { Id: "camel", Name: "Camel", Hex: "#C19A6B" });
        Assert.Contains(palette.Avoid, c => c.Id == "black" && c.Name == "Siyah");
        Assert.Equal(new PaletteCompatibilityDto(67, 3, 1, 1, 1), palette.Compatibility);
        Assert.Equal(clash.Id, Assert.Single(mismatch.Items).Id);
        Assert.Equal(HttpStatusCode.OK, upToDate.StatusCode); // same face photo: no second analysis
        Assert.Equal(StartStatus.Cached, (await upToDate.ReadAsync<PaletteStartDto>()).Status);
        Assert.Single(factory.Events.Of<PaletteRequestedEvent>(auth.TenantId));

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync("v1/tenant/palette")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("v1/tenant/palette/mismatch")).StatusCode);
    }

    [Fact]
    public async Task EveryNewEndpoint_RequiresTheTenantJwt()
    {
        var anonymous = factory.CreateClient();
        string[] gets = ["item", "item-draft", "library/item", "reference/wardrobe", "look", "today?date=2026-11-18", "plan-day?from=2026-11-16&to=2026-11-22",
            "wear-log?month=2026-11", "wear-log/summary?month=2026-11", "trip", "tryon?kind=look&id=x", "palette", "palette/mismatch"];

        foreach (var path in gets)
            Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync($"v1/tenant/{path}")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.PostJsonAsync("v1/tenant/tryon", TryOn(Ulid.New()))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.PostJsonAsync("v1/tenant/stylist/outfit", new { requestId = Ulid.New(), date = "2026-11-18" })).StatusCode);
    }

    [Fact]
    public async Task Responses_UseCamelCaseEnums_AndCarryNoProse()
    {
        var (client, tenant, look, _) = await ArrangeAsync();

        var json = await (await client.GetAsync($"v1/tenant/look/{look.Id}")).JsonAsync();
        var problem = await (await client.PostJsonAsync("v1/tenant/look", new { id = Ulid.New(), slots = Array.Empty<object>() })).JsonAsync();

        Assert.Equal("user", json.GetProperty("source").GetString());
        Assert.Equal(JsonValueKind.Null, json.GetProperty("occasion").ValueKind);
        Assert.Equal("top", json.GetProperty("slots")[0].GetProperty("slot").GetString());
        Assert.Equal("look_min_pieces", problem.GetProperty("code").GetString());
        Assert.Equal("look_min_pieces", problem.GetProperty("title").GetString()); // a code, never a sentence
        Assert.False(problem.TryGetProperty("detail", out var detail) && detail.ValueKind == JsonValueKind.String);
        _ = tenant;
    }
}

/// <summary>Owner decision 2026-11-18: non-members get Entitlements:Free:ItemRecognitionLimit AI garment recognitions (lifetime).</summary>
public class ItemRecognitionQuotaEndpointTests : IClassFixture<ItemRecognitionQuotaEndpointTests.Factory>
{
    public sealed class Factory : IDisposable
    {
        public ApiFactory Api { get; } = new();
        public Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactory<Api.Entrypoint> WithLimit(int limit) =>
            Api.WithWebHostBuilder(b => b.UseSetting("Entitlements:Free:ItemRecognitionLimit", limit.ToString(System.Globalization.CultureInfo.InvariantCulture)));
        public void Dispose() => Api.Dispose();
    }

    private readonly Factory _factory;
    public ItemRecognitionQuotaEndpointTests(Factory factory) => _factory = factory;

    private async Task<(HttpClient Client, string TenantId)> UserAsync(int limit)
    {
        var client = _factory.WithLimit(limit).CreateClient();
        var response = await client.PostAsJsonAsync("v1/auth/register", new { name = "Ayşe", email = $"{Guid.NewGuid():N}@example.com", password = "Sifre1234", ageConfirmed = true }, ApiFactory.Json);
        var auth = (await response.Content.ReadFromJsonAsync<Api.Contracts.AuthResponse>(ApiFactory.Json))!;
        client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", auth.AccessToken);
        return (client, auth.TenantId);
    }

    private async Task<List<string>> UploadAsync(HttpClient client, int count)
    {
        var uploads = await (await client.PostJsonAsync("v1/tenant/item/upload-url", new { count, contentType = "image/jpeg" })).ReadAsync<ItemUploadsDto>();
        foreach (var upload in uploads.Uploads)
            await _factory.Api.Storage.PutAsync(upload.Fields["key"], Tests.Shared.TestImages.JpegWithExif(), "image/jpeg", default);
        return uploads.Uploads.Select(u => u.UploadId).ToList();
    }

    private static Task<HttpResponseMessage> StartAsync(HttpClient client, IEnumerable<string> uploadIds, bool split = false, bool manual = false) =>
        client.PostJsonAsync("v1/tenant/item-draft", new { requestId = Ulid.New(), uploadIds, splitOutfit = split, manual });

    private static async Task<(int? Limit, int Used, int? Remaining)> QuotaAsync(HttpClient client)
    {
        var quota = (await (await client.GetAsync("v1/tenant/entitlement")).JsonAsync()).GetProperty("itemRecognition");
        int? Number(string name) => quota.GetProperty(name).ValueKind == JsonValueKind.Null ? null : quota.GetProperty(name).GetInt32();
        return (Number("limit"), quota.GetProperty("used").GetInt32(), Number("remaining"));
    }

    private async Task SettleAsync(string tenantId, bool succeed)
    {
        var lifecycle = _factory.Api.Services.GetRequiredService<IJobLifecycle>();
        foreach (var job in (await _factory.Api.Repository.GetAllAsync<JobEntity>(JobEntity.GetPk(tenantId))).Where(j => j.Status == JobStatus.Queued))
        {
            if (succeed) await lifecycle.CompleteAsync(job, "{}", default);
            else await lifecycle.FailAsync(job, JobFailure.ProviderError, default);
        }
    }

    [Fact]
    public async Task NonMember_BulkAboveTheAllowance_ProcessesWhatIsLeft_ReportsSkipped_Then402()
    {
        var (client, tenantId) = await UserAsync(limit: 3);
        var uploads = await UploadAsync(client, 5);

        var before = await QuotaAsync(client);
        var bulk = await StartAsync(client, uploads);
        var started = await bulk.ReadAsync<StartDraftsDto>();
        await SettleAsync(tenantId, succeed: true);
        var again = await StartAsync(client, await UploadAsync(client, 1));
        var split = await StartAsync(client, await UploadAsync(client, 1), split: true);

        Assert.Equal((3, 0, 3), before);
        Assert.Equal(HttpStatusCode.Accepted, bulk.StatusCode);
        Assert.Equal((3, 3, 2), (started.Jobs.Count, started.Drafts.Count, started.SkippedCount));
        Assert.Equal(uploads.Skip(3), started.SkippedUploadIds);
        Assert.Equal((3, 3, 0), (started.ItemRecognition!.Limit, started.ItemRecognition.Used, started.ItemRecognition.Remaining));
        Assert.Equal(3, _factory.Api.Events.Of<ItemProcessRequestedEvent>(tenantId).Count);
        Assert.Equal((HttpStatusCode.PaymentRequired, "item_recognition_limit_reached"), (again.StatusCode, await again.CodeAsync()));
        Assert.Equal((HttpStatusCode.PaymentRequired, "item_recognition_limit_reached"), (split.StatusCode, await split.CodeAsync()));
        Assert.Equal((3, 3, 0), await QuotaAsync(client));
        Assert.Equal(3, (await _factory.Api.Repository.GetAllAsync<JobEntity>(JobEntity.GetPk(tenantId))).Count); // refused requests create no job
    }

    private async Task<ItemDraftEntity> FailDraftAsync(string tenantId, string draftId)
    {
        await SettleAsync(tenantId, succeed: false);
        var draft = (await _factory.Api.Repository.GetAsync<ItemDraftEntity>(ItemDraftEntity.GetPk(tenantId), ItemDraftEntity.GetSk(draftId)))!;
        draft.Status = ItemDraftStatus.Failed;
        draft.OriginalKey = StorageKeys.ItemOriginal(tenantId, draftId, "jpg");
        await _factory.Api.Storage.PutAsync(draft.OriginalKey, Tests.Shared.TestImages.JpegWithExif(), "image/jpeg", default);
        await _factory.Api.Repository.SaveAsync(draft);
        return draft;
    }

    [Fact]
    public async Task Retry_FailedDraft_QueuesANewJobOnTheSamePhoto_AndUsesOneRecognition()
    {
        var (client, tenantId) = await UserAsync(limit: 2);
        var uploadId = (await UploadAsync(client, 1)).Single();
        var started = await (await StartAsync(client, [uploadId])).ReadAsync<StartDraftsDto>();

        var tooEarly = await client.PostAsync($"v1/tenant/item-draft/{uploadId}/retry", null);
        await FailDraftAsync(tenantId, uploadId);
        // The temporary upload expires after a day: the retry restores it from the original kept with the draft.
        await _factory.Api.Storage.DeleteAsync(StorageKeys.Upload(tenantId, uploadId), default);
        var afterFailure = await QuotaAsync(client);

        var retry = await client.PostAsync($"v1/tenant/item-draft/{uploadId}/retry", null);
        var body = await retry.ReadAsync<StartDraftsDto>();
        var second = await client.PostAsync($"v1/tenant/item-draft/{uploadId}/retry", null);
        var unknown = await client.PostAsync($"v1/tenant/item-draft/{Ulid.New()}/retry", null);
        var events = _factory.Api.Events.Of<ItemProcessRequestedEvent>(tenantId);

        Assert.Equal((HttpStatusCode.Conflict, "draft_not_failed"), (tooEarly.StatusCode, await tooEarly.CodeAsync()));
        Assert.Equal((2, 0, 2), afterFailure);
        Assert.Equal(HttpStatusCode.Accepted, retry.StatusCode);
        Assert.Equal((1, 1, 0), (body.Drafts.Count, body.Jobs.Count, body.SkippedCount));
        Assert.Equal((uploadId, ItemDraftStatus.Uploaded), (body.Drafts[0].Id, body.Drafts[0].Status));
        Assert.NotEqual(started.Jobs[0].Id, body.Jobs[0].Id);
        Assert.Equal(body.Jobs[0].Id, body.Drafts[0].JobId);
        Assert.Equal((JobKind.ItemProcess, JobStatus.Queued), (body.Jobs[0].Kind, body.Jobs[0].Status));
        Assert.Equal((2, 1, 1), (body.ItemRecognition!.Limit, body.ItemRecognition.Used, body.ItemRecognition.Remaining));
        Assert.Equal(2, events.Count);
        Assert.Equal((body.Jobs[0].Id, uploadId, false), (events[^1].JobId, events[^1].DraftId, events[^1].Split));
        Assert.True(_factory.Api.Storage.Objects.ContainsKey(StorageKeys.Upload(tenantId, uploadId)));
        Assert.Equal((HttpStatusCode.Conflict, "draft_not_failed"), (second.StatusCode, await second.CodeAsync())); // already queued again
        Assert.Equal((HttpStatusCode.NotFound, "draft_not_found"), (unknown.StatusCode, await unknown.CodeAsync()));
    }

    [Fact]
    public async Task Retry_FollowsTheAllowance_AndNeedsThePhoto()
    {
        var (client, tenantId) = await UserAsync(limit: 1);
        var uploadId = (await UploadAsync(client, 1)).Single();
        (await StartAsync(client, [uploadId])).EnsureSuccessStatusCode();
        var draft = await FailDraftAsync(tenantId, uploadId);

        // The only recognition is taken by another photo that completed.
        (await StartAsync(client, await UploadAsync(client, 1))).EnsureSuccessStatusCode();
        await SettleAsync(tenantId, succeed: true);
        var exhausted = await client.PostAsync($"v1/tenant/item-draft/{uploadId}/retry", null);

        // Members are unlimited; with both the upload and the original gone there is nothing to process.
        await _factory.Api.PremiumAsync(tenantId);
        await _factory.Api.Storage.DeleteAsync(StorageKeys.Upload(tenantId, uploadId), default);
        await _factory.Api.Storage.DeleteAsync(draft.OriginalKey!, default);
        var gone = await client.PostAsync($"v1/tenant/item-draft/{uploadId}/retry", null);

        Assert.Equal((HttpStatusCode.PaymentRequired, "item_recognition_limit_reached"), (exhausted.StatusCode, await exhausted.CodeAsync()));
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "upload_missing"), (gone.StatusCode, await gone.CodeAsync()));
        Assert.Equal(ItemDraftStatus.Failed, (await _factory.Api.Repository.GetAsync<ItemDraftEntity>(draft.Pk, draft.Sk))!.Status);
    }

    [Fact]
    public async Task Retry_LimitZero_IsMembersOnly()
    {
        var (client, tenantId) = await UserAsync(limit: 0);
        var draftId = Ulid.New();
        await _factory.Api.Repository.SaveAsync(new ItemDraftEntity
        {
            Id = draftId, TenantId = tenantId, Kind = ItemDraftKind.Single, Status = ItemDraftStatus.Failed, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
        });
        await _factory.Api.Storage.PutAsync(StorageKeys.Upload(tenantId, draftId), Tests.Shared.TestImages.JpegWithExif(), "image/jpeg", default);

        var retry = await client.PostAsync($"v1/tenant/item-draft/{draftId}/retry", null);

        Assert.Equal((HttpStatusCode.Forbidden, "premium_required"), (retry.StatusCode, await retry.CodeAsync()));
    }

    [Fact]
    public async Task FailedJobs_GiveTheRecognitionBack()
    {
        var (client, tenantId) = await UserAsync(limit: 2);

        (await StartAsync(client, await UploadAsync(client, 2))).EnsureSuccessStatusCode();
        var whileRunning = await QuotaAsync(client);
        await SettleAsync(tenantId, succeed: false);
        var afterFailure = await QuotaAsync(client);
        var retry = await StartAsync(client, await UploadAsync(client, 1), split: true);

        Assert.Equal((2, 2, 0), whileRunning);
        Assert.Equal((2, 0, 2), afterFailure);
        Assert.Equal(HttpStatusCode.Accepted, retry.StatusCode);
    }

    [Fact]
    public async Task ManualEntry_StaysPossible_WithoutAi_WhenTheAllowanceIsUsedUp()
    {
        var (client, tenantId) = await UserAsync(limit: 1);
        (await StartAsync(client, await UploadAsync(client, 1))).EnsureSuccessStatusCode();
        await SettleAsync(tenantId, succeed: true);
        var upload = await UploadAsync(client, 1);

        var refused = await StartAsync(client, upload);
        var manual = await StartAsync(client, upload, manual: true);
        var draft = Assert.Single((await manual.ReadAsync<StartDraftsDto>()).Drafts);
        var mutationId = Ulid.New();
        var confirmed = await client.PostJsonAsync("v1/tenant/item-draft/confirm", new
        {
            items = new[] { new { draftId = draft.Id, clientMutationId = mutationId, reviewed = true, name = "Krem kazak", category = "top", colorIds = new[] { "cream" }, fabric = "knit", seasons = new[] { "winter" } } },
        });

        Assert.Equal(HttpStatusCode.PaymentRequired, refused.StatusCode);
        Assert.Equal(HttpStatusCode.Accepted, manual.StatusCode);
        Assert.Equal((ItemDraftStatus.Ready, (string?)null, false), (draft.Status, draft.JobId, draft.NeedsReview));
        Assert.NotNull(draft.OriginalImageUrl);
        Assert.Equal(1, (await confirmed.ReadAsync<ItemCreateResultsDto>()).CreatedCount);
        Assert.Single(_factory.Api.Events.Of<ItemProcessRequestedEvent>(tenantId));   // only the first, AI, request reached a worker
        Assert.Equal((1, 1, 0), await QuotaAsync(client));
        // The stored original has no EXIF (stripped by the Api on the manual path).
        var original = _factory.Api.Storage.Objects.Single(o => o.Key.Contains(draft.Id) && o.Key.Contains("original"));
        Assert.DoesNotContain("Exif", System.Text.Encoding.Latin1.GetString(original.Value.Data));
    }

    [Fact]
    public async Task ZeroLimit_GoesStraightToThePaywall_AndMembersAreUnlimited()
    {
        var (client, tenantId) = await UserAsync(limit: 0);

        var paywall = await StartAsync(client, await UploadAsync(client, 1));
        var free = await QuotaAsync(client);
        await _factory.Api.PremiumAsync(tenantId);
        var member = await StartAsync(client, await UploadAsync(client, 4));
        var premium = await QuotaAsync(client);

        Assert.Equal((HttpStatusCode.Forbidden, "premium_required"), (paywall.StatusCode, await paywall.CodeAsync()));
        Assert.Equal((0, 0, 0), free);
        Assert.Equal(HttpStatusCode.Accepted, member.StatusCode);
        Assert.Equal((4, 0), ((await member.ReadAsync<StartDraftsDto>()).Jobs.Count, (await member.ReadAsync<StartDraftsDto>()).SkippedCount));
        Assert.Equal(((int?)null, (int?)null), (premium.Limit, premium.Remaining));
    }
}
