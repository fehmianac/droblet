using System.Net;
using Domain.Domain;
using Domain.Entity;
using Domain.Enum;
using Domain.Events;
using Domain.Extensions;
using Domain.Services;
using Domain.Services.Styling;

namespace ApiTests;

/// <summary>AI flat-lay look cover, Api side (canvas 21c, owner decision 2026-11-22): queueing rules and the DTO's cover fields.</summary>
public class LookCoverEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static object Slot(string slot, string? itemId = null, string? productId = null) => new { slot, itemId, productId };

    private static object Body(string id, string name, params object[] slots) => new { id, name, occasion = "office", slots, favorite = false, source = "builder" };

    private static object Update(string name, long baseVersion, bool favorite, params object[] slots) =>
        new { name, occasion = "dinner", slots, favorite, baseVersion };

    private async Task<(HttpClient Client, string Tenant, ItemEntity Top, ItemEntity Bottom, ItemEntity Shoes)> ArrangeAsync()
    {
        var (client, auth) = await factory.RegisterAsync();
        return (client, auth.TenantId, await factory.ItemAsync(auth.TenantId, ItemCategory.Top), await factory.ItemAsync(auth.TenantId, ItemCategory.Bottom),
            await factory.ItemAsync(auth.TenantId, ItemCategory.Shoes));
    }

    private Task<LookCoverEntity?> CoverAsync(string tenant, string lookId) =>
        factory.Repository.GetAsync<LookCoverEntity>(LookCoverEntity.GetPk(tenant), LookCoverEntity.GetSk(lookId));

    private IReadOnlyList<LookCoverRequestedEvent> Queued(string tenant) => factory.Events.Of<LookCoverRequestedEvent>(tenant);

    /// <summary>What the worker writes when the image is ready.</summary>
    private async Task<string> MarkReadyAsync(string tenant, string lookId)
    {
        var cover = (await CoverAsync(tenant, lookId))!;
        cover.Status = LookCoverStatus.Ready;
        cover.ImageKey = StorageKeys.LookCover(tenant, lookId, cover.SlotsHash);
        cover.ImageHash = cover.SlotsHash;
        await factory.Storage.PutAsync(cover.ImageKey, [9], "image/webp", default);
        await factory.Repository.SaveIfVersionAsync(cover, cover.Version);
        return cover.ImageKey;
    }

    [Fact]
    public async Task Create_QueuesOneCoverJob_ForThePieces_NoCredit_AndReportsItPending()
    {
        var (client, tenant, top, bottom, _) = await ArrangeAsync();
        var id = Ulid.New();
        var body = Body(id, "Ofis", Slot("top", top.Id), Slot("bottom", bottom.Id));

        var created = await client.PostJsonAsync("v1/tenant/look", body);
        var replay = await client.PostJsonAsync("v1/tenant/look", body);

        var look = await created.ReadAsync<LookDto>();
        var queued = Assert.Single(Queued(tenant));
        Assert.Equal((id, JobKind.LookCover), (queued.LookId, queued.Kind));
        Assert.Equal(LookCoverRules.SlotsHash([new LookSlotValue { Slot = OutfitSlot.Top, ItemId = top.Id }, new LookSlotValue { Slot = OutfitSlot.Bottom, ItemId = bottom.Id }]),
            queued.SlotsHash);
        var job = (await factory.Repository.GetAsync<JobEntity>(JobEntity.GetPk(tenant), JobEntity.GetSk(queued.JobId)))!;
        Assert.Equal((JobKind.LookCover, JobStatus.Queued, null), (job.Kind, job.Status, job.CreditIdempotencyKey));
        Assert.True(look.CoverPending);
        Assert.Null(look.CoverImageUrl);
        Assert.Equal(1L, look.Version);
        Assert.True((await replay.ReadAsync<LookDto>()).CoverPending);
        Assert.True((await client.GetAsync<LookDto>($"v1/tenant/look/{id}"))!.CoverPending);
        Assert.Equal((LookCoverStatus.Pending, queued.JobId), ((await CoverAsync(tenant, id))!.Status, (await CoverAsync(tenant, id))!.JobId));
    }

    [Fact]
    public async Task Update_NameOccasionFavourite_NeverQueuesAgain_PiecesChange_QueuesANewOne()
    {
        var (client, tenant, top, bottom, shoes) = await ArrangeAsync();
        var id = Ulid.New();
        await client.PostJsonAsync("v1/tenant/look", Body(id, "Ofis", Slot("top", top.Id), Slot("bottom", bottom.Id)));
        await MarkReadyAsync(tenant, id);

        // Same pieces in another order, other name / occasion / favourite: no new cover.
        var renamed = await client.PutJsonAsync($"v1/tenant/look/{id}", Update("Akşam", 1, true, Slot("bottom", bottom.Id), Slot("top", top.Id)));
        var renamedDto = await renamed.ReadAsync<LookDto>();
        Assert.Equal(HttpStatusCode.OK, renamed.StatusCode);
        Assert.Single(Queued(tenant));
        Assert.NotNull(renamedDto.CoverImageUrl);
        Assert.False(renamedDto.CoverPending);

        var changed = await client.PutJsonAsync($"v1/tenant/look/{id}", Update("Akşam", 2, true, Slot("top", top.Id), Slot("bottom", bottom.Id), Slot("shoes", shoes.Id)));
        var changedDto = await changed.ReadAsync<LookDto>();

        Assert.Equal(2, Queued(tenant).Count);
        Assert.NotEqual(Queued(tenant)[0].SlotsHash, Queued(tenant)[1].SlotsHash);
        Assert.Null(changedDto.CoverImageUrl);   // the old pieces' image is never shown for the new pieces
        Assert.True(changedDto.CoverPending);
        Assert.Equal(3L, changedDto.Version);     // only the user's own saves move the look's version
    }

    [Fact]
    public async Task Update_BackToPiecesWhoseImageIsKept_ReusesIt_WithoutAJob()
    {
        var (client, tenant, top, bottom, shoes) = await ArrangeAsync();
        var id = Ulid.New();
        await client.PostJsonAsync("v1/tenant/look", Body(id, "Ofis", Slot("top", top.Id), Slot("bottom", bottom.Id)));
        var key = await MarkReadyAsync(tenant, id);
        await client.PutJsonAsync($"v1/tenant/look/{id}", Update("Ofis", 1, false, Slot("top", top.Id), Slot("bottom", bottom.Id), Slot("shoes", shoes.Id)));

        var back = await (await client.PutJsonAsync($"v1/tenant/look/{id}", Update("Ofis", 2, false, Slot("top", top.Id), Slot("bottom", bottom.Id)))).ReadAsync<LookDto>();

        Assert.Equal(2, Queued(tenant).Count);
        Assert.Contains(key, back.CoverImageUrl);
        Assert.Equal(LookCoverStatus.Ready, (await CoverAsync(tenant, id))!.Status);
    }

    [Fact]
    public async Task FailedCover_IsTriedOnceMore_OnTheNextSave_ThenNotAgain_ForTheSamePieces()
    {
        var (client, tenant, top, bottom, _) = await ArrangeAsync();
        var id = Ulid.New();
        await client.PostJsonAsync("v1/tenant/look", Body(id, "Ofis", Slot("top", top.Id), Slot("bottom", bottom.Id)));
        await FailAsync(tenant, id);

        // A rename (same pieces) is the next save: the failed cover is tried once more and reported as pending.
        var retried = await (await client.PutJsonAsync($"v1/tenant/look/{id}", Update("Yeni ad", 1, true, Slot("top", top.Id), Slot("bottom", bottom.Id)))).ReadAsync<LookDto>();
        Assert.Equal(2, Queued(tenant).Count);
        Assert.True(retried.CoverPending);
        Assert.Equal(2, (await CoverAsync(tenant, id))!.Attempts);

        // The retry failed too: no third request for these pieces, and nothing pending.
        await FailAsync(tenant, id);
        var again = await (await client.PutJsonAsync($"v1/tenant/look/{id}", Update("Üçüncü ad", 2, true, Slot("top", top.Id), Slot("bottom", bottom.Id)))).ReadAsync<LookDto>();
        Assert.Equal(2, Queued(tenant).Count);
        Assert.False(again.CoverPending);
        Assert.Null(again.CoverImageUrl);
    }

    private async Task FailAsync(string tenant, string lookId)
    {
        var cover = (await CoverAsync(tenant, lookId))!;
        cover.Status = LookCoverStatus.Failed;
        await factory.Repository.SaveIfVersionAsync(cover, cover.Version);
    }

    [Fact]
    public async Task Get_ReadyCover_IsAPresignedUrl_OnTheListAndTheDetail_StalePendingIsNotPending()
    {
        var (client, tenant, top, bottom, shoes) = await ArrangeAsync();
        var ready = Ulid.New();
        var stuck = Ulid.New();
        await client.PostJsonAsync("v1/tenant/look", Body(ready, "A", Slot("top", top.Id), Slot("bottom", bottom.Id)));
        await client.PostJsonAsync("v1/tenant/look", Body(stuck, "B", Slot("top", top.Id), Slot("shoes", shoes.Id)));
        var key = await MarkReadyAsync(tenant, ready);
        var old = (await CoverAsync(tenant, stuck))!;
        old.RequestedAt = DateTime.UtcNow - LookCoverRules.PendingTimeout - TimeSpan.FromMinutes(1);
        await factory.Repository.SaveIfVersionAsync(old, old.Version);

        var list = (await client.GetAsync<List<LookDto>>("v1/tenant/look"))!;
        var detail = (await client.GetAsync<LookDto>($"v1/tenant/look/{ready}"))!;

        Assert.StartsWith($"https://s3.test/bucket/{key}", list.Single(l => l.Id == ready).CoverImageUrl);
        Assert.NotNull(list.Single(l => l.Id == ready).CoverImageUrlExpiresAt);
        Assert.False(list.Single(l => l.Id == ready).CoverPending);
        Assert.StartsWith($"https://s3.test/bucket/{key}", detail.CoverImageUrl);
        Assert.Equal((null, false), (list.Single(l => l.Id == stuck).CoverImageUrl, list.Single(l => l.Id == stuck).CoverPending));
    }

    [Fact]
    public async Task Delete_RemovesTheCoverRowAndItsImage()
    {
        var (client, tenant, top, bottom, _) = await ArrangeAsync();
        var id = Ulid.New();
        await client.PostJsonAsync("v1/tenant/look", Body(id, "Ofis", Slot("top", top.Id), Slot("bottom", bottom.Id)));
        var key = await MarkReadyAsync(tenant, id);

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"v1/tenant/look/{id}")).StatusCode);

        Assert.Null(await CoverAsync(tenant, id));
        Assert.False(factory.Storage.Objects.ContainsKey(key));
    }

    [Fact]
    public async Task ImportedLook_NeverGetsAnAiCover_ItsOwnPhotoIsTheCover()
    {
        var (client, tenant, top, bottom, shoes) = await ArrangeAsync();
        var photoKey = StorageKeys.ImportPhoto(tenant, Ulid.New(), 0, "jpg");
        var look = new LookEntity
        {
            Id = Ulid.New(), TenantId = tenant, Source = LookSource.Import, CoverImageKey = photoKey, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
            Slots = [new LookSlotValue { Slot = OutfitSlot.Top, ItemId = top.Id }, new LookSlotValue { Slot = OutfitSlot.Bottom, ItemId = bottom.Id }],
        };
        await factory.Repository.SaveIfVersionAsync(look, 0);

        var updated = await (await client.PutJsonAsync($"v1/tenant/look/{look.Id}",
            Update("İçe aktarılan", 1, false, Slot("top", top.Id), Slot("bottom", bottom.Id), Slot("shoes", shoes.Id)))).ReadAsync<LookDto>();

        Assert.Empty(Queued(tenant));
        Assert.Null(await CoverAsync(tenant, look.Id));
        Assert.StartsWith($"https://s3.test/bucket/{photoKey}", updated.CoverImageUrl);
        Assert.False(updated.CoverPending);
    }

    [Fact]
    public async Task AcceptSuggestion_QueuesTheNewLooksCover_OnceEvenOnReplay()
    {
        var (client, tenant, top, bottom, shoes) = await ArrangeAsync();
        await factory.PremiumAsync(tenant);
        var job = await factory.CompletedJobAsync(tenant, JobKind.StylistOutfit, new OutfitResult("2026-11-18", Occasion.Office, true, null,
        [
            new SuggestedOutfit(0, "Sakin Ofis", "Kısa not.", "model",
                [new SlotRef(OutfitSlot.Top, top.Id), new SlotRef(OutfitSlot.Bottom, bottom.Id), new SlotRef(OutfitSlot.Shoes, shoes.Id)], []),
        ], "tr"));
        var body = new { clientMutationId = Ulid.New() };

        var accepted = await (await client.PostJsonAsync($"v1/tenant/stylist/suggestion/{job.Id}/0/accept", body)).ReadAsync<AcceptedSuggestionDto>();
        await client.PostJsonAsync($"v1/tenant/stylist/suggestion/{job.Id}/0/accept", body);

        var queued = Assert.Single(Queued(tenant));
        Assert.Equal(accepted.Look.Id, queued.LookId);
        Assert.True(accepted.Look.CoverPending);
    }

    [Fact]
    public async Task AcceptWeek_QueuesACoverForEveryNewLook_OnceEvenOnReplay()
    {
        var (client, tenant, top, bottom, shoes) = await ArrangeAsync();
        await factory.PremiumAsync(tenant);
        var outfit = new SuggestedOutfit(0, "Sakin Ofis", "Kısa not.", "model",
            [new SlotRef(OutfitSlot.Top, top.Id), new SlotRef(OutfitSlot.Bottom, bottom.Id), new SlotRef(OutfitSlot.Shoes, shoes.Id)], []);
        var job = await factory.CompletedJobAsync(tenant, JobKind.StylistWeek, new WeekResult("2026-11-16", null,
            [new WeekDayPlan("2026-11-16", Occasion.Office, outfit), new WeekDayPlan("2026-11-17", Occasion.Dinner, outfit with { Index = 1 }), new WeekDayPlan("2026-11-18", null, null)], "tr"));
        var body = new { clientMutationId = Ulid.New() };

        var accepted = await (await client.PostJsonAsync($"v1/tenant/stylist/week/{job.Id}/accept", body)).ReadAsync<AcceptedWeekDto>();
        await client.PostJsonAsync($"v1/tenant/stylist/week/{job.Id}/accept", body);

        var lookIds = accepted.Days.Select(d => d.Look!.Id).Order(StringComparer.Ordinal).ToList();
        Assert.Equal(2, lookIds.Count);
        Assert.Equal(lookIds, Queued(tenant).Select(q => q.LookId).Order(StringComparer.Ordinal));
    }

    [Fact]
    public async Task PublishFails_TheLookIsSaved_AndTheCoverIsNotLeftPending()
    {
        var (client, tenant, top, bottom, _) = await ArrangeAsync();
        var id = Ulid.New();
        factory.Events.FailNext = true;

        var created = await client.PostJsonAsync("v1/tenant/look", Body(id, "Ofis", Slot("top", top.Id), Slot("bottom", bottom.Id)));

        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.False((await created.ReadAsync<LookDto>()).CoverPending);
        Assert.Equal(LookCoverStatus.Failed, (await CoverAsync(tenant, id))!.Status);
    }
}
