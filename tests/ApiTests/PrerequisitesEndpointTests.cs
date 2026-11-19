using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Domain.Domain;
using Domain.Entity;
using Domain.Enum;
using Domain.Events;
using Domain.Extensions;
using Domain.Options;
using Domain.Services;
using Tests.Shared;

namespace ApiTests;

/// <summary>
/// Canvas 11 "Eksik adım tamamlama" backend: consent 7 (facePhotoTryOn) and the all-in-one consent step, the body type,
/// and the face path of "Üzerimde gör" (owner decisions 1, 2, 4).
/// </summary>
public class PrerequisitesEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string V = ConsentOptions.DefaultVersion;

    private static object Decision(string type, bool granted) => new { type, granted, version = V };

    private static object TryOn(string id) => new { requestId = Ulid.New(), target = new { kind = "look", id } };

    private static async Task<Dictionary<string, JsonElement>> ConsentsAsync(HttpClient client) =>
        (await (await client.GetAsync("v1/tenant/consents")).JsonAsync()).GetProperty("consents").EnumerateArray()
            .ToDictionary(c => c.GetProperty("type").GetString()!, c => c);

    private async Task<LookEntity> LookAsync(string tenantId)
    {
        var top = await factory.ItemAsync(tenantId, ItemCategory.Top);
        var bottom = await factory.ItemAsync(tenantId, ItemCategory.Bottom);
        return await factory.LookAsync(tenantId, (OutfitSlot.Top, top.Id), (OutfitSlot.Bottom, bottom.Id));
    }

    // ── Consents ────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Consents_ListTheNewFaceTryOnType_OnItsOwnVersion()
    {
        var (client, _) = await factory.RegisterAsync(grantConsents: false);

        var consents = await ConsentsAsync(client);

        Assert.Equal(7, consents.Count);
        var face = consents["facePhotoTryOn"];
        Assert.False(face.GetProperty("valid").GetBoolean());
        Assert.Equal(V, face.GetProperty("currentVersion").GetString());
    }

    [Fact]
    public async Task OnboardingStep_RecordsTheUntickedBoxesAsDeclined_ElsewhereNotNowLeavesNoRecord()
    {
        var (client, auth) = await factory.RegisterAsync(grantConsents: false);

        // Elsewhere: "Şimdi değil" on a consent never given is not recorded.
        var notNow = await client.PutJsonAsync("v1/tenant/consents", new { consents = new[] { Decision("contacts", false) }, source = "contacts" });
        Assert.Equal(HttpStatusCode.OK, notNow.StatusCode);
        Assert.Equal(JsonValueKind.Null, (await ConsentsAsync(client))["contacts"].GetProperty("version").ValueKind);

        // The all-in-one step: every box is a decision (partial choice: three ticked, four left unticked).
        var ticked = new[] { "bodyPhotoAi", "facePhotoTryOn", "crossBorderTransfer" };
        var all = Enum.GetValues<ConsentType>().Select(ConsentOptions.Name).ToArray();
        var step = await client.PutJsonAsync("v1/tenant/consents",
            new { consents = all.Select(t => Decision(t, ticked.Contains(t))).ToArray(), source = ConsentRules.OnboardingSource, locale = "tr" });

        Assert.Equal(HttpStatusCode.OK, step.StatusCode);
        var consents = await ConsentsAsync(client);
        Assert.All(consents.Values, c => Assert.Equal(V, c.GetProperty("version").GetString()));      // every purpose decided
        Assert.All(ticked, t => Assert.True(consents[t].GetProperty("valid").GetBoolean()));
        Assert.All(all.Except(ticked), t => Assert.False(consents[t].GetProperty("granted").GetBoolean()));
        Assert.Equal(7, (await factory.Repository.GetKeysAsync(ConsentHistoryEntity.GetPk(auth.TenantId))).Count);
    }

    [Fact]
    public async Task DeletingTheFacePhoto_WithdrawsTheFaceTryOnConsent_AndRemovesFacePathImages()
    {
        var (client, auth) = await factory.RegisterAsync();
        var face = await factory.PhotoAsync(auth.TenantId, PhotoKind.Face);
        var image = new TryOnImageEntity
        {
            Id = Ulid.New(), TenantId = auth.TenantId, BodyPhotoId = TryOnRules.FaceSubjectKey(face.Id, BodyType.Pear, 168, ClothingSize.M),
            Source = TryOnSource.Face, SourcePhotoId = face.Id, TargetKind = TryOnTargetKind.Look, TargetId = "x", CreatedAt = DateTime.UtcNow,
        };
        image.S3Key = $"{StorageKeys.TryOnPrefix(auth.TenantId)}{image.Id}.webp";
        await factory.Repository.SaveAsync(image);

        var delete = await client.DeleteAsync($"v1/tenant/photo/face/{face.Id}");

        Assert.Equal(HttpStatusCode.NoContent, delete.StatusCode);
        Assert.False((await ConsentsAsync(client))["facePhotoTryOn"].GetProperty("valid").GetBoolean());
        Assert.Empty(await factory.Repository.GetAllAsync<TryOnImageEntity>(TryOnImageEntity.GetPk(auth.TenantId)));
    }

    // ── Body type ───────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task BodyProfile_BodyType_IsStored_KeptWhenOmitted_InvalidValueRejected()
    {
        var (client, _) = await factory.RegisterAsync();

        var created = await client.PutJsonAsync("v1/tenant/body-profile", new { heightCm = 168, size = "s", bodyType = "invertedTriangle", baseVersion = 0 });
        var dto = await created.ReadAsync<BodyProfileDto>();
        var omitted = await client.PutJsonAsync("v1/tenant/body-profile", new { heightCm = 170, size = "s", baseVersion = dto.Version });
        var invalid = await client.PutJsonAsync("v1/tenant/body-profile", new { heightCm = 170, size = "s", bodyType = "triangle", baseVersion = 2 });
        var numeric = await client.PutJsonAsync("v1/tenant/body-profile", new { heightCm = 170, size = "s", bodyType = 42, baseVersion = 2 });

        Assert.Equal(HttpStatusCode.OK, created.StatusCode);
        Assert.Equal(BodyType.InvertedTriangle, dto.BodyType);
        Assert.Contains("\"bodyType\":\"invertedTriangle\"", await created.Content.ReadAsStringAsync());
        Assert.Equal((170, BodyType.InvertedTriangle), (await omitted.ReadAsync<BodyProfileDto>()) is var kept ? (kept.HeightCm, kept.BodyType) : default);
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, numeric.StatusCode);
    }

    // ── Face path of "Üzerimde gör" ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task TryOn_NoBodyPhoto_FacePhoto_UsesTheFacePath_WithBodyTypeHeightAndSize()
    {
        var (client, auth) = await factory.RegisterAsync();
        await factory.PremiumAsync(auth.TenantId);
        var face = await factory.PhotoAsync(auth.TenantId, PhotoKind.Face);
        await client.PutJsonAsync("v1/tenant/body-profile", new { heightCm = 164, size = "m", bodyType = "pear", baseVersion = 0 });
        var look = await LookAsync(auth.TenantId);

        var start = await client.PostJsonAsync("v1/tenant/tryon", TryOn(look.Id));
        var again = await client.PostJsonAsync("v1/tenant/tryon", TryOn(look.Id));

        Assert.Equal(HttpStatusCode.Accepted, start.StatusCode);
        Assert.Equal((await start.ReadAsync<TryOnStartDto>()).Job!.Id, (await again.ReadAsync<TryOnStartDto>()).Job!.Id); // cached like any try-on
        var message = Assert.Single(factory.Events.Of<TryOnRequestedEvent>(auth.TenantId));
        Assert.Equal(TryOnSource.Face, message.Source);
        Assert.Equal(face.Id, message.FacePhotoId);
        Assert.Equal((BodyType.Pear, 164, ClothingSize.M), (message.BodyType!.Value, message.HeightCm!.Value, message.Size!.Value));
        Assert.Equal(TryOnRules.FaceSubjectKey(face.Id, BodyType.Pear, 164, ClothingSize.M), message.BodyPhotoId);
        Assert.Equal(29, await factory.CreditsAsync(auth.TenantId));
    }

    [Fact]
    public async Task TryOn_FacePath_ACachedImageCarriesSourceFace_AnotherBodyTypeIsANewImage()
    {
        var (client, auth) = await factory.RegisterAsync();
        await factory.PremiumAsync(auth.TenantId);
        var face = await factory.PhotoAsync(auth.TenantId, PhotoKind.Face);
        await client.PutJsonAsync("v1/tenant/body-profile", new { heightCm = 164, size = "m", bodyType = "pear", baseVersion = 0 });
        var look = await LookAsync(auth.TenantId);
        var target = TryOnFingerprint.Of(look.Slots.Select(s => new OutfitPiece(s.ItemId, s.ProductId)));
        var image = new TryOnImageEntity
        {
            Id = Ulid.New(), TenantId = auth.TenantId, BodyPhotoId = TryOnRules.FaceSubjectKey(face.Id, BodyType.Pear, 164, ClothingSize.M),
            Source = TryOnSource.Face, SourcePhotoId = face.Id, TargetKind = TryOnTargetKind.Look, TargetId = target, CreatedAt = DateTime.UtcNow,
        };
        image.S3Key = $"{StorageKeys.TryOnPrefix(auth.TenantId)}{image.Id}.webp";
        await factory.Repository.SaveAsync(image);

        var cached = await client.PostJsonAsync("v1/tenant/tryon", TryOn(look.Id));
        await client.PutJsonAsync("v1/tenant/body-profile", new { heightCm = 164, size = "m", bodyType = "rectangle", baseVersion = 1 });
        var otherFigure = await client.PostJsonAsync("v1/tenant/tryon", TryOn(look.Id));

        Assert.Equal(HttpStatusCode.OK, cached.StatusCode);
        var dto = await cached.ReadAsync<TryOnStartDto>();
        Assert.Equal((StartStatus.Cached, TryOnSource.Face), (dto.Status, dto.Image!.Source));
        Assert.Contains("\"source\":\"face\"", await cached.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.Accepted, otherFigure.StatusCode);
    }

    [Fact]
    public async Task TryOn_BodyPhotoIsPreferred_OverTheFacePhoto()
    {
        var (client, auth) = await factory.RegisterAsync();
        await factory.PremiumAsync(auth.TenantId);
        var body = await factory.PhotoAsync(auth.TenantId, PhotoKind.Body);
        await factory.PhotoAsync(auth.TenantId, PhotoKind.Face);
        var look = await LookAsync(auth.TenantId);

        var start = await client.PostJsonAsync("v1/tenant/tryon", TryOn(look.Id));

        Assert.Equal(HttpStatusCode.Accepted, start.StatusCode);
        var message = Assert.Single(factory.Events.Of<TryOnRequestedEvent>(auth.TenantId));
        Assert.Equal((TryOnSource.Body, body.Id, (string?)null), (message.Source, message.BodyPhotoId, message.FacePhotoId));
    }

    [Fact]
    public async Task TryOn_FacePath_NeedsTheFaceTryOnConsent_NotTheBodyPhotoOne()
    {
        var (client, auth) = await factory.RegisterAsync(grantConsents: false);
        await factory.PremiumAsync(auth.TenantId);
        await factory.PhotoAsync(auth.TenantId, PhotoKind.Face);
        var look = await LookAsync(auth.TenantId);
        await client.PutJsonAsync("v1/tenant/consents",
            new { consents = new[] { Decision("bodyPhotoAi", true), Decision("crossBorderTransfer", true), Decision("facePhotoPalette", true) }, source = "test" });

        var locked = await client.PostJsonAsync("v1/tenant/tryon", TryOn(look.Id));
        await client.PutJsonAsync("v1/tenant/consents", new { consents = new[] { Decision("facePhotoTryOn", true) }, source = "tryon" });
        var open = await client.PostJsonAsync("v1/tenant/tryon", TryOn(look.Id));

        Assert.Equal((HttpStatusCode.Forbidden, "consent_required"), (locked.StatusCode, await locked.CodeAsync()));
        Assert.Equal(["facePhotoTryOn"], (await locked.JsonAsync()).GetProperty("missing").EnumerateArray().Select(e => e.GetString()!).ToArray());
        Assert.Equal(HttpStatusCode.Accepted, open.StatusCode);
    }

    [Fact]
    public async Task TryOn_NoPhotoAtAll_BodyPhotoRequired()
    {
        var (client, auth) = await factory.RegisterAsync();
        await factory.PremiumAsync(auth.TenantId);
        var look = await LookAsync(auth.TenantId);

        var response = await client.PostJsonAsync("v1/tenant/tryon", TryOn(look.Id));

        Assert.Equal((HttpStatusCode.UnprocessableEntity, "body_photo_required"), (response.StatusCode, await response.CodeAsync()));
    }
}
