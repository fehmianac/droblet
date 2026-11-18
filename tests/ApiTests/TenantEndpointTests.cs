using System.Net;
using System.Net.Http.Json;
using Api.Contracts;
using Domain.Domain;
using Domain.Entity;
using Domain.Enum;
using Domain.Extensions;
using Domain.Services;
using Tests.Shared;

namespace ApiTests;

public class ProfileEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task GetProfile_ReturnsOwnProfileWithFollowersOnlyDefault()
    {
        var email = $"{Guid.NewGuid():N}@example.com";
        var (client, auth) = await factory.RegisterAsync(email);

        var profile = await client.GetFromJsonAsync<ProfileDto>("v1/tenant/profile", ApiFactory.Json);

        Assert.Equal(auth.TenantId, profile!.TenantId);
        Assert.Equal("Ayşe", profile.DisplayName);
        Assert.Equal(email, profile.Email);
        Assert.Equal(ClosetVisibility.FollowersOnly, profile.ClosetVisibility);
        Assert.Equal(1, profile.Version);
    }

    [Fact]
    public async Task PutProfile_WithCurrentVersion_Updates_StaleVersion409WithCurrent()
    {
        var (client, _) = await factory.RegisterAsync();

        var ok = await client.PutJsonAsync("v1/tenant/profile", new { displayName = "Ayşe Y.", language = "en", cityId = "istanbul", baseVersion = 1 });
        var stale = await client.PutJsonAsync("v1/tenant/profile", new { displayName = "Other", language = "tr", baseVersion = 1 });

        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        var current = await stale.Content.ReadFromJsonAsync<ProfileDto>(ApiFactory.Json);
        Assert.Equal("Ayşe Y.", current!.DisplayName);
        Assert.Equal(2, current.Version);
    }

    [Fact]
    public async Task PutProfile_UnsupportedLanguage_400()
    {
        var (client, _) = await factory.RegisterAsync();

        var response = await client.PutJsonAsync("v1/tenant/profile", new { displayName = "A", language = "de", baseVersion = 1 });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task PutHandle_ClaimChangeAndConflict()
    {
        var (alice, _) = await factory.RegisterAsync();
        var (bob, _) = await factory.RegisterAsync();
        var handle = $"ayse{Guid.NewGuid():N}"[..16];

        var claimed = await alice.PutJsonAsync("v1/tenant/profile/handle", new { handle = "@" + handle.ToUpperInvariant() });
        var taken = await bob.PutJsonAsync("v1/tenant/profile/handle", new { handle });
        var changed = await alice.PutJsonAsync("v1/tenant/profile/handle", new { handle = handle + "x" });
        var nowFree = await bob.PutJsonAsync("v1/tenant/profile/handle", new { handle });

        Assert.Equal(handle, (await claimed.Content.ReadFromJsonAsync<ProfileDto>(ApiFactory.Json))!.Handle);
        Assert.Equal(HttpStatusCode.Conflict, taken.StatusCode);
        Assert.Equal("handle_taken", await taken.CodeAsync());
        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        Assert.Equal(HttpStatusCode.OK, nowFree.StatusCode);
    }

    [Theory]
    [InlineData("ab", HttpStatusCode.BadRequest, "validation_failed")]
    [InlineData("bad handle", HttpStatusCode.BadRequest, "validation_failed")]
    [InlineData("droblet", HttpStatusCode.UnprocessableEntity, "handle_reserved")]
    public async Task PutHandle_Invalid(string handle, HttpStatusCode status, string code)
    {
        var (client, _) = await factory.RegisterAsync();

        var response = await client.PutJsonAsync("v1/tenant/profile/handle", new { handle });

        Assert.Equal(status, response.StatusCode);
        Assert.Equal(code, await response.CodeAsync());
    }
}

