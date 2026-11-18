using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Api.Contracts;
using Domain.Domain;
using Domain.Entity;
using Domain.Enum;
using Domain.Extensions;
using Domain.Services;
using Tests.Shared;

namespace ApiTests;

/// <summary>18+ confirmation (Terms §3, REVIEW §5 G3).</summary>
public class AgeConfirmationEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Register_WithoutTheBox_400_WithIt_TheConfirmationIsStored()
    {
        var client = factory.CreateClient();

        var missing = await client.PostJsonAsync("v1/auth/register", new { name = "Ayşe", email = $"{Guid.NewGuid():N}@example.com", password = "Sifre1234" });
        var unticked = await client.PostJsonAsync("v1/auth/register", new { name = "Ayşe", email = $"{Guid.NewGuid():N}@example.com", password = "Sifre1234", ageConfirmed = false });
        var (registered, _) = await factory.RegisterAsync();
        var profile = (await registered.GetFromJsonAsync<ProfileDto>("v1/tenant/profile", ApiFactory.Json))!;

        foreach (var response in new[] { missing, unticked })
        {
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Contains("age_confirmation_required", await response.Content.ReadAsStringAsync());
        }
        Assert.NotNull(profile.AgeConfirmedAt);
    }

    [Fact]
    public async Task SocialSignIn_StartsUnconfirmed_ConfirmationIsStoredOnce()
    {
        var client = factory.CreateClient();
        var token = $"valid:apple-{Guid.NewGuid():N}:relay@privaterelay.appleid.com";
        var auth = (await (await client.PostJsonAsync("v1/auth/apple", new { identityToken = token, nonce = "n" })).Content.ReadFromJsonAsync<AuthResponse>(ApiFactory.Json))!;
        client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", auth.AccessToken);

        var before = (await client.GetFromJsonAsync<ProfileDto>("v1/tenant/profile", ApiFactory.Json))!;
        var first = (await (await client.PostAsync("v1/tenant/profile/age-confirmation", null)).Content.ReadFromJsonAsync<ProfileDto>(ApiFactory.Json))!;
        await Task.Delay(5);
        var second = (await (await client.PostAsync("v1/tenant/profile/age-confirmation", null)).Content.ReadFromJsonAsync<ProfileDto>(ApiFactory.Json))!;
        var stored = await factory.Repository.GetAsync<UserEntity>(UserEntity.GetPk(), UserEntity.GetSk(auth.UserId));

        Assert.True(auth.IsNewUser);
        Assert.Null(before.AgeConfirmedAt);
        Assert.NotNull(first.AgeConfirmedAt);
        Assert.Equal(first.AgeConfirmedAt, second.AgeConfirmedAt);            // idempotent: the first time is kept
        Assert.Equal(first.AgeConfirmedAt, stored!.AgeConfirmedAt);
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().PostAsync("v1/tenant/profile/age-confirmation", null)).StatusCode);
    }
}

