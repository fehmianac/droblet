using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Domain.Entity;
using Domain.Enum;
using Domain.Extensions;
using Domain.Options;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Tests.Shared;

namespace ApiTests;

/// <summary>Explicit consents (docs/legal consents 1–6, REVIEW §5 G1/G4/G5): records, audit log, versions, enforcement, withdrawal.</summary>
public class ConsentEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string V = ConsentOptions.DefaultVersion;

    private static object Grant(string type, bool granted = true, string version = V) => new { type, granted, version };

    private static async Task<string[]> MissingAsync(HttpResponseMessage response)
    {
        var json = await response.JsonAsync();
        return json.GetProperty("missing").EnumerateArray().Select(e => e.GetString()!).Order().ToArray();
    }

    private static async Task<Dictionary<string, JsonElement>> ConsentsAsync(HttpClient client) =>
        (await (await client.GetAsync("v1/tenant/consents")).JsonAsync()).GetProperty("consents").EnumerateArray()
            .ToDictionary(c => c.GetProperty("type").GetString()!, c => c);

    [Fact]
    public async Task Get_ListsAllSixTypes_NotGranted_ForANewAccount()
    {
        var (client, _) = await factory.RegisterAsync(grantConsents: false);

        var consents = await ConsentsAsync(client);

        Assert.Equal(["bodyPhotoAi", "contacts", "crossBorderTransfer", "facePhotoPalette", "marketingNotifications", "weight"], consents.Keys.Order().ToArray());
        Assert.All(consents.Values, c =>
        {
            Assert.False(c.GetProperty("granted").GetBoolean());
            Assert.False(c.GetProperty("valid").GetBoolean());
            Assert.Equal(V, c.GetProperty("currentVersion").GetString());
            Assert.Equal(JsonValueKind.Null, c.GetProperty("version").ValueKind);
        });
    }

    [Fact]
    public async Task EveryGatedEndpoint_Answers403ConsentRequired_WithTheMissingTypes()
    {
        var (client, _) = await factory.RegisterAsync(grantConsents: false);

        var body = await client.PostJsonAsync("v1/tenant/photo/upload-url", new { kind = "body", contentType = "image/jpeg" });
        var face = await client.PostJsonAsync("v1/tenant/photo/upload-url", new { kind = "face", contentType = "image/jpeg" });
        var activate = await client.PutJsonAsync("v1/tenant/photo/face", new { uploadId = Ulid.New(), clientMutationId = Ulid.New() });
        var tryOn = await client.PostJsonAsync("v1/tenant/tryon", new { requestId = Ulid.New(), target = new { kind = "item", id = Ulid.New() } });
        var week = await client.PostJsonAsync("v1/tenant/tryon/plan-week", new { requestId = Ulid.New(), weekStart = "2026-11-16", expectedCredits = 1 });
        var palette = await client.PostJsonAsync("v1/tenant/palette/analyze", new { requestId = Ulid.New() });
        var salt = await client.PostAsync("v1/tenant/contacts/salt", null);
        var match = await client.PostJsonAsync("v1/tenant/contacts/match", new { saltId = "s", hashes = new[] { new { p = "ab", h = new string('a', 64) } } });
        var weight = await client.PutJsonAsync("v1/tenant/body-profile", new { heightCm = 168, weightKg = 58.5, size = "m", baseVersion = 0 });
        var weekly = await client.PutJsonAsync("v1/tenant/user/me/notifications",
            new { morningOutfit = true, morningOutfitLocalTime = "07:30", weeklyEdit = true, friendRatings = false, timeZone = "Europe/Istanbul", baseVersion = 0 });
        var priceDrop = await client.PutJsonAsync("v1/tenant/user/me/notifications",
            new { morningOutfit = true, morningOutfitLocalTime = "07:30", weeklyEdit = false, friendRatings = false, timeZone = "Europe/Istanbul", baseVersion = 0, priceDrop = true });

        foreach (var response in new[] { body, face, activate, tryOn, week, palette, salt, match, weight, weekly, priceDrop })
            Assert.Equal((HttpStatusCode.Forbidden, "consent_required"), (response.StatusCode, await response.CodeAsync()));
        Assert.Equal(["bodyPhotoAi", "crossBorderTransfer"], await MissingAsync(body));
        Assert.Equal(["crossBorderTransfer", "facePhotoPalette"], await MissingAsync(face));
        Assert.Equal(["crossBorderTransfer", "facePhotoPalette"], await MissingAsync(activate));
        Assert.Equal(["bodyPhotoAi", "crossBorderTransfer"], await MissingAsync(tryOn));
        Assert.Equal(["bodyPhotoAi", "crossBorderTransfer"], await MissingAsync(week));
        Assert.Equal(["crossBorderTransfer", "facePhotoPalette"], await MissingAsync(palette));
        Assert.Equal(["contacts"], await MissingAsync(salt));
        Assert.Equal(["contacts"], await MissingAsync(match));
        Assert.Equal(["weight"], await MissingAsync(weight));
        Assert.Equal(["marketingNotifications"], await MissingAsync(weekly));
        Assert.Equal(["marketingNotifications"], await MissingAsync(priceDrop));
    }

    [Fact]
    public async Task WithoutTheOptionalParts_TheFeatureStillWorks_WeightAndMarketingAreOptional()
    {
        var (client, _) = await factory.RegisterAsync(grantConsents: false);

        var noWeight = await client.PutJsonAsync("v1/tenant/body-profile", new { heightCm = 168, size = "m", baseVersion = 0 });
        var serviceOnly = await client.PutJsonAsync("v1/tenant/user/me/notifications",
            new { morningOutfit = true, morningOutfitLocalTime = "07:30", weeklyEdit = false, friendRatings = true, timeZone = "Europe/Istanbul", baseVersion = 0, followRequests = true });

        Assert.Equal(HttpStatusCode.OK, noWeight.StatusCode);
        Assert.Equal(HttpStatusCode.OK, serviceOnly.StatusCode);
    }

    [Fact]
    public async Task Granting_RecordsVersionLocaleSource_UnlocksTheFeature_AndAppendsTheAuditLog()
    {
        var (client, auth) = await factory.RegisterAsync(grantConsents: false);

        var put = await client.PutJsonAsync("v1/tenant/consents",
            new { consents = new[] { Grant("bodyPhotoAi"), Grant("crossBorderTransfer") }, source = "tryon", locale = "en" });
        var repeat = await client.PutJsonAsync("v1/tenant/consents", new { consents = new[] { Grant("bodyPhotoAi") }, source = "tryon" });
        var upload = await client.PostJsonAsync("v1/tenant/photo/upload-url", new { kind = "body", contentType = "image/jpeg" });
        var faceStillLocked = await client.PostJsonAsync("v1/tenant/photo/upload-url", new { kind = "face", contentType = "image/jpeg" });
        var consents = await ConsentsAsync(client);
        var history = (await (await client.GetAsync("v1/tenant/consents/history")).JsonAsync()).GetProperty("items");

        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        Assert.Equal(HttpStatusCode.OK, repeat.StatusCode);
        Assert.Equal(HttpStatusCode.OK, upload.StatusCode);
        Assert.Equal(["facePhotoPalette"], await MissingAsync(faceStillLocked)); // cross-border is already given
        var body = consents["bodyPhotoAi"];
        Assert.True(body.GetProperty("valid").GetBoolean());
        Assert.Equal((V, "en", "tryon"), (body.GetProperty("version").GetString(), body.GetProperty("locale").GetString(), body.GetProperty("source").GetString()));
        Assert.NotEqual(JsonValueKind.Null, body.GetProperty("grantedAt").ValueKind);
        Assert.Equal(2, history.GetArrayLength()); // the unchanged repeat is not a new decision
        Assert.Equal(2, (await factory.Repository.GetKeysAsync(ConsentHistoryEntity.GetPk(auth.TenantId))).Count);
    }

    [Fact]
    public async Task GrantOnAnOutdatedText_409_WritesNothing()
    {
        var (client, auth) = await factory.RegisterAsync(grantConsents: false);

        var response = await client.PutJsonAsync("v1/tenant/consents", new { consents = new[] { Grant("weight", version: "2025-01-01") }, source = "weight" });

        Assert.Equal((HttpStatusCode.Conflict, "consent_version_outdated"), (response.StatusCode, await response.CodeAsync()));
        Assert.Empty(await factory.Repository.GetKeysAsync(ConsentHistoryEntity.GetPk(auth.TenantId)));
    }

    [Fact]
    public async Task Validation_UnknownType_EmptyList_BadSource_400()
    {
        var (client, _) = await factory.RegisterAsync(grantConsents: false);

        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutJsonAsync("v1/tenant/consents", new { consents = Array.Empty<object>() })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutJsonAsync("v1/tenant/consents", new { consents = new[] { new { type = "biometrics", granted = true, version = V } } })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutJsonAsync("v1/tenant/consents", new { consents = new[] { Grant("weight") }, source = "Not Snake" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutJsonAsync("v1/tenant/consents", new { consents = new[] { new { type = "weight", granted = true } } })).StatusCode);
    }

    [Fact]
    public async Task ANewTextVersion_InvalidatesTheOldConsent_AndThePromptComesBack()
    {
        var (client, auth) = await factory.RegisterAsync(grantConsents: false);
        (await client.PutJsonAsync("v1/tenant/consents", new { consents = new[] { Grant("contacts") }, source = "contacts" })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsync("v1/tenant/contacts/salt", null)).StatusCode);

        // Publishing a new contacts text = a new version in config.
        using var updated = factory.WithWebHostBuilder(b => b.UseSetting("Consents:Versions:contacts", "2027-02-01"));
        var newClient = updated.CreateClient();
        newClient.DefaultRequestHeaders.Authorization = client.DefaultRequestHeaders.Authorization;

        var salt = await newClient.PostAsync("v1/tenant/contacts/salt", null);
        var contacts = (await ConsentsAsync(newClient))["contacts"];

        Assert.Equal((HttpStatusCode.Forbidden, "consent_required"), (salt.StatusCode, await salt.CodeAsync()));
        Assert.Equal((true, false, V, "2027-02-01"), (contacts.GetProperty("granted").GetBoolean(), contacts.GetProperty("valid").GetBoolean(),
            contacts.GetProperty("version").GetString(), contacts.GetProperty("currentVersion").GetString()));
        Assert.Single(await factory.Repository.GetKeysAsync(ConsentHistoryEntity.GetPk(auth.TenantId)));
    }

    [Fact]
    public async Task WithdrawingMarketing_SwitchesTheMarketingPushesOff_ServiceOnesStay()
    {
        var (client, auth) = await factory.RegisterAsync(grantConsents: false);
        (await client.PutJsonAsync("v1/tenant/consents", new { consents = new[] { Grant("marketingNotifications") }, source = "marketing_card" })).EnsureSuccessStatusCode();
        (await client.PutJsonAsync("v1/tenant/user/me/notifications",
            new { morningOutfit = true, morningOutfitLocalTime = "07:30", weeklyEdit = true, friendRatings = false, timeZone = "Europe/Istanbul", baseVersion = 0, priceDrop = true }))
            .EnsureSuccessStatusCode();
        Assert.NotNull(await factory.Repository.GetAsync<NotificationSubscriberEntity>(NotificationSubscriberEntity.GetPk(NotificationType.WeeklyEdit), NotificationSubscriberEntity.GetSk(auth.TenantId)));

        var withdraw = await client.PutJsonAsync("v1/tenant/consents", new { consents = new[] { new { type = "marketingNotifications", granted = false } }, source = "settings" });
        var prefs = await (await client.GetAsync("v1/tenant/user/me/notifications")).JsonAsync();
        var marketing = (await ConsentsAsync(client))["marketingNotifications"];

        Assert.Equal(HttpStatusCode.OK, withdraw.StatusCode);
        Assert.Equal((true, false, false), (prefs.GetProperty("morningOutfit").GetBoolean(), prefs.GetProperty("weeklyEdit").GetBoolean(), prefs.GetProperty("priceDrop").GetBoolean()));
        Assert.False(marketing.GetProperty("granted").GetBoolean());
        Assert.NotEqual(JsonValueKind.Null, marketing.GetProperty("withdrawnAt").ValueKind);
        Assert.NotEqual(JsonValueKind.Null, marketing.GetProperty("grantedAt").ValueKind); // the settings list shows both dates
        Assert.Null(await factory.Repository.GetAsync<NotificationSubscriberEntity>(NotificationSubscriberEntity.GetPk(NotificationType.WeeklyEdit), NotificationSubscriberEntity.GetSk(auth.TenantId)));
        Assert.Null(await factory.Repository.GetAsync<NotificationSubscriberEntity>(NotificationSubscriberEntity.GetPk(NotificationType.PriceDrop), NotificationSubscriberEntity.GetSk(auth.TenantId)));
        Assert.NotNull(await factory.Repository.GetAsync<ReminderSlotEntity>(ReminderSlotEntity.GetPk("07:30"), ReminderSlotEntity.GetSk(auth.TenantId)));
        Assert.Equal(2, (await (await client.GetAsync("v1/tenant/consents/history")).JsonAsync()).GetProperty("items").GetArrayLength());
    }

    [Fact]
    public async Task ALegacyWeeklyEditSwitch_WithoutConsent_ReadsAsOff()
    {
        var (client, auth) = await factory.RegisterAsync(grantConsents: false);
        await factory.Repository.SaveAsync(new NotificationPrefEntity
        {
            TenantId = auth.TenantId, UserId = auth.UserId, MorningOutfit = true, WeeklyEdit = true, PriceDrop = true, Version = 1, UpdatedAt = DateTime.UtcNow,
        });

        var prefs = await (await client.GetAsync("v1/tenant/user/me/notifications")).JsonAsync();

        Assert.Equal((true, false, false), (prefs.GetProperty("morningOutfit").GetBoolean(), prefs.GetProperty("weeklyEdit").GetBoolean(), prefs.GetProperty("priceDrop").GetBoolean()));
    }

    [Fact]
    public async Task WithdrawingWeight_ClearsTheStoredWeight_AndLocksTheField()
    {
        var (client, _) = await factory.RegisterAsync(grantConsents: false);
        (await client.PutJsonAsync("v1/tenant/consents", new { consents = new[] { Grant("weight") }, source = "weight" })).EnsureSuccessStatusCode();
        (await client.PutJsonAsync("v1/tenant/body-profile", new { heightCm = 168, weightKg = 58.5, size = "m", baseVersion = 0 })).EnsureSuccessStatusCode();

        (await client.PutJsonAsync("v1/tenant/consents", new { consents = new[] { new { type = "weight", granted = false } }, source = "settings" })).EnsureSuccessStatusCode();
        var body = await (await client.GetAsync("v1/tenant/body-profile")).JsonAsync();
        var again = await client.PutJsonAsync("v1/tenant/body-profile", new { heightCm = 168, weightKg = 60, size = "m", baseVersion = body.GetProperty("version").GetInt64() });

        Assert.Equal(JsonValueKind.Null, body.GetProperty("weightKg").ValueKind);
        Assert.Equal(168, body.GetProperty("heightCm").GetInt32());
        Assert.Equal((HttpStatusCode.Forbidden, "consent_required"), (again.StatusCode, await again.CodeAsync()));
    }

    [Fact]
    public async Task DeletingAPhoto_CountsAsWithdrawingItsConsent()
    {
        var (client, _) = await factory.RegisterAsync(grantConsents: false);
        (await client.PutJsonAsync("v1/tenant/consents",
            new { consents = new[] { Grant("bodyPhotoAi"), Grant("facePhotoPalette"), Grant("crossBorderTransfer") }, source = "body_photo" })).EnsureSuccessStatusCode();
        var slot = await (await client.PostJsonAsync("v1/tenant/photo/upload-url", new { kind = "body", contentType = "image/jpeg" })).JsonAsync();
        await factory.Storage.PutAsync(slot.GetProperty("fields").GetProperty("key").GetString()!, TestImages.JpegWithExif(), "image/jpeg", default);
        var photo = await (await client.PutJsonAsync("v1/tenant/photo/body", new { uploadId = slot.GetProperty("uploadId").GetString(), clientMutationId = Ulid.New() })).JsonAsync();

        (await client.DeleteAsync($"v1/tenant/photo/body/{photo.GetProperty("id").GetString()}")).EnsureSuccessStatusCode();
        var consents = await ConsentsAsync(client);
        var reupload = await client.PostJsonAsync("v1/tenant/photo/upload-url", new { kind = "body", contentType = "image/jpeg" });

        Assert.False(consents["bodyPhotoAi"].GetProperty("granted").GetBoolean());
        Assert.Equal("photo_deleted", consents["bodyPhotoAi"].GetProperty("source").GetString());
        Assert.True(consents["facePhotoPalette"].GetProperty("valid").GetBoolean());      // the other photo's consent is untouched
        Assert.True(consents["crossBorderTransfer"].GetProperty("valid").GetBoolean());
        Assert.Equal(["bodyPhotoAi"], await MissingAsync(reupload));
    }

    [Fact]
    public async Task Consents_AreTenantScoped_AndGoWithTheAccount()
    {
        var (alice, aliceAuth) = await factory.RegisterAsync(grantConsents: false);
        var (bob, _) = await factory.RegisterAsync(grantConsents: false);
        (await alice.PutJsonAsync("v1/tenant/consents", new { consents = new[] { Grant("contacts") }, source = "contacts" })).EnsureSuccessStatusCode();

        var bobSalt = await bob.PostAsync("v1/tenant/contacts/salt", null);
        var delete = await alice.DeleteAsync("v1/auth/me");

        Assert.Equal(HttpStatusCode.Forbidden, bobSalt.StatusCode);
        Assert.True(delete.IsSuccessStatusCode);
        Assert.Empty(await factory.Repository.GetKeysAsync(ConsentEntity.GetPk(aliceAuth.TenantId)));
        Assert.Empty(await factory.Repository.GetKeysAsync(ConsentHistoryEntity.GetPk(aliceAuth.TenantId)));
    }
}
