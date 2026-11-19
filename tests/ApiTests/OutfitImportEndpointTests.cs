using System.Net;
using System.Text.Json;
using Domain.Entity;
using Domain.Enum;
using Domain.Events;
using Domain.Extensions;
using Domain.Services;
using Domain.Services.Ai;
using Microsoft.AspNetCore.Hosting;

namespace ApiTests;

/// <summary>Plans with different photo limits (owner change 2026-11-19: the limit is configuration, per plan) and a small free allowance.</summary>
public sealed class OutfitImportApiFactory : ApiFactory
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.UseSetting("Entitlements:Free:OutfitImportMaxPhotos", "5");
        builder.UseSetting("Entitlements:Premium:OutfitImportMaxPhotos", "12");
        builder.UseSetting("Entitlements:Free:ItemRecognitionLimit", "4");
    }
}

public class OutfitImportEndpointTests(OutfitImportApiFactory factory) : IClassFixture<OutfitImportApiFactory>
{
    private const string Url = "v1/tenant/outfit-import";

    private static object Create(int count, string? requestId = null) => new { requestId = requestId ?? Ulid.New(), count };

    private async Task<(HttpClient Client, string Tenant)> UserAsync(bool premium = false)
    {
        var (client, auth) = await factory.RegisterAsync();
        if (premium)
            await factory.PremiumAsync(auth.TenantId);
        return (client, auth.TenantId);
    }

    private async Task<(string SessionId, JsonElement Body)> StartAsync(HttpClient client, int count)
    {
        var response = await client.PostJsonAsync(Url, Create(count));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await response.JsonAsync();
        var sessionId = body.GetProperty("session").GetProperty("id").GetString()!;
        foreach (var upload in body.GetProperty("uploads").EnumerateArray())
            await factory.Storage.PutAsync(upload.GetProperty("fields").GetProperty("key").GetString()!, Tests.Shared.TestImages.JpegWithExif(), "image/jpeg", default);
        return (sessionId, body);
    }

    /// <summary>What the worker leaves behind for one photo: the stripped photo, crops, occurrences and the session's new pieces.</summary>
    private async Task WorkerOutputAsync(string tenant, string sessionId, int index, params (string Ref, ItemCategory Category, string Color, OutfitSlot? Slot, string? MatchItemId, string? PieceId)[] pieces)
    {
        var photo = (await factory.Repository.GetAsync<OutfitImportPhotoEntity>(OutfitImportPhotoEntity.GetPk(tenant), OutfitImportPhotoEntity.GetSk(sessionId, index)))!;
        photo.PhotoKey = StorageKeys.ImportPhoto(tenant, sessionId, index, "jpg");
        await factory.Storage.PutAsync(photo.PhotoKey, [0xFF, 0xD8], "image/jpeg", default);
        photo.Pieces = [];
        var n = 0;
        foreach (var p in pieces)
        {
            var cropKey = StorageKeys.ImportCrop(tenant, sessionId, index, ++n);
            await factory.Storage.PutAsync(cropKey, [0xFF, 0xD8, (byte)n], "image/jpeg", default);
            photo.Pieces.Add(new OutfitImportOccurrence
            {
                Ref = p.Ref, Name = $"{p.Color} {p.Category}", Category = p.Category, ColorIds = [p.Color], Seasons = [Season.Autumn],
                CropKey = cropKey, Confidence = 0.9, Slot = p.Slot, MatchItemId = p.MatchItemId, PieceId = p.PieceId,
            });
            if (p.PieceId is { } pieceId && await factory.Repository.GetAsync<OutfitImportPieceEntity>(OutfitImportPieceEntity.GetPk(tenant), OutfitImportPieceEntity.GetSk(sessionId, pieceId)) is null)
            {
                await factory.Repository.SaveAsync(new OutfitImportPieceEntity
                {
                    Id = pieceId, TenantId = tenant, SessionId = sessionId, FirstRef = p.Ref, Name = $"{p.Color} {p.Category}", Category = p.Category,
                    ColorIds = [p.Color], Seasons = [Season.Autumn], CropKey = cropKey, SeenIn = [index], CreatedAt = DateTime.UtcNow,
                });
            }
            else if (p.PieceId is { } seen)
            {
                var piece = (await factory.Repository.GetAsync<OutfitImportPieceEntity>(OutfitImportPieceEntity.GetPk(tenant), OutfitImportPieceEntity.GetSk(sessionId, seen)))!;
                piece.SeenIn.Add(index);
                await factory.Repository.SaveAsync(piece);
            }
        }
        photo.Status = OutfitImportPhotoStatus.Ready;
        Assert.True(await factory.Repository.SaveIfVersionAsync(photo, photo.Version));
    }