/// <summary>The in-app notification inbox (GET v1/tenant/notification, POST …/read).</summary>
public class NotificationInboxEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private async Task<List<NotificationInboxEntity>> SeedAsync(string tenantId, int count, DateTime newest)
    {
        var rows = new List<NotificationInboxEntity>();
        for (var i = 0; i < count; i++)
        {
            var at = newest.AddMinutes(-i);
            var row = new NotificationInboxEntity
            {
                Id = Ulid.New(at), TenantId = tenantId, Type = NotificationType.MorningOutfit, Key = $"day-{i}", Data = new() { ["day"] = $"2026-11-{19 - i % 10:00}" }, CreatedAt = at,
            };
            await factory.Repository.SaveAsync(row);
            rows.Add(row);
        }
        return rows;
    }

    [Fact]
    public async Task Pages_NewestFirst_WithAStableCursor_AndAnUnreadCount()
    {
        var (client, auth) = await factory.RegisterAsync();
        var now = DateTime.UtcNow;
        var rows = await SeedAsync(auth.TenantId, 5, now);
        await factory.Repository.SaveAsync(new NotificationInboxEntity
        {
            Id = Ulid.New(now.AddDays(-91)), TenantId = auth.TenantId, Type = NotificationType.WeeklyEdit, Key = "old-edit", Data = new() { ["editId"] = "old" }, CreatedAt = now.AddDays(-91),
        }); // past the 90-day TTL, not yet swept by DynamoDB

        var first = await (await client.GetAsync("v1/tenant/notification?limit=2")).JsonAsync();
        // A new event arriving between two pages must not shift the next page.
        await SeedAsync(auth.TenantId, 1, now.AddMinutes(5));
        var second = await (await client.GetAsync($"v1/tenant/notification?limit=2&pageToken={first.GetProperty("pageToken").GetString()}")).JsonAsync();
        var third = await (await client.GetAsync($"v1/tenant/notification?limit=2&pageToken={second.GetProperty("pageToken").GetString()}")).JsonAsync();

        string[] Ids(JsonElement page) => page.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("id").GetString()!).ToArray();
        Assert.Equal([rows[0].Id, rows[1].Id], Ids(first));
        Assert.Equal([rows[2].Id, rows[3].Id], Ids(second));
        Assert.Equal([rows[4].Id], Ids(third));
        Assert.Equal(JsonValueKind.Null, third.GetProperty("pageToken").ValueKind);
        Assert.Equal(5, first.GetProperty("unreadCount").GetInt32());
        var item = first.GetProperty("items")[0];
        Assert.Equal("morning_outfit", item.GetProperty("type").GetString());
        Assert.Equal(JsonValueKind.Null, item.GetProperty("readAt").ValueKind);
        Assert.True(item.GetProperty("data").TryGetProperty("day", out _));
    }

    [Fact]
    public async Task MarkRead_ByIds_ThenAll_Idempotent_TenantIsolated()
    {
        var (client, auth) = await factory.RegisterAsync();
        var (other, otherAuth) = await factory.RegisterAsync();
        var rows = await SeedAsync(auth.TenantId, 3, DateTime.UtcNow);
        var foreign = await SeedAsync(otherAuth.TenantId, 1, DateTime.UtcNow);

        var one = await (await client.PostJsonAsync("v1/tenant/notification/read", new { ids = new[] { rows[0].Id, foreign[0].Id } })).JsonAsync();
        var again = await (await client.PostJsonAsync("v1/tenant/notification/read", new { ids = new[] { rows[0].Id } })).JsonAsync();
        var page = await (await client.GetAsync("v1/tenant/notification")).JsonAsync();
        var all = await (await client.PostJsonAsync("v1/tenant/notification/read", new { ids = (string[]?)null })).JsonAsync();
        var otherPage = await (await other.GetAsync("v1/tenant/notification")).JsonAsync();
        var invalid = await client.PostJsonAsync("v1/tenant/notification/read", new { ids = new[] { "not-a-ulid" } });

        Assert.Equal(2, one.GetProperty("unreadCount").GetInt32());
        Assert.Equal(2, again.GetProperty("unreadCount").GetInt32());
        Assert.NotEqual(JsonValueKind.Null, page.GetProperty("items")[0].GetProperty("readAt").ValueKind);
        Assert.Equal(0, all.GetProperty("unreadCount").GetInt32());
        Assert.Equal(1, otherPage.GetProperty("unreadCount").GetInt32());     // another tenant's id is ignored
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
    }

    [Fact]
    public async Task Inbox_GoesWithTheAccount()
    {
        var (client, auth) = await factory.RegisterAsync();
        await SeedAsync(auth.TenantId, 2, DateTime.UtcNow);

        (await client.DeleteAsync("v1/auth/me")).EnsureSuccessStatusCode();

        Assert.Empty(await factory.Repository.GetKeysAsync(NotificationInboxEntity.GetPk(auth.TenantId)));
    }
}