public class StyleAndBodyProfileEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task StyleProfile_404ThenCreateThenVersionedUpdate()
    {
        var (client, auth) = await factory.RegisterAsync();
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("v1/tenant/style-profile")).StatusCode);

        var created = await client.PutJsonAsync("v1/tenant/style-profile",
            new { segment = "women", styleTags = new[] { "minimal", "quietLuxury", "officeChic" }, budget = "mixed", baseVersion = 0 });
        Assert.Equal(HttpStatusCode.OK, created.StatusCode);
        var dto = (await created.Content.ReadFromJsonAsync<StyleProfileDto>(ApiFactory.Json))!;
        Assert.Equal(1, dto.Version);
        Assert.Equal([StyleTag.Minimal, StyleTag.QuietLuxury, StyleTag.OfficeChic], dto.StyleTags);

        var stale = await client.PutJsonAsync("v1/tenant/style-profile",
            new { segment = "women", styleTags = new[] { "boho", "street", "vintage" }, budget = "highStreet", baseVersion = 0 });
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);

        var tenant = await factory.Repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(auth.TenantId));
        Assert.Equal(Segment.Women, tenant!.Segment);
    }

    [Theory]
    [InlineData("minimal,classic")]
    [InlineData("minimal,classic,boho,street")]
    [InlineData("minimal,minimal,boho")]
    public async Task StyleProfile_NotExactlyThreeDistinctTags_400(string csv)
    {
        var tags = csv.Split(',');
        var (client, _) = await factory.RegisterAsync();

        var response = await client.PutJsonAsync("v1/tenant/style-profile", new { segment = "women", styleTags = tags, budget = "mixed", baseVersion = 0 });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Theory]
    [InlineData("men")]
    [InlineData("teen")]
    public async Task StyleProfile_NonWomenSegment_422(string segment)
    {
        var (client, _) = await factory.RegisterAsync();

        var response = await client.PutJsonAsync("v1/tenant/style-profile",
            new { segment, styleTags = new[] { "minimal", "classic", "boho" }, budget = "mixed", baseVersion = 0 });

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
        Assert.Equal("segment_not_available", await response.CodeAsync());
    }

    [Fact]
    public async Task BodyProfile_WeightOptional_RangeValidated()
    {
        var (client, _) = await factory.RegisterAsync();

        var noWeight = await client.PutJsonAsync("v1/tenant/body-profile", new { heightCm = 168, size = "m", baseVersion = 0 });
        var tooTall = await client.PutJsonAsync("v1/tenant/body-profile", new { heightCm = 300, size = "m", baseVersion = 1 });
        var withWeight = await client.PutJsonAsync("v1/tenant/body-profile", new { heightCm = 168, weightKg = 58.5, size = "s", baseVersion = 1 });

        Assert.Equal(HttpStatusCode.OK, noWeight.StatusCode);
        Assert.Null((await noWeight.Content.ReadFromJsonAsync<BodyProfileDto>(ApiFactory.Json))!.WeightKg);
        Assert.Equal(HttpStatusCode.BadRequest, tooTall.StatusCode);
        var body = (await withWeight.Content.ReadFromJsonAsync<BodyProfileDto>(ApiFactory.Json))!;
        Assert.Equal(58.5m, body.WeightKg);
        Assert.Equal(2, body.Version);
    }

    [Fact]
    public async Task BodyProfile_IsTenantIsolated()
    {
        var (alice, _) = await factory.RegisterAsync();
        var (bob, _) = await factory.RegisterAsync();
        await alice.PutJsonAsync("v1/tenant/body-profile", new { heightCm = 170, size = "m", baseVersion = 0 });

        Assert.Equal(HttpStatusCode.NotFound, (await bob.GetAsync("v1/tenant/body-profile")).StatusCode);
    }
}