    // ── Plan limit (configuration, per plan) ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task PhotoLimit_FollowsTheCallersPlan_FromConfiguration()
    {
        var (free, _) = await UserAsync();
        var (member, _) = await UserAsync(premium: true);

        Assert.Equal(5, (await (await free.GetAsync("v1/tenant/entitlement")).JsonAsync()).GetProperty("outfitImport").GetProperty("maxPhotos").GetInt32());
        Assert.Equal(12, (await (await member.GetAsync("v1/tenant/entitlement")).JsonAsync()).GetProperty("outfitImport").GetProperty("maxPhotos").GetInt32());

        var tooMany = await free.PostJsonAsync(Url, Create(6));
        Assert.Equal(HttpStatusCode.UnprocessableEntity, tooMany.StatusCode);
        Assert.Equal("outfit_import_too_many_photos", await tooMany.CodeAsync());

        var memberOk = await member.PostJsonAsync(Url, Create(12));
        Assert.Equal(HttpStatusCode.Created, memberOk.StatusCode);
        var body = await memberOk.JsonAsync();
        Assert.Equal(12, body.GetProperty("maxPhotos").GetInt32());
        Assert.Equal(12, body.GetProperty("uploads").GetArrayLength());
        Assert.Equal(JsonValueKind.Null, body.GetProperty("itemRecognition").GetProperty("limit").ValueKind);   // members: unlimited
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await member.PostJsonAsync(Url, Create(13))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await member.PostJsonAsync(Url, new { requestId = "nope", count = 1 })).StatusCode);
    }

    [Fact]
    public async Task FreeUser_GetsSlotsOnlyForTheRecognitionsLeft_LikeBulkAdd()
    {
        var (client, tenant) = await UserAsync();
        var first = await (await client.PostJsonAsync(Url, Create(5))).JsonAsync();

        Assert.Equal(4, first.GetProperty("uploads").GetArrayLength());   // allowance 4
        Assert.Equal(1, first.GetProperty("skipped").GetInt32());
        Assert.Equal(4, first.GetProperty("session").GetProperty("count").GetInt32());
        Assert.Equal(0, first.GetProperty("itemRecognition").GetProperty("remaining").GetInt32());

        var none = await client.PostJsonAsync(Url, Create(1));
        Assert.Equal(HttpStatusCode.PaymentRequired, none.StatusCode);
        Assert.Equal("item_recognition_limit_reached", await none.CodeAsync());

        // Discarding gives the recognitions of unprocessed photos back.
        var id = first.GetProperty("session").GetProperty("id").GetString();
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"{Url}/{id}")).StatusCode);
        Assert.Equal(4, (await (await client.GetAsync("v1/tenant/entitlement")).JsonAsync()).GetProperty("itemRecognition").GetProperty("remaining").GetInt32());
        _ = tenant;
    }

    // ── Session and uploads ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Create_IsIdempotentByRequestId_AndConfirmQueuesEachPhotoOnce()
    {
        var (client, tenant) = await UserAsync(premium: true);
        var requestId = Ulid.New();
        var created = await client.PostJsonAsync(Url, Create(3, requestId));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var body = await created.JsonAsync();
        var keys = body.GetProperty("uploads").EnumerateArray().Select(u => u.GetProperty("fields").GetProperty("key").GetString()!).ToList();
        Assert.Equal(Enumerable.Range(1, 3).Select(i => $"uploads/import/{tenant}/{requestId}/{i}"), keys);

        // Not uploaded yet → 422; uploaded → queued once.
        var missing = await client.PostAsync($"{Url}/{requestId}/photos/1/uploaded", null);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, missing.StatusCode);
        Assert.Equal("upload_missing", await missing.CodeAsync());
        await factory.Storage.PutAsync(keys[0], [0xFF, 0xD8], "image/jpeg", default);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsync($"{Url}/{requestId}/photos/1/uploaded", null)).StatusCode);
        var again = await client.PostAsync($"{Url}/{requestId}/photos/1/uploaded", null);
        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        var session = await again.JsonAsync();
        Assert.Equal(1, session.GetProperty("counters").GetProperty("uploaded").GetInt32());
        Assert.Equal("processing", session.GetProperty("status").GetString());
        Assert.Equal("uploaded", session.GetProperty("photos")[0].GetProperty("status").GetString());
        Assert.Equal([new OutfitImportPhotoRequestedEvent(tenant, requestId, 1)], factory.Events.Of<OutfitImportPhotoRequestedEvent>(tenant));
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsync($"{Url}/{requestId}/photos/9/uploaded", null)).StatusCode);

        // The same requestId: the same session, fresh slots for photos 2 and 3 only.
        var replay = await client.PostJsonAsync(Url, Create(3, requestId));
        Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
        Assert.Equal([2, 3], (await replay.JsonAsync()).GetProperty("uploads").EnumerateArray().Select(u => u.GetProperty("index").GetInt32()));

        // Listed as open; another tenant sees nothing.
        Assert.Single((await (await client.GetAsync(Url)).JsonAsync()).EnumerateArray());
        var (stranger, _) = await UserAsync();
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"{Url}/{requestId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.PostAsync($"{Url}/{requestId}/photos/2/uploaded", null)).StatusCode);
    }

    // ── Review and commit ────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Commit_CreatesKeptNewPiecesOnce_LooksWithCovers_AndCleanupOnlyForNewPieces()
    {
        var (client, tenant) = await UserAsync(premium: true);
        var blazer = await factory.ItemAsync(tenant, ItemCategory.Outerwear, "black");
        var (sessionId, _) = await StartAsync(client, 3);
        for (var i = 1; i <= 3; i++)
            Assert.Equal(HttpStatusCode.OK, (await client.PostAsync($"{Url}/{sessionId}/photos/{i}/uploaded", null)).StatusCode);

        var shirt = Ulid.New();
        var jeans = Ulid.New();
        var shoes = Ulid.New();
        var skirt = Ulid.New();
        // Photo 1: matched blazer + new shirt + new jeans. Photo 2: the same shirt (de-duplicated) + new shoes. Photo 3: new skirt + the same shoes.
        await WorkerOutputAsync(tenant, sessionId, 1, ("1-1", ItemCategory.Outerwear, "black", OutfitSlot.Outerwear, blazer.Id, null),
            ("1-2", ItemCategory.Top, "white", OutfitSlot.Top, null, shirt), ("1-3", ItemCategory.Bottom, "navy", OutfitSlot.Bottom, null, jeans));
        await WorkerOutputAsync(tenant, sessionId, 2, ("2-1", ItemCategory.Top, "white", OutfitSlot.Top, null, shirt), ("2-2", ItemCategory.Shoes, "white", OutfitSlot.Shoes, null, shoes));
        await WorkerOutputAsync(tenant, sessionId, 3, ("3-1", ItemCategory.Bottom, "red", OutfitSlot.Bottom, null, skirt), ("3-2", ItemCategory.Shoes, "white", OutfitSlot.Shoes, null, shoes));

        var review = await (await client.GetAsync($"{Url}/{sessionId}")).JsonAsync();
        Assert.Equal("ready", review.GetProperty("status").GetString());
        Assert.Equal(4, review.GetProperty("newPieceCount").GetInt32());
        Assert.Equal(1, review.GetProperty("matchedPieceCount").GetInt32());
        var first = review.GetProperty("photos")[0].GetProperty("pieces");
        Assert.Equal("match", first[0].GetProperty("kind").GetString());
        Assert.Equal(blazer.Id, first[0].GetProperty("itemId").GetString());
        Assert.Equal("new", first[1].GetProperty("kind").GetString());
        Assert.Equal([2], first[1].GetProperty("alsoIn").EnumerateArray().Select(e => e.GetInt32()));

        // Drop photo 3 as a look and the jeans of photo 1; everything else approved by leaving it out.
        var commit = await client.PostJsonAsync($"{Url}/{sessionId}/commit", new
        {
            looks = new object[] { new { photoIndex = 3, keep = false }, new { photoIndex = 1, keep = true, pieces = new[] { new { @ref = "1-3", keep = false } } } },
        });
        Assert.Equal(HttpStatusCode.OK, commit.StatusCode);
        var result = await commit.JsonAsync();
        Assert.Equal(2, result.GetProperty("createdLookCount").GetInt32());
        Assert.Equal(2, result.GetProperty("createdItemCount").GetInt32());   // shirt (once) + shoes; not the jeans, not the skirt
        Assert.Equal(2, result.GetProperty("cleanupJobCount").GetInt32());

        var items = await factory.Repository.GetAllAsync<ItemEntity>(ItemEntity.GetPk(tenant));
        Assert.Equal(new[] { blazer.Id, shirt, shoes }.Order(), items.Select(i => i.Id).Order());
        var newShirt = items.Single(i => i.Id == shirt);
        Assert.Equal((ItemCategory.Top, true), (newShirt.Category, newShirt.UseOriginalImage));
        Assert.StartsWith(StorageKeys.ImportPrefix(tenant, sessionId), newShirt.OriginalImageKey);

        // Background removal: one job per created item, never for the matched blazer.
        var cleanups = factory.Events.Of<ItemProcessRequestedEvent>(tenant);
        Assert.Equal(new[] { shirt, shoes }.Order(), cleanups.Select(c => c.ItemId!).Order());
        Assert.All(cleanups, c => Assert.True(c.Clean));
        Assert.All(cleanups, c => Assert.True(factory.Storage.Objects.ContainsKey(StorageKeys.Upload(tenant, c.ItemId!))));

        // Looks: photo 1 = blazer + shirt (jeans dropped), photo 2 = shirt + shoes; covers = the photos.
        var looks = (await (await client.GetAsync("v1/tenant/look")).JsonAsync()).EnumerateArray().ToList();
        Assert.Equal(2, looks.Count);
        Assert.All(looks, l => Assert.Equal("import", l.GetProperty("source").GetString()));
        Assert.All(looks, l => Assert.Contains("/import/", l.GetProperty("coverImageUrl").GetString()));
        var look1 = looks.Single(l => l.GetProperty("slots").EnumerateArray().Any(s => s.GetProperty("itemId").GetString() == blazer.Id));
        Assert.Equal(new[] { blazer.Id, shirt }.Order(), look1.GetProperty("slots").EnumerateArray().Select(s => s.GetProperty("itemId").GetString()!).Order());

        // Only what the new items and looks use stays: crops of the shirt and shoes, the covers of photos 1 and 2; originals gone.
        Assert.DoesNotContain(factory.Storage.Objects.Keys, k => k.StartsWith(StorageKeys.ImportUploadPrefix(tenant, sessionId), StringComparison.Ordinal));
        Assert.False(factory.Storage.Objects.ContainsKey(StorageKeys.ImportPhoto(tenant, sessionId, 3, "jpg")));
        Assert.False(factory.Storage.Objects.ContainsKey(StorageKeys.ImportCrop(tenant, sessionId, 1, 3)));   // the dropped jeans
        Assert.True(factory.Storage.Objects.ContainsKey(StorageKeys.ImportPhoto(tenant, sessionId, 1, "jpg")));

        // Replay: the stored result, nothing created twice.
        var replay = await (await client.PostJsonAsync($"{Url}/{sessionId}/commit", new { looks = Array.Empty<object>() })).JsonAsync();
        Assert.Equal(2, replay.GetProperty("createdItemCount").GetInt32());
        Assert.Equal(3, (await factory.Repository.GetAllAsync<ItemEntity>(ItemEntity.GetPk(tenant))).Count);
        Assert.Equal(2, factory.Events.Of<ItemProcessRequestedEvent>(tenant).Count);
        Assert.Equal("committed", (await (await client.GetAsync($"{Url}/{sessionId}")).JsonAsync()).GetProperty("status").GetString());
        Assert.Empty((await (await client.GetAsync(Url)).JsonAsync()).EnumerateArray());   // no longer open

        // Deleting an imported look deletes its cover.
        var coverOf2 = StorageKeys.ImportPhoto(tenant, sessionId, 2, "jpg");
        var look2 = looks.Single(l => l.GetProperty("id").GetString() != look1.GetProperty("id").GetString());
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"v1/tenant/look/{look2.GetProperty("id").GetString()}")).StatusCode);
        Assert.False(factory.Storage.Objects.ContainsKey(coverOf2));
    }

    [Fact]
    public async Task Commit_WhilePhotosAreProcessed_IsRefused_AndUnknownRefsAreInvalid()
    {
        var (client, tenant) = await UserAsync(premium: true);
        var (sessionId, _) = await StartAsync(client, 2);
        await client.PostAsync($"{Url}/{sessionId}/photos/1/uploaded", null);
        await client.PostAsync($"{Url}/{sessionId}/photos/2/uploaded", null);
        await WorkerOutputAsync(tenant, sessionId, 1, ("1-1", ItemCategory.Top, "white", OutfitSlot.Top, null, Ulid.New()), ("1-2", ItemCategory.Shoes, "black", OutfitSlot.Shoes, null, Ulid.New()));

        var early = await client.PostJsonAsync($"{Url}/{sessionId}/commit", new { looks = Array.Empty<object>() });
        Assert.Equal(HttpStatusCode.Conflict, early.StatusCode);
        Assert.Equal("outfit_import_not_ready", await early.CodeAsync());

        await WorkerOutputAsync(tenant, sessionId, 2, ("2-1", ItemCategory.Top, "red", OutfitSlot.Top, null, Ulid.New()));
        var unknown = await client.PostJsonAsync($"{Url}/{sessionId}/commit", new { looks = new[] { new { photoIndex = 1, keep = true, pieces = new[] { new { @ref = "9-9", keep = false } } } } });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, unknown.StatusCode);
        Assert.Equal("outfit_import_unknown_ref", await unknown.CodeAsync());

        // Photo 2 has one piece: its look is skipped (min 2), the piece is still created.
        var result = await (await client.PostJsonAsync($"{Url}/{sessionId}/commit", new { looks = Array.Empty<object>() })).JsonAsync();
        var outcomes = result.GetProperty("looks").EnumerateArray().ToDictionary(l => l.GetProperty("photoIndex").GetInt32(), l => (l.GetProperty("outcome").GetString(), l.GetProperty("code").GetString()));
        Assert.Equal(("created", null), outcomes[1]);
        Assert.Equal(("skipped", "look_min_pieces"), outcomes[2]);
        Assert.Equal(3, result.GetProperty("createdItemCount").GetInt32());
    }

    // ── Discard and account deletion ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Discard_RemovesTheSession_ItsRows_AndItsObjects()
    {
        var (client, tenant) = await UserAsync(premium: true);
        var (sessionId, _) = await StartAsync(client, 2);
        await client.PostAsync($"{Url}/{sessionId}/photos/1/uploaded", null);
        await WorkerOutputAsync(tenant, sessionId, 1, ("1-1", ItemCategory.Top, "white", OutfitSlot.Top, null, Ulid.New()));

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"{Url}/{sessionId}")).StatusCode);

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"{Url}/{sessionId}")).StatusCode);
        Assert.Empty(await factory.Repository.GetAllAsync<OutfitImportPhotoEntity>(OutfitImportPhotoEntity.GetPk(tenant)));
        Assert.Empty(await factory.Repository.GetAllAsync<OutfitImportPieceEntity>(OutfitImportPieceEntity.GetPk(tenant)));
        Assert.Contains(StorageKeys.ImportUploadPrefix(tenant, sessionId), factory.Storage.DeletedPrefixes);
        Assert.Contains(StorageKeys.ImportPrefix(tenant, sessionId), factory.Storage.DeletedPrefixes);
        Assert.Equal(HttpStatusCode.NotFound, (await client.DeleteAsync($"{Url}/{sessionId}")).StatusCode);
        Assert.Empty(await factory.Repository.GetAllAsync<ItemEntity>(ItemEntity.GetPk(tenant)));   // nothing was created
    }

    [Fact]
    public async Task AccountDeletion_RemovesSessions_AndTheImportUploads()
    {
        var (client, tenant) = await UserAsync(premium: true);
        var (sessionId, _) = await StartAsync(client, 1);
        await client.PostAsync($"{Url}/{sessionId}/photos/1/uploaded", null);
        await WorkerOutputAsync(tenant, sessionId, 1, ("1-1", ItemCategory.Top, "white", OutfitSlot.Top, null, Ulid.New()));

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync("v1/auth/me")).StatusCode);

        foreach (var pk in new[] { OutfitImportSessionEntity.GetPk(tenant), OutfitImportPhotoEntity.GetPk(tenant), OutfitImportPieceEntity.GetPk(tenant), OutfitImportLeaseEntity.GetPk(tenant) })
            Assert.DoesNotContain(pk, factory.Repository.PartitionKeys);
        Assert.Contains(StorageKeys.ImportUploadsRoot(tenant), factory.Storage.DeletedPrefixes);
        Assert.Contains(StorageKeys.TenantRoot(tenant), factory.Storage.DeletedPrefixes);
    }
}