/// <summary>Profile picture: stored and served apart from the private body / face photos.</summary>
public class AvatarEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private async Task<JsonElement> UploadAvatarAsync(HttpClient client, byte[] bytes, string contentType = "image/jpeg")
    {
        var slot = await (await client.PostJsonAsync("v1/tenant/profile/avatar/upload-url", new { contentType })).JsonAsync();
        await factory.Storage.PutAsync(slot.GetProperty("fields").GetProperty("key").GetString()!, bytes, contentType, default);
        return slot;
    }

    private static Task<HttpResponseMessage> ActivateAsync(HttpClient client, string uploadId) =>
        client.PutJsonAsync("v1/tenant/profile/avatar", new { uploadId, clientMutationId = Ulid.New() });

    [Fact]
    public async Task Upload_Activate_IsStrippedAndStoredUnderItsOwnPrefix_ProfileShowsIt()
    {
        var (client, auth) = await factory.RegisterAsync();

        var slot = await UploadAvatarAsync(client, TestImages.JpegSized(512, 512));
        var put = await ActivateAsync(client, slot.GetProperty("uploadId").GetString()!);
        var profile = (await client.GetFromJsonAsync<ProfileDto>("v1/tenant/profile", ApiFactory.Json))!;

        Assert.StartsWith($"uploads/tmp/{auth.TenantId}/", slot.GetProperty("fields").GetProperty("key").GetString());
        Assert.Equal(1024 * 1024, slot.GetProperty("maxBytes").GetInt64());
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        var stored = Assert.Single(factory.Storage.Objects, o => o.Key.StartsWith($"tenant/{auth.TenantId}/avatar/", StringComparison.Ordinal));
        Assert.False(TestImages.Contains(stored.Value.Data, TestImages.ExifGps));        // EXIF (GPS) stripped
        Assert.DoesNotContain(factory.Storage.Objects.Keys, k => k == slot.GetProperty("fields").GetProperty("key").GetString());
        Assert.NotNull(profile.AvatarUrl);
        Assert.Contains($"tenant/{auth.TenantId}/avatar/", profile.AvatarUrl);
        Assert.NotNull(profile.AvatarUrlExpiresAt);
    }

    [Fact]
    public async Task Avatar_NeverMixesWithBodyOrFacePhotos()
    {
        var (client, auth) = await factory.RegisterAsync();
        // A body photo upload id is not an avatar upload, and an avatar upload id is not a photo upload.
        var photoSlot = await (await client.PostJsonAsync("v1/tenant/photo/upload-url", new { kind = "body", contentType = "image/jpeg" })).JsonAsync();
        await factory.Storage.PutAsync(photoSlot.GetProperty("fields").GetProperty("key").GetString()!, TestImages.JpegSized(400, 600), "image/jpeg", default);
        var photoAsAvatar = await ActivateAsync(client, photoSlot.GetProperty("uploadId").GetString()!);
        var avatarSlot = await UploadAvatarAsync(client, TestImages.JpegSized(512, 512));
        var avatarAsPhoto = await client.PutJsonAsync("v1/tenant/photo/body", new { uploadId = avatarSlot.GetProperty("uploadId").GetString(), clientMutationId = Ulid.New() });
        (await ActivateAsync(client, avatarSlot.GetProperty("uploadId").GetString()!)).EnsureSuccessStatusCode();
        (await client.PutJsonAsync("v1/tenant/photo/body", new { uploadId = photoSlot.GetProperty("uploadId").GetString(), clientMutationId = Ulid.New() })).EnsureSuccessStatusCode();

        var photos = (await client.GetFromJsonAsync<PhotosDto>("v1/tenant/photo", ApiFactory.Json))!;
        // "Delete my photos and generated images" keeps the avatar; deleting the avatar keeps the photos.
        (await client.DeleteAsync("v1/tenant/photo")).EnsureSuccessStatusCode();
        var afterPhotoDelete = (await client.GetFromJsonAsync<ProfileDto>("v1/tenant/profile", ApiFactory.Json))!;

        Assert.Equal((HttpStatusCode.NotFound, "upload_not_found"), (photoAsAvatar.StatusCode, await photoAsAvatar.CodeAsync()));
        Assert.Equal((HttpStatusCode.NotFound, "upload_not_found"), (avatarAsPhoto.StatusCode, await avatarAsPhoto.CodeAsync()));
        Assert.DoesNotContain("/avatar/", photos.Body!.Url);
        Assert.Null(photos.Face);
        Assert.NotNull(afterPhotoDelete.AvatarUrl);
        Assert.NotEqual(StorageKeys.AvatarPrefix(auth.TenantId), StorageKeys.PhotoPrefix(auth.TenantId, PhotoKind.Body));
        Assert.DoesNotContain(DeletionPlan.PhotoS3Prefixes(auth.TenantId), p => StorageKeys.AvatarPrefix(auth.TenantId).StartsWith(p, StringComparison.Ordinal));
        Assert.DoesNotContain(AvatarEntity.GetPk(auth.TenantId), DeletionPlan.PhotoPartitionKeys(auth.TenantId));
    }

    [Fact]
    public async Task Activate_Rejects_TooBigDimensions_NotAnImage_Unknown_And_IsIdempotent()
    {
        var (client, _) = await factory.RegisterAsync();

        var huge = await UploadAvatarAsync(client, TestImages.JpegSized(2048, 1024));
        var hugeResponse = await ActivateAsync(client, huge.GetProperty("uploadId").GetString()!);
        var text = await UploadAvatarAsync(client, "hello"u8.ToArray());
        var textResponse = await ActivateAsync(client, text.GetProperty("uploadId").GetString()!);
        var unknown = await ActivateAsync(client, Ulid.New());
        var gif = await client.PostJsonAsync("v1/tenant/profile/avatar/upload-url", new { contentType = "image/gif" });
        var png = await UploadAvatarAsync(client, TestImages.PngSized(512, 400), "image/png");
        var mutation = Ulid.New();
        var first = await client.PutJsonAsync("v1/tenant/profile/avatar", new { uploadId = png.GetProperty("uploadId").GetString(), clientMutationId = mutation });
        var replay = await client.PutJsonAsync("v1/tenant/profile/avatar", new { uploadId = png.GetProperty("uploadId").GetString(), clientMutationId = mutation });

        Assert.Equal((HttpStatusCode.UnprocessableEntity, "avatar_too_large"), (hugeResponse.StatusCode, await hugeResponse.CodeAsync()));
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "unsupported_image"), (textResponse.StatusCode, await textResponse.CodeAsync()));
        Assert.Equal((HttpStatusCode.NotFound, "upload_not_found"), (unknown.StatusCode, await unknown.CodeAsync()));
        Assert.Equal(HttpStatusCode.BadRequest, gif.StatusCode);
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
    }

    [Fact]
    public async Task Replace_DeletesTheOldObject_Delete_RemovesIt_AnotherTenantsUpload_404()
    {
        var (client, auth) = await factory.RegisterAsync();
        var (other, _) = await factory.RegisterAsync();
        var a = await UploadAvatarAsync(client, TestImages.JpegSized(300, 300));
        (await ActivateAsync(client, a.GetProperty("uploadId").GetString()!)).EnsureSuccessStatusCode();
        var b = await UploadAvatarAsync(client, TestImages.JpegSized(300, 300));
        var stolen = await ActivateAsync(other, b.GetProperty("uploadId").GetString()!);
        (await ActivateAsync(client, b.GetProperty("uploadId").GetString()!)).EnsureSuccessStatusCode();

        var avatarKeys = factory.Storage.Objects.Keys.Where(k => k.StartsWith($"tenant/{auth.TenantId}/avatar/", StringComparison.Ordinal)).ToList();
        var delete = await client.DeleteAsync("v1/tenant/profile/avatar");
        var profile = (await client.GetFromJsonAsync<ProfileDto>("v1/tenant/profile", ApiFactory.Json))!;

        Assert.Equal(HttpStatusCode.NotFound, stolen.StatusCode);
        Assert.Single(avatarKeys);
        Assert.Equal(HttpStatusCode.NoContent, delete.StatusCode);
        Assert.Null(profile.AvatarUrl);
        Assert.Contains(StorageKeys.AvatarPrefix(auth.TenantId), factory.Storage.DeletedPrefixes);
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync("v1/tenant/profile/avatar")).StatusCode);
    }
}

