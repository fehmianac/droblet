using System.Net;
using Domain.Domain;
using Domain.Entity;
using Domain.Enum;
using Domain.Events;
using Domain.Extensions;
using Domain.Services;
using Microsoft.Extensions.DependencyInjection;
using Tests.Shared;

namespace ApiTests;

/// <summary>
/// "Looklarıma ekle" on an Akış editor post with pieces (owner decision 2026-11-23): POST v1/tenant/feed-post/{id}/look,
/// mode inspiration (photo cover, no pieces) | pieces (the pieces become wardrobe items and a look). No AI is called here.
/// </summary>
public class FeedPostLookEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    internal static byte[] Webp(byte seed) => [.. "RIFF"u8, 20, 0, 0, 0, .. "WEBP"u8, .. "VP8 "u8, seed, 1, 2, 3];

    internal static object Body(string mode, string? requestId = null) => new { mode, requestId = requestId ?? Ulid.New() };

    /// <summary>A live editor post that is one photograph, with the pieces the split found (their pictures in the public catalog bucket).</summary>
    internal static async Task<FeedPostEntity> PostAsync(ApiFactory factory, params (ItemCategory Category, string? Subcategory)[] pieces)
    {
        var now = DateTime.UtcNow;
        var photo = $"https://catalog.test/catalog/feed/{Ulid.New().ToLowerInvariant()}.jpg";
        factory.PublicImages.Images[photo] = TestImages.JpegWithExif();
        var post = new FeedPostEntity
        {
            Id = Ulid.New(), Author = new FeedAuthor { Kind = FeedAuthorKind.Edit, Name = new() { ["tr"] = "Droblet Edit" } }, Occasion = Occasion.Dinner,
            Title = new() { ["tr"] = "Akşam yemeği kombini", ["en"] = "Dinner look" }, ImageUrls = [photo], PublishAt = now.AddMinutes(-1), Published = true,
            CreatedAt = now, UpdatedAt = now,
        };
        for (var i = 0; i < pieces.Length; i++)
        {
            var url = photo.Replace(".jpg", $"-p{i + 1}.webp", StringComparison.Ordinal);
            factory.PublicImages.Images[url] = Webp((byte)(i + 1));
            post.Pieces.Add(new FeedPostPiece { Category = pieces[i].Category, Subcategory = pieces[i].Subcategory, ImageUrl = url });
        }
        await factory.Repository.SaveAsync(post);
        return post;
    }

    private Task<List<ItemEntity>> ItemsAsync(string tenant) => factory.Repository.GetAllAsync<ItemEntity>(ItemEntity.GetPk(tenant));

    private Task<List<LookEntity>> LooksAsync(string tenant) => factory.Repository.GetAllAsync<LookEntity>(LookEntity.GetPk(tenant));

    [Fact]
    public async Task Inspiration_MakesALookWithThePhotoAsCover_NoPieces_NoItems_NoAiCover_NotShareable_SameLookAgain()
    {
        var (client, auth) = await factory.RegisterAsync();
        var tenant = auth.TenantId;
        var post = await PostAsync(factory, (ItemCategory.Top, "shirt"), (ItemCategory.Bottom, null));
        var requestId = Ulid.New();

        var created = await client.PostJsonAsync($"v1/tenant/feed-post/{post.Id}/look", Body("inspiration", requestId));
        var again = await client.PostJsonAsync($"v1/tenant/feed-post/{post.Id}/look", Body("inspiration"));   // another request, the same post + mode

        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var look = await created.ReadAsync<LookDto>();
        Assert.Equal((requestId, "Akşam yemeği kombini", Occasion.Dinner, LookSource.Inspiration), (look.Id, look.Name, look.Occasion, look.Source));
        Assert.Empty(look.Slots);
        Assert.Equal(0, look.PieceCount);
        Assert.False(look.HasMissingPieces);
        Assert.False(look.CoverPending);
        Assert.Contains(StorageKeys.LookPhoto(tenant, requestId, "jpg"), look.CoverImageUrl);
        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        Assert.Equal(requestId, (await again.ReadAsync<LookDto>()).Id);

        var stored = Assert.Single(await LooksAsync(tenant));
        Assert.Equal((post.Id, StorageKeys.LookPhoto(tenant, requestId, "jpg")), (stored.FeedPostId, stored.CoverImageKey));
        var copy = factory.Storage.Objects[stored.CoverImageKey!];
        Assert.Equal("image/jpeg", copy.ContentType);
        Assert.False(TestImages.Contains(copy.Data, TestImages.ExifGps));                       // the member's copy carries no metadata
        Assert.Empty(await ItemsAsync(tenant));                                                 // nothing added to the wardrobe
        Assert.Empty(factory.Events.Of<LookCoverRequestedEvent>(tenant));                       // no AI cover…
        Assert.Null(await factory.Repository.GetAsync<LookCoverEntity>(LookCoverEntity.GetPk(tenant), LookCoverEntity.GetSk(requestId)));
        Assert.False(FeedRules.IsShareable(stored));                                            // …and never shared to Akış
        Assert.False(LookCoverRules.IsEligible(stored));

        // It lists and opens like any look of the owner.
        var listed = Assert.Single((await client.GetAsync<List<LookDto>>("v1/tenant/look"))!);
        Assert.Equal((requestId, LookSource.Inspiration), (listed.Id, listed.Source));
        Assert.NotNull(listed.CoverImageUrl);
        Assert.Equal(requestId, (await client.GetAsync<LookDto>($"v1/tenant/look/{requestId}"))!.Id);
    }

    [Fact]
    public async Task Inspiration_CanBeRenamedAndFavourited_WithoutPieces_Deleted_WithItsPhoto_ThenSavedAnew()
    {
        var (client, auth) = await factory.RegisterAsync();
        var post = await PostAsync(factory, (ItemCategory.Dress, null));
        var look = await (await client.PostJsonAsync($"v1/tenant/feed-post/{post.Id}/look", Body("inspiration"))).ReadAsync<LookDto>();
        var key = StorageKeys.LookPhoto(auth.TenantId, look.Id, "jpg");

        var updated = await client.PutJsonAsync($"v1/tenant/look/{look.Id}", new { name = "İlham", occasion = "office", slots = Array.Empty<object>(), favorite = true, baseVersion = look.Version });
        var deleted = await client.DeleteAsync($"v1/tenant/look/{look.Id}");
        var anew = await client.PostJsonAsync($"v1/tenant/feed-post/{post.Id}/look", Body("inspiration"));

        Assert.Equal(HttpStatusCode.OK, updated.StatusCode);
        var dto = await updated.ReadAsync<LookDto>();
        Assert.Equal(("İlham", true, LookSource.Inspiration, 0), (dto.Name, dto.Favorite, dto.Source, dto.PieceCount));
        Assert.NotNull(dto.CoverImageUrl);
        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
        Assert.False(factory.Storage.Objects.ContainsKey(key));                                 // its photograph goes with it
        Assert.Equal(HttpStatusCode.Created, anew.StatusCode);                                  // the look is gone: a new one
        Assert.NotEqual(look.Id, (await anew.ReadAsync<LookDto>()).Id);
    }

    [Fact]
    public async Task Inspiration_IsTriedOnAsItsPhotograph_NeverPartOfOthersViewOfMyLooks()
    {
        var (client, auth) = await factory.RegisterAsync();
        var tenant = auth.TenantId;
        await factory.PremiumAsync(tenant);
        await factory.PhotoAsync(tenant, PhotoKind.Body);
        var post = await PostAsync(factory, (ItemCategory.Top, null), (ItemCategory.Bottom, null));
        var look = await (await client.PostJsonAsync($"v1/tenant/feed-post/{post.Id}/look", Body("inspiration"))).ReadAsync<LookDto>();

        var start = await client.PostJsonAsync("v1/tenant/tryon", new { requestId = Ulid.New(), target = new { kind = "look", id = look.Id } });

        Assert.Equal(HttpStatusCode.Accepted, start.StatusCode);
        var message = Assert.Single(factory.Events.Of<TryOnRequestedEvent>(tenant));
        Assert.Equal(TryOnTargetKind.Photo, message.Target.Kind);                               // the existing photo try-on path
        var copy = factory.Storage.Objects[StorageKeys.LookPhoto(tenant, look.Id, "jpg")].Data;
        Assert.Equal(TryOnRules.ReferenceHash(copy), message.Target.Id);

        var closet = factory.Services.GetRequiredService<IClosetReader>();
        Assert.Empty(await closet.GetLooksAsync(tenant, default));
        Assert.Null(await closet.GetLookAsync(tenant, look.Id, default));
    }

    [Fact]
    public async Task Pieces_AddEveryPieceToTheWardrobe_AndMakeANormalLookOfThem_CoverRequested_SameLookAgain()
    {
        var (client, auth) = await factory.RegisterAsync();
        var tenant = auth.TenantId;
        // Two bags fight for one slot: the first keeps it, the second is still added to the wardrobe.
        var post = await PostAsync(factory, (ItemCategory.Outerwear, "blazer"), (ItemCategory.Bag, null), (ItemCategory.Shoes, "Not A Valid Id"), (ItemCategory.Bag, "clutch"));
        var requestId = Ulid.New();

        var created = await client.PostJsonAsync($"v1/tenant/feed-post/{post.Id}/look", Body("pieces", requestId));
        var again = await client.PostJsonAsync($"v1/tenant/feed-post/{post.Id}/look", Body("pieces"));

        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var look = await created.ReadAsync<LookDto>();
        Assert.Equal((requestId, "Akşam yemeği kombini", Occasion.Dinner, LookSource.User, 3), (look.Id, look.Name, look.Occasion, look.Source, look.PieceCount));
        Assert.Equal([OutfitSlot.Outerwear, OutfitSlot.Shoes, OutfitSlot.BagAccessory], look.Slots.Select(s => s.Slot));
        Assert.All(look.Slots, s => Assert.False(s.Missing || s.Unavailable));
        Assert.True(look.CoverPending);                                                         // the AI cover of any saved look of own pieces
        Assert.Single(factory.Events.Of<LookCoverRequestedEvent>(tenant));
        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        Assert.Equal(requestId, (await again.ReadAsync<LookDto>()).Id);

        var items = await ItemsAsync(tenant);
        Assert.Equal(4, items.Count);                                                           // and not eight after the second call
        Assert.All(items, i =>
        {
            Assert.Equal(["other"], i.ColorIds);
            Assert.Equal(4, i.Seasons.Count);
            Assert.Equal((null, null, null), (i.Size, i.Brand, i.Fabric));
            Assert.Equal(ItemSource.Photo, i.Source);
            Assert.Equal(StorageKeys.ItemImage(tenant, i.Id), i.ImageKey);                      // a clean picture of its own, in the member's storage
            Assert.False(i.UseOriginalImage);
            Assert.NotNull(i.PublicImageKey);                                                   // published like a confirmed item's
            Assert.Equal("image/webp", factory.Storage.Objects[i.ImageKey!].ContentType);
        });
        var byPiece = post.Pieces.Select((_, n) => items.Single(i => factory.Storage.Objects[i.ImageKey!].Data[16] == n + 1)).ToList();
        Assert.Equal(["blazer", null, null, "clutch"], byPiece.Select(i => i.Subcategory));
        Assert.Equal(["Blazer", "Çanta", "Ayakkabı", "Clutch"], byPiece.Select(i => i.Name));          // the kind, in the request language
        var firstBag = items.Single(i => factory.Storage.Objects[i.ImageKey!].Data[16] == 2);
        Assert.Equal(firstBag.Id, look.Slots.Single(s => s.Slot == OutfitSlot.BagAccessory).ItemId);

        var stored = Assert.Single(await LooksAsync(tenant));
        Assert.Equal(post.Id, stored.FeedPostId);
        Assert.Null(stored.CoverImageKey);
        Assert.True(FeedRules.IsShareable(stored));                                             // a normal own look
        Assert.Equal(4, (await client.GetAsync<List<ItemDto>>("v1/tenant/item"))!.Count);
    }

    [Fact]
    public async Task Pieces_ARetryOfTheSameRequest_CreatesNothingTwice_AndBothModesLiveSideBySide()
    {
        var (client, auth) = await factory.RegisterAsync();
        var post = await PostAsync(factory, (ItemCategory.Top, null), (ItemCategory.Bottom, null));
        var requestId = Ulid.New();

        var first = await client.PostJsonAsync($"v1/tenant/feed-post/{post.Id}/look", Body("pieces", requestId));
        var retry = await client.PostJsonAsync($"v1/tenant/feed-post/{post.Id}/look", Body("pieces", requestId));
        var inspiration = await client.PostJsonAsync($"v1/tenant/feed-post/{post.Id}/look", Body("inspiration"));
        var taken = await client.PostJsonAsync($"v1/tenant/feed-post/{(await PostAsync(factory, (ItemCategory.Top, null), (ItemCategory.Shoes, null))).Id}/look", Body("pieces", requestId));

        Assert.Equal((HttpStatusCode.Created, HttpStatusCode.OK, HttpStatusCode.Created), (first.StatusCode, retry.StatusCode, inspiration.StatusCode));
        Assert.Equal((HttpStatusCode.Conflict, "look_id_taken"), (taken.StatusCode, await taken.CodeAsync()));
        Assert.Equal(2, (await ItemsAsync(auth.TenantId)).Count);
        Assert.Equal(2, (await LooksAsync(auth.TenantId)).Count);
    }

    [Fact]
    public async Task Errors_UnknownOrNotLive404_NoPiecesOrTooFewForALook422_BadBody400_NothingCreated()
    {
        var (client, auth) = await factory.RegisterAsync();
        var plain = await PostAsync(factory);
        var onePiece = await PostAsync(factory, (ItemCategory.Dress, null));
        var twoBags = await PostAsync(factory, (ItemCategory.Bag, null), (ItemCategory.Accessory, null));
        var scheduled = await PostAsync(factory, (ItemCategory.Top, null), (ItemCategory.Bottom, null));
        scheduled.PublishAt = DateTime.UtcNow.AddDays(1);
        await factory.Repository.SaveAsync(scheduled);
        var noPhoto = await PostAsync(factory, (ItemCategory.Top, null), (ItemCategory.Bottom, null));
        factory.PublicImages.Images.TryRemove(noPhoto.ImageUrls[0], out _);
        var unreadablePieces = await PostAsync(factory, (ItemCategory.Top, null), (ItemCategory.Bottom, null));
        factory.PublicImages.Images.TryRemove(unreadablePieces.Pieces[1].ImageUrl, out _);

        async Task<(HttpStatusCode, string?)> Save(string postId, object body)
        {
            var response = await client.PostJsonAsync($"v1/tenant/feed-post/{postId}/look", body);
            return (response.StatusCode, await response.CodeAsync());
        }

        Assert.Equal((HttpStatusCode.NotFound, "not_found"), await Save(Ulid.New(), Body("inspiration")));
        Assert.Equal((HttpStatusCode.NotFound, "not_found"), await Save(scheduled.Id, Body("pieces")));
        Assert.Equal((HttpStatusCode.NotFound, "not_found"), await Save("u_" + Ulid.New(), Body("inspiration")));
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "look_not_savable"), await Save(plain.Id, Body("inspiration")));
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "look_not_savable"), await Save(plain.Id, Body("pieces")));
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "look_not_savable"), await Save(onePiece.Id, Body("pieces")));      // a look needs two pieces
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "look_not_savable"), await Save(twoBags.Id, Body("pieces")));       // …in two slots
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "look_not_savable"), await Save(noPhoto.Id, Body("inspiration")));
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "look_not_savable"), await Save(unreadablePieces.Id, Body("pieces")));
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostJsonAsync($"v1/tenant/feed-post/{onePiece.Id}/look", new { mode = "everything", requestId = Ulid.New() })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostJsonAsync($"v1/tenant/feed-post/{onePiece.Id}/look", new { requestId = Ulid.New() })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostJsonAsync($"v1/tenant/feed-post/{onePiece.Id}/look", new { mode = "pieces", requestId = "nope" })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().PostJsonAsync($"v1/tenant/feed-post/{onePiece.Id}/look", Body("pieces"))).StatusCode);

        Assert.Empty(await ItemsAsync(auth.TenantId));
        Assert.Empty(await LooksAsync(auth.TenantId));
        Assert.DoesNotContain(factory.Storage.Objects.Keys, k => k.StartsWith(StorageKeys.TenantRoot(auth.TenantId), StringComparison.Ordinal));
        Assert.Equal(HttpStatusCode.Created, (await Save(onePiece.Id, Body("inspiration"))).Item1);                           // one piece is enough for an inspiration
    }

    [Fact]
    public async Task CreateLook_NeverAcceptsInspirationAsASourceFromTheApp()
    {
        var (client, auth) = await factory.RegisterAsync();
        var top = await factory.ItemAsync(auth.TenantId, ItemCategory.Top);
        var bottom = await factory.ItemAsync(auth.TenantId, ItemCategory.Bottom);

        var created = await client.PostJsonAsync("v1/tenant/look", new
        {
            id = Ulid.New(), name = "Look", occasion = "office", favorite = false, source = "inspiration",
            slots = new object[] { new { slot = "top", itemId = top.Id }, new { slot = "bottom", itemId = bottom.Id } },
        });

        Assert.Equal(LookSource.User, (await created.ReadAsync<LookDto>()).Source);
    }
}