public class PhotoEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private async Task<PhotoUploadDto> UploadAsync(HttpClient client, string kind, byte[] bytes)
    {
        var slot = (await (await client.PostJsonAsync("v1/tenant/photo/upload-url", new { kind, contentType = "image/jpeg" }))
            .Content.ReadFromJsonAsync<PhotoUploadDto>(ApiFactory.Json))!;
        await factory.Storage.PutAsync(slot.Fields["key"], bytes, "image/jpeg", default);
        return slot;
    }

    [Fact]
    public async Task UploadUrl_IsPresignedPostUnderOwnTmpPrefix()
    {
        var (client, auth) = await factory.RegisterAsync();

        var response = await client.PostJsonAsync("v1/tenant/photo/upload-url", new { kind = "body", contentType = "image/jpeg" });

        var slot = (await response.Content.ReadFromJsonAsync<PhotoUploadDto>(ApiFactory.Json))!;
        Assert.StartsWith($"uploads/tmp/{auth.TenantId}/", slot.Fields["key"]);
        Assert.Equal("image/jpeg", slot.Fields["Content-Type"]);
        Assert.True(slot.MaxBytes > 0);
    }

    [Fact]
    public async Task UploadUrl_UnsupportedContentType_400()
    {
        var (client, _) = await factory.RegisterAsync();

        var response = await client.PostJsonAsync("v1/tenant/photo/upload-url", new { kind = "face", contentType = "image/gif" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task ActivateGetDelete_FullFlow()
    {
        var (client, auth) = await factory.RegisterAsync();
        var slot = await UploadAsync(client, "body", TestImages.JpegWithExif());

        var put = await client.PutJsonAsync("v1/tenant/photo/body", new { uploadId = slot.UploadId, clientMutationId = Ulid.New() });
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        var photos = (await client.GetFromJsonAsync<PhotosDto>("v1/tenant/photo", ApiFactory.Json))!;
        Assert.NotNull(photos.Body);
        Assert.Null(photos.Face);
        Assert.Contains($"tenant/{auth.TenantId}/body/", photos.Body.Url);

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync("v1/tenant/photo")).StatusCode);
        var after = (await client.GetFromJsonAsync<PhotosDto>("v1/tenant/photo", ApiFactory.Json))!;
        Assert.Null(after.Body);
        Assert.DoesNotContain(factory.Storage.Objects.Keys, k => k.StartsWith($"tenant/{auth.TenantId}/body/", StringComparison.Ordinal));
    }

    [Fact]
    public async Task DeleteOne_RemovesOnlyThatKind_404ForAnotherIdOrTenant()
    {
        var (client, auth) = await factory.RegisterAsync();
        var (other, _) = await factory.RegisterAsync();
        var body = await UploadAsync(client, "body", TestImages.JpegWithExif());
        var face = await UploadAsync(client, "face", TestImages.JpegWithExif());
        (await client.PutJsonAsync("v1/tenant/photo/body", new { uploadId = body.UploadId, clientMutationId = Ulid.New() })).EnsureSuccessStatusCode();
        (await client.PutJsonAsync("v1/tenant/photo/face", new { uploadId = face.UploadId, clientMutationId = Ulid.New() })).EnsureSuccessStatusCode();
        var photos = (await client.GetFromJsonAsync<PhotosDto>("v1/tenant/photo", ApiFactory.Json))!;

        var wrongKind = await client.DeleteAsync($"v1/tenant/photo/face/{photos.Body!.Id}");
        var badKind = await client.DeleteAsync($"v1/tenant/photo/selfie/{photos.Body.Id}");
        var otherTenant = await other.DeleteAsync($"v1/tenant/photo/body/{photos.Body.Id}");
        var deleted = await client.DeleteAsync($"v1/tenant/photo/body/{photos.Body.Id}");
        var again = await client.DeleteAsync($"v1/tenant/photo/body/{photos.Body.Id}");
        var after = (await client.GetFromJsonAsync<PhotosDto>("v1/tenant/photo", ApiFactory.Json))!;

        Assert.Equal((HttpStatusCode.NotFound, "not_found"), (wrongKind.StatusCode, await wrongKind.CodeAsync()));
        Assert.Equal(HttpStatusCode.NotFound, badKind.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, otherTenant.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, again.StatusCode);
        Assert.Null(after.Body);
        Assert.Equal(photos.Face!.Id, after.Face!.Id);
        Assert.DoesNotContain(factory.Storage.Objects.Keys, k => k.StartsWith($"tenant/{auth.TenantId}/body/", StringComparison.Ordinal));
        Assert.Contains(factory.Storage.Objects.Keys, k => k.StartsWith($"tenant/{auth.TenantId}/face/", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Activate_AnotherTenantsUpload_404()
    {
        var (alice, _) = await factory.RegisterAsync();
        var (bob, _) = await factory.RegisterAsync();
        var slot = await UploadAsync(alice, "body", TestImages.JpegWithExif());

        var response = await bob.PutJsonAsync("v1/tenant/photo/body", new { uploadId = slot.UploadId, clientMutationId = Ulid.New() });

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("upload_not_found", await response.CodeAsync());
    }

    [Fact]
    public async Task Activate_UnknownKind_404_BadIds_400_NotImage_422()
    {
        var (client, _) = await factory.RegisterAsync();
        var slot = await UploadAsync(client, "face", "not an image at all"u8.ToArray());

        Assert.Equal(HttpStatusCode.NotFound, (await client.PutJsonAsync("v1/tenant/photo/selfie", new { uploadId = slot.UploadId, clientMutationId = Ulid.New() })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutJsonAsync("v1/tenant/photo/face", new { uploadId = "x", clientMutationId = "y" })).StatusCode);
        var notImage = await client.PutJsonAsync("v1/tenant/photo/face", new { uploadId = slot.UploadId, clientMutationId = Ulid.New() });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, notImage.StatusCode);
        Assert.Equal("unsupported_image", await notImage.CodeAsync());
    }
}

public class JobAndEntitlementEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Job_OwnVisible_OtherTenants404()
    {
        var (alice, aliceAuth) = await factory.RegisterAsync();
        var (bob, _) = await factory.RegisterAsync();
        var jobId = Ulid.New();
        await factory.Repository.SaveAsync(new JobEntity
        {
            Id = jobId, TenantId = aliceAuth.TenantId, Kind = JobKind.TryOn, Status = JobStatus.Failed,
            Failure = JobFailure.ProviderError, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
        });

        var own = await alice.GetFromJsonAsync<JobDto>($"v1/tenant/job/{jobId}", ApiFactory.Json);
        Assert.Equal(JobStatus.Failed, own!.Status);
        Assert.Equal(JobFailure.ProviderError, own.Failure);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.GetAsync($"v1/tenant/job/{jobId}")).StatusCode);
    }

    [Fact]
    public async Task Job_ResponseUsesCamelCaseEnums()
    {
        var (client, auth) = await factory.RegisterAsync();
        var jobId = Ulid.New();
        await factory.Repository.SaveAsync(new JobEntity { Id = jobId, TenantId = auth.TenantId, Kind = JobKind.StylistOutfit, Status = JobStatus.Completed, Result = """{"ok":true}""" });

        var json = await (await client.GetAsync($"v1/tenant/job/{jobId}")).JsonAsync();

        Assert.Equal("stylistOutfit", json.GetProperty("kind").GetString());
        Assert.Equal("completed", json.GetProperty("status").GetString());
        Assert.True(json.GetProperty("result").GetProperty("ok").GetBoolean());
    }

    [Fact]
    public async Task Entitlement_Free_NoCredits()
    {
        var (client, _) = await factory.RegisterAsync();

        var dto = (await client.GetFromJsonAsync<EntitlementDto>("v1/tenant/entitlement", ApiFactory.Json))!;

        Assert.Equal(Tier.Free, dto.Tier);
        Assert.Equal(0, dto.Credits.TotalRemaining);
        Assert.Null(dto.Credits.ResetsAt);
    }

    [Fact]
    public async Task Entitlement_Premium_30CreditsMinusUsed_WithReset()
    {
        var (client, auth) = await factory.RegisterAsync();
        var anchor = DateTime.UtcNow.AddDays(-3);
        await factory.Repository.SaveAsync(new EntitlementEntity
        {
            Id = "tx", TenantId = auth.TenantId, Tier = Tier.Premium, Source = EntitlementSource.Store, Platform = StorePlatform.Apple,
            ProductId = "com.alatech.droplet.premium.monthly", StartsAt = anchor, ExpiresAt = anchor.AddMonths(1), PeriodAnchor = anchor,
        });
        var credits = factory.Services.GetService(typeof(ICreditService)) as ICreditService;
        await credits!.ReserveAsync(auth.TenantId, "k1", "j1", default);

        var dto = (await client.GetFromJsonAsync<EntitlementDto>("v1/tenant/entitlement", ApiFactory.Json))!;

        Assert.Equal(Tier.Premium, dto.Tier);
        Assert.Equal(30, dto.Credits.MonthlyAllowance);
        Assert.Equal(29, dto.Credits.AllowanceRemaining);
        Assert.Equal(anchor.AddMonths(1), dto.Credits.ResetsAt!.Value.ToUniversalTime(), TimeSpan.FromSeconds(1));
    }

    [Fact]
    public async Task Purchase_And_Restore_501UntilStoreConfigured()
    {
        var (client, _) = await factory.RegisterAsync();

        var purchase = await client.PostJsonAsync("v1/tenant/entitlement/purchase", new { platform = "apple", productId = "com.alatech.droplet.credits.20", transactionId = "2000000123" });
        var restore = await client.PostAsync("v1/tenant/entitlement/restore", null);

        Assert.Equal(HttpStatusCode.NotImplemented, purchase.StatusCode);
        Assert.Equal("purchase_verification_unavailable", await purchase.CodeAsync());
        Assert.Equal(HttpStatusCode.NotImplemented, restore.StatusCode);
    }

    [Theory]
    [InlineData("en-US,en;q=0.9", "en")]
    [InlineData("tr-TR,tr;q=0.9,en;q=0.8", "tr")]
    [InlineData("de-DE,de;q=0.9,en;q=0.5", "en")]   // first SUPPORTED language
    [InlineData("de-DE,fr;q=0.9", "tr")]            // nothing supported → default
    [InlineData(null, "tr")]
    public async Task Register_SetsTheProfileLanguage_FromAcceptLanguage(string? acceptLanguage, string expected)
    {
        var client = factory.CreateClient();
        var request = new HttpRequestMessage(HttpMethod.Post, "v1/auth/register")
        {
            Content = JsonContent.Create(new { name = "Ayşe", email = $"{Guid.NewGuid():N}@example.com", password = "Sifre1234" }, options: ApiFactory.Json),
        };
        if (acceptLanguage is not null)
            request.Headers.TryAddWithoutValidation("Accept-Language", acceptLanguage);

        var response = await client.SendAsync(request);
        var auth = (await response.Content.ReadFromJsonAsync<AuthResponse>(ApiFactory.Json))!;
        client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", auth.AccessToken);
        var profile = await client.GetFromJsonAsync<ProfileDto>("v1/tenant/profile", ApiFactory.Json);

        Assert.Equal(expected, profile!.Language);
    }

    [Theory]
    [InlineData("apple", "en-GB", "en")]
    [InlineData("google", "en;q=0.4,tr;q=0.9", "tr")]
    [InlineData("google", "es-ES", "tr")]
    public async Task SocialSignUp_SetsTheProfileLanguage_FromAcceptLanguage(string provider, string acceptLanguage, string expected)
    {
        var client = factory.CreateClient();
        var token = $"valid:{Guid.NewGuid():N}:{Guid.NewGuid():N}@example.com";
        object body = provider == "apple" ? new { identityToken = token, nonce = "nonce-1234567890", fullName = new { givenName = "Ayşe" } } : new { idToken = token, name = "Ayşe" };
        var request = new HttpRequestMessage(HttpMethod.Post, $"v1/auth/{provider}") { Content = JsonContent.Create(body, options: ApiFactory.Json) };
        request.Headers.TryAddWithoutValidation("Accept-Language", acceptLanguage);

        var response = await client.SendAsync(request);
        response.EnsureSuccessStatusCode();
        var auth = (await response.Content.ReadFromJsonAsync<AuthResponse>(ApiFactory.Json))!;
        var tenant = await factory.Repository.GetAsync<Domain.Entity.TenantEntity>(Domain.Entity.TenantEntity.GetPk(), Domain.Entity.TenantEntity.GetSk(auth.TenantId));

        Assert.Equal(expected, tenant!.Language);
    }

    [Fact]
    public async Task PutProfile_AcceptsALanguageOnlyUpdate_AndLeavesTheRestUntouched()
    {
        var (client, _) = await factory.RegisterAsync();
        (await client.PutJsonAsync("v1/tenant/profile", new { displayName = "Ayşe Y.", cityId = "745044", baseVersion = 1 })).EnsureSuccessStatusCode();

        var languageOnly = await client.PutJsonAsync("v1/tenant/profile", new { language = "en", baseVersion = 2, clientMutationId = "01JD0000000000000000000000" });
        var updated = await languageOnly.Content.ReadFromJsonAsync<ProfileDto>(ApiFactory.Json);
        var unsupported = await client.PutJsonAsync("v1/tenant/profile", new { language = "de", baseVersion = 3 });
        var blankName = await client.PutJsonAsync("v1/tenant/profile", new { displayName = "  ", baseVersion = 3 });
        var stale = await client.PutJsonAsync("v1/tenant/profile", new { language = "tr", baseVersion = 2 });
        var cleared = await (await client.PutJsonAsync("v1/tenant/profile", new { cityId = "", baseVersion = 3 })).Content.ReadFromJsonAsync<ProfileDto>(ApiFactory.Json);

        Assert.Equal(HttpStatusCode.OK, languageOnly.StatusCode);
        Assert.Equal(("en", "Ayşe Y.", "745044", 3L), (updated!.Language, updated.DisplayName, updated.CityId, updated.Version));
        Assert.Equal(HttpStatusCode.BadRequest, unsupported.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, blankName.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        Assert.Equal((null, "en", "Ayşe Y."), (cleared!.CityId, cleared.Language, cleared.DisplayName));
    }
}