/// <summary>The profile picture is public to whoever may see the closet (decision 7: followers by default), nobody else.</summary>
public class PersonAvatarVisibilityTests(StoreSocialApiFactory factory) : IClassFixture<StoreSocialApiFactory>
{
    private Task SeedAvatarAsync(string tenantId) => factory.Repository.SaveAsync(new AvatarEntity
    {
        Id = Ulid.New(), TenantId = tenantId, S3Key = StorageKeys.Avatar(tenantId, Ulid.New(), "jpg"), ContentType = "image/jpeg", Width = 512, Height = 512, CreatedAt = DateTime.UtcNow,
    });

    [Fact]
    public async Task FollowersOnly_HiddenUntilApproved_Public_Visible_Private_Hidden()
    {
        var owner = await factory.UserAsync(ClosetVisibility.FollowersOnly);
        var open = await factory.UserAsync(ClosetVisibility.Public);
        var closed = await factory.UserAsync(ClosetVisibility.Private);
        var viewer = await factory.UserAsync();
        foreach (var user in new[] { owner, open, closed })
            await SeedAvatarAsync(user.TenantId);

        var before = await (await viewer.Client.GetAsync($"v1/tenant/people/{owner.Handle}")).JsonAsync();
        (await viewer.Client.PostAsync($"v1/tenant/follow/{owner.Handle}", null)).EnsureSuccessStatusCode();
        (await owner.Client.PostAsync($"v1/tenant/follow-request/{viewer.Handle}/approve", null)).EnsureSuccessStatusCode();
        var after = await (await viewer.Client.GetAsync($"v1/tenant/people/{owner.Handle}")).JsonAsync();
        var publicProfile = await (await viewer.Client.GetAsync($"v1/tenant/people/{open.Handle}")).JsonAsync();
        var privateProfile = await (await viewer.Client.GetAsync($"v1/tenant/people/{closed.Handle}")).JsonAsync();
        var self = await (await closed.Client.GetAsync($"v1/tenant/people/{closed.Handle}")).JsonAsync();

        Assert.Equal(JsonValueKind.Null, before.GetProperty("avatarUrl").ValueKind);
        Assert.Contains($"tenant/{owner.TenantId}/avatar/", after.GetProperty("avatarUrl").GetString());
        Assert.Contains($"tenant/{open.TenantId}/avatar/", publicProfile.GetProperty("avatarUrl").GetString());
        Assert.False(privateProfile.TryGetProperty("avatarUrl", out var hidden) && hidden.ValueKind != JsonValueKind.Null, privateProfile.GetRawText());
        Assert.Contains($"tenant/{closed.TenantId}/avatar/", self.GetProperty("avatarUrl").GetString());
    }
}