/// <summary>Teens: "Looklarıma ekle" is editor content like the rest of Akış (open, both modes); the photo try-on of an inspiration look is not theirs.</summary>
public class FeedPostLookTeenEndpointTests(TeenApiFactory factory) : IClassFixture<TeenApiFactory>
{
    [Fact]
    public async Task Teen_SavesBothWays_LikeCreatingALookOrAddingAPiece_ButNeverTriesThePhotographOn()
    {
        var (client, auth, _) = await Teen.RegisterAsync(factory);
        var post = await FeedPostLookEndpointTests.PostAsync(factory, (ItemCategory.Top, null), (ItemCategory.Bottom, null));

        var inspiration = await client.PostJsonAsync($"v1/tenant/feed-post/{post.Id}/look", FeedPostLookEndpointTests.Body("inspiration"));
        var pieces = await client.PostJsonAsync($"v1/tenant/feed-post/{post.Id}/look", FeedPostLookEndpointTests.Body("pieces"));
        var look = await inspiration.ReadAsync<LookDto>();
        var tryOn = await client.PostJsonAsync("v1/tenant/tryon", new { requestId = Ulid.New(), target = new { kind = "look", id = look.Id } });

        Assert.Equal((HttpStatusCode.Created, HttpStatusCode.Created), (inspiration.StatusCode, pieces.StatusCode));
        Assert.Equal(2, (await factory.Repository.GetAllAsync<ItemEntity>(ItemEntity.GetPk(auth.TenantId))).Count);
        Assert.NotEqual(HttpStatusCode.Accepted, tryOn.StatusCode);
        Assert.Empty(factory.Events.Of<TryOnRequestedEvent>(auth.TenantId));
    }
}
