using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using Api.Contracts;
using Domain.Entity;
using Domain.Enum;
using Domain.Services;
using Microsoft.AspNetCore.Hosting;

namespace ApiTests;

/// <summary>The dev configuration of teen mode: 16–17 may sign up (Teen:Enabled); teen try-on still off (the default).</summary>
public class TeenApiFactory : ApiFactory
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.UseSetting("Teen:Enabled", "true");
    }
}

/// <summary>Teen try-on switched on (Teen:TryOnEnabled) — only to prove the other two conditions still hold the gate.</summary>
public class TeenTryOnApiFactory : TeenApiFactory
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.UseSetting("Teen:TryOnEnabled", "true");
    }
}

internal static class Teen
{
    public static int Year => DateTime.UtcNow.Year;

    /// <summary>Born 17 years ago (no month): 16 or 17 either way → teen.</summary>
    public static async Task<(HttpClient Client, AuthResponse Auth, string Email)> RegisterAsync(ApiFactory factory)
    {
        var client = factory.CreateClient();
        var email = $"{Guid.NewGuid():N}@example.com";
        var response = await client.PostJsonAsync("v1/auth/register", new { name = "Elif Kaya", email, password = "Sifre1234", birthYear = Year - 17 });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var auth = (await response.Content.ReadFromJsonAsync<AuthResponse>(ApiFactory.Json))!;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth.AccessToken);
        return (client, auth, email);
    }

    public static async Task<JsonElement> StatusAsync(HttpClient client) => await (await client.GetAsync("v1/tenant/teen")).JsonAsync();

    /// <summary>The token of the last e-mail sent to <paramref name="to"/>.</summary>
    public static string LastToken(ApiFactory factory, string to)
    {
        EmailMessage message;
        lock (factory.Email.Sent) message = factory.Email.Sent.Last(m => m.To == to);
        return Uri.UnescapeDataString(Regex.Match(message.TextBody, @"/parent-consent/\?token=([^\s]+)").Groups[1].Value);
    }

    /// <summary>Lets the next request through the 1-per-minute limit (the test clock does not move).</summary>
    public static void ResetMinuteLimit(ApiFactory factory)
    {
        foreach (var key in factory.Repository.Counters.Keys.Where(k => k.Item1.Contains("#teen-consent-minute#", StringComparison.Ordinal)).ToList())
            factory.Repository.Counters.TryRemove(key, out _);
    }

    public static async Task<string> RequestAsync(ApiFactory factory, HttpClient client)
    {
        var parent = $"parent-{Guid.NewGuid():N}@example.com";
        var response = await client.PostJsonAsync("v1/tenant/teen/parental-consent", new { parentEmail = parent });
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        return parent;
    }

    public static Task<HttpResponseMessage> DecideAsync(HttpClient anonymous, string token, bool approve, bool allowTryOn = false, bool boxes = true, string version = "2026-11-21") =>
        anonymous.PostJsonAsync("v1/parent-consent/decision", new
        {
            token, approve, textVersion = version, confirmParent = boxes, confirmNotice = boxes, confirmProcessing = boxes, allowTryOn,
        });

    /// <summary>A teen whose parent approved (with or without the try-on box).</summary>
    public static async Task<(HttpClient Client, AuthResponse Auth, string Parent)> ApprovedAsync(ApiFactory factory, bool allowTryOn = false)
    {
        var (client, auth, _) = await RegisterAsync(factory);
        var parent = await RequestAsync(factory, client);
        Assert.Equal(HttpStatusCode.OK, (await DecideAsync(factory.CreateClient(), LastToken(factory, parent), approve: true, allowTryOn)).StatusCode);
        return (client, auth, parent);
    }
}

public class TeenAgeEndpointTests(TeenApiFactory factory) : IClassFixture<TeenApiFactory>
{
    private Task<HttpResponseMessage> Register(object age)
    {
        var body = new Dictionary<string, object?> { ["name"] = "Ayşe", ["email"] = $"{Guid.NewGuid():N}@example.com", ["password"] = "Sifre1234" };
        foreach (var p in age.GetType().GetProperties())
            body[p.Name] = p.GetValue(age);
        return factory.CreateClient().PostJsonAsync("v1/auth/register", body);
    }

    [Fact]
    public async Task Register_BirthYear_GivesTheBand_UnderSixteenIsRefused_AmbiguousAsksTheMonth()
    {
        var y = Teen.Year;
        var adult = await Register(new { birthYear = y - 30 });
        var teen = await Register(new { birthYear = y - 17 });
        var teenByMonth = await Register(new { birthYear = y - 18, birthMonth = 12 });   // 17 until the end of December
        var under = await Register(new { birthYear = y - 14 });
        var underByMonth = await Register(new { birthYear = y - 16, birthMonth = 12 });  // 15 until the end of December
        var ambiguous16 = await Register(new { birthYear = y - 16 });
        var ambiguous18 = await Register(new { birthYear = y - 18 });
        var future = await Register(new { birthYear = y + 1 });
        var badMonth = await Register(new { birthYear = y - 30, birthMonth = 13 });
        var legacy = await Register(new { ageConfirmed = true });
        var none = await Register(new { });

        Assert.Equal(HttpStatusCode.Created, adult.StatusCode);
        Assert.Equal(HttpStatusCode.Created, teen.StatusCode);
        Assert.Equal(HttpStatusCode.Created, teenByMonth.StatusCode);
        Assert.Equal(HttpStatusCode.Created, legacy.StatusCode);
        foreach (var r in new[] { under, underByMonth })
        {
            Assert.Equal(HttpStatusCode.UnprocessableEntity, r.StatusCode);
            Assert.Equal("age_under_minimum", await r.CodeAsync());
        }
        foreach (var r in new[] { ambiguous16, ambiguous18 })
            Assert.Equal("birth_month_required", await r.CodeAsync());
        Assert.Equal("birth_year_invalid", await future.CodeAsync());
        Assert.Equal("birth_month_invalid", await badMonth.CodeAsync());
        Assert.Equal(HttpStatusCode.BadRequest, none.StatusCode);
        Assert.Contains("age_confirmation_required", await none.Content.ReadAsStringAsync());

        async Task<JsonElement> Profile(HttpResponseMessage registered)
        {
            var auth = (await registered.Content.ReadFromJsonAsync<AuthResponse>(ApiFactory.Json))!;
            var client = factory.CreateClient();
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth.AccessToken);
            return await (await client.GetAsync("v1/tenant/profile")).JsonAsync();
        }

        var adultProfile = await Profile(adult);
        var teenProfile = await Profile(teen);
        Assert.Equal("adult", adultProfile.GetProperty("ageBand").GetString());
        Assert.Equal(JsonValueKind.Null, adultProfile.GetProperty("teen").ValueKind);
        Assert.Equal("adult", (await Profile(legacy)).GetProperty("ageBand").GetString());
        Assert.Equal("teen", teenProfile.GetProperty("ageBand").GetString());
        Assert.Equal("private", teenProfile.GetProperty("closetVisibility").GetString());
        var state = teenProfile.GetProperty("teen");
        Assert.Equal("pendingParentalConsent", state.GetProperty("status").GetString());
        Assert.Equal("none", state.GetProperty("request").GetProperty("state").GetString());
        Assert.Equal($"{y - 17 + 19}-01-01", state.GetProperty("adultFrom").GetString());   // year only: 1 January after the 18th year
        Assert.Contains("firebaseAnalytics", state.GetProperty("restrictions").EnumerateArray().Select(e => e.GetString()));
    }

    [Fact]
    public async Task Register_UnderSixteen_StoresNothing()
    {
        var email = $"{Guid.NewGuid():N}@example.com";
        var before = factory.Repository.Count;
        var refused = await factory.CreateClient().PostJsonAsync("v1/auth/register", new { name = "Can", email, password = "Sifre1234", birthYear = Teen.Year - 13 });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, refused.StatusCode);
        Assert.Equal(before, factory.Repository.Count);
        // The address was never taken.
        var adult = await factory.CreateClient().PostJsonAsync("v1/auth/register", new { name = "Can", email, password = "Sifre1234", birthYear = Teen.Year - 40 });
        Assert.Equal(HttpStatusCode.Created, adult.StatusCode);
    }

    [Fact]
    public async Task AppleAgeStep_UnderSixteen_DeletesTheNewAccount_TeenBecomesPending_OnceOnly()
    {
        async Task<(HttpClient, AuthResponse)> SignIn()
        {
            var client = factory.CreateClient();
            var token = $"valid:apple-{Guid.NewGuid():N}:relay-{Guid.NewGuid():N}@privaterelay.appleid.com";
            var auth = (await (await client.PostJsonAsync("v1/auth/apple", new { identityToken = token, nonce = "n" })).Content.ReadFromJsonAsync<AuthResponse>(ApiFactory.Json))!;
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth.AccessToken);
            return (client, auth);
        }

        var (child, childAuth) = await SignIn();
        Assert.Equal(JsonValueKind.Null, (await (await child.GetAsync("v1/tenant/profile")).JsonAsync()).GetProperty("ageBand").ValueKind);
        var refused = await child.PostJsonAsync("v1/tenant/profile/age-confirmation", new { birthYear = Teen.Year - 12 });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, refused.StatusCode);
        var problem = await refused.JsonAsync();
        Assert.Equal("age_under_minimum", problem.GetProperty("code").GetString());
        Assert.True(problem.GetProperty("accountDeleted").GetBoolean());
        Assert.Null(await factory.Repository.GetAsync<UserEntity>(UserEntity.GetPk(), UserEntity.GetSk(childAuth.UserId)));
        Assert.Null(await factory.Repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(childAuth.TenantId)));

        var (teen, teenAuth) = await SignIn();
        var profile = await (await teen.PostJsonAsync("v1/tenant/profile/age-confirmation", new { birthYear = Teen.Year - 17 })).JsonAsync();
        Assert.Equal("teen", profile.GetProperty("ageBand").GetString());
        Assert.Equal("pendingParentalConsent", profile.GetProperty("teen").GetProperty("status").GetString());
        // Once only: the band cannot be changed afterwards.
        var again = await (await teen.PostJsonAsync("v1/tenant/profile/age-confirmation", new { birthYear = Teen.Year - 40 })).JsonAsync();
        Assert.Equal("teen", again.GetProperty("ageBand").GetString());
        Assert.NotNull(await factory.Repository.GetAsync<TeenAccountIndexEntity>(TeenAccountIndexEntity.GetPk(), TeenAccountIndexEntity.GetSk(teenAuth.TenantId)));
    }

    [Fact]
    public async Task Config_ShowsTeenAvailability_TryOnOffByDefault()
    {
        var teen = (await (await factory.CreateClient().GetAsync("v1/config")).JsonAsync()).GetProperty("teen");
        Assert.True(teen.GetProperty("enabled").GetBoolean());
        Assert.False(teen.GetProperty("tryOnEnabled").GetBoolean());
        Assert.Equal(16, teen.GetProperty("minimumAge").GetInt32());
    }
}

/// <summary>The code default (prod): teen sign-up off.</summary>
public class TeenDisabledEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task SixteenToSeventeen_IsNotAvailable_WhileTeenIsOff_AdultsStillRegister()
    {
        var client = factory.CreateClient();
        var teen = await client.PostJsonAsync("v1/auth/register", new { name = "Elif", email = $"{Guid.NewGuid():N}@example.com", password = "Sifre1234", birthYear = Teen.Year - 17 });
        var adult = await client.PostJsonAsync("v1/auth/register", new { name = "Ece", email = $"{Guid.NewGuid():N}@example.com", password = "Sifre1234", birthYear = Teen.Year - 25 });

        Assert.Equal(HttpStatusCode.UnprocessableEntity, teen.StatusCode);
        Assert.Equal("teen_not_available", await teen.CodeAsync());
        Assert.Equal(HttpStatusCode.Created, adult.StatusCode);
        Assert.False((await (await client.GetAsync("v1/config")).JsonAsync()).GetProperty("teen").GetProperty("enabled").GetBoolean());
    }
}

public class ParentalConsentEndpointTests(TeenApiFactory factory) : IClassFixture<TeenApiFactory>
{
    [Fact]
    public async Task Send_Approve_IsRecorded_ConfirmationCarriesTheWithdrawalLink_SecondDecisionIs409()
    {
        var (client, auth, _) = await Teen.RegisterAsync(factory);
        var parent = await Teen.RequestAsync(factory, client);
        var token = Teen.LastToken(factory, parent);
        var anonymous = factory.CreateClient();

        var status = await Teen.StatusAsync(client);
        Assert.Equal("sent", status.GetProperty("teen").GetProperty("request").GetProperty("state").GetString());
        Assert.StartsWith("p***@e***", status.GetProperty("teen").GetProperty("request").GetProperty("parentEmailMasked").GetString());
        Assert.Contains("/parent-consent/?token=", factory.Email.Sent.Last(m => m.To == parent).TextBody);   // trailing slash before the query

        var view = await (await anonymous.GetAsync($"v1/parent-consent?token={Uri.EscapeDataString(token)}")).JsonAsync();
        Assert.Equal("request", view.GetProperty("kind").GetString());
        Assert.Equal("pending", view.GetProperty("status").GetString());
        Assert.Equal("Elif", view.GetProperty("teenName").GetString());
        Assert.False(view.GetProperty("tryOnOffered").GetBoolean());

        var noBoxes = await Teen.DecideAsync(anonymous, token, approve: true, boxes: false);
        var oldText = await Teen.DecideAsync(anonymous, token, approve: true, version: "2020-01-01");
        Assert.Equal("parental_consent_confirmations_required", await noBoxes.CodeAsync());
        Assert.Equal("consent_version_outdated", await oldText.CodeAsync());

        var approved = await Teen.DecideAsync(anonymous, token, approve: true, allowTryOn: true);
        Assert.Equal(HttpStatusCode.OK, approved.StatusCode);
        Assert.Equal("approved", (await approved.JsonAsync()).GetProperty("status").GetString());
        var teen = (await Teen.StatusAsync(client)).GetProperty("teen");
        Assert.Equal("active", teen.GetProperty("status").GetString());
        Assert.False(teen.GetProperty("parentAllowedTryOn").GetBoolean());          // the box is ignored while Teen:TryOnEnabled is off
        Assert.Equal("feature_off", teen.GetProperty("tryOn").GetProperty("reason").GetString());

        var again = await Teen.DecideAsync(anonymous, token, approve: false);
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
        Assert.Equal("parental_consent_already_decided", await again.CodeAsync());

        var confirmation = factory.Email.Sent.Last(m => m.To == parent);
        Assert.NotEqual(token, Teen.LastToken(factory, parent));
        var manage = await (await anonymous.GetAsync($"v1/parent-consent?token={Uri.EscapeDataString(Teen.LastToken(factory, parent))}")).JsonAsync();
        Assert.Equal("manage", manage.GetProperty("kind").GetString());
        Assert.Contains("geri al", confirmation.TextBody, StringComparison.Ordinal);   // the withdrawal link, in the profile language

        var history = await factory.Repository.GetAllAsync<ParentalConsentEventEntity>(ParentalConsentEventEntity.GetPk(auth.TenantId));
        var approval = history.Single(h => h.Event == ParentalConsentEvent.Approved);
        Assert.Equal(["Requested", "Approved"], history.OrderBy(h => h.Id).Select(h => h.Event.ToString()).ToArray());
        Assert.Equal("2026-11-21", approval.TextVersion);
        Assert.Equal(parent.Sha256(), approval.ParentEmailHash);
        Assert.Matches("^[0-9a-f]{64}$", Infrastructure.Services.TeenService.IpHash("203.0.113.5"));   // the test server has no client IP; the hash is never the IP
        Assert.True(approval.ConfirmParent == true && approval.ConfirmNotice == true && approval.ConfirmProcessing == true);
        Assert.DoesNotContain(parent, JsonSerializer.Serialize(history));            // only the hash in the history
    }

    [Fact]
    public async Task Decline_LeavesLimitedMode_AndANewRequestIsPossible()
    {
        var (client, _, _) = await Teen.RegisterAsync(factory);
        var parent = await Teen.RequestAsync(factory, client);
        var declined = await Teen.DecideAsync(factory.CreateClient(), Teen.LastToken(factory, parent), approve: false, boxes: false);

        Assert.Equal("declined", (await declined.JsonAsync()).GetProperty("status").GetString());
        Assert.Equal("declined", (await Teen.StatusAsync(client)).GetProperty("teen").GetProperty("status").GetString());
        Assert.Equal("parental_consent_required", await (await client.PostJsonAsync("v1/tenant/photo/upload-url", new { kind = "body", contentType = "image/jpeg" })).CodeAsync());

        Teen.ResetMinuteLimit(factory);
        Assert.Equal(HttpStatusCode.Accepted, (await client.PostJsonAsync("v1/tenant/teen/parental-consent", new { parentEmail = parent })).StatusCode);
        Assert.Equal("pendingParentalConsent", (await Teen.StatusAsync(client)).GetProperty("teen").GetProperty("status").GetString());
    }

    [Fact]
    public async Task Withdraw_TurnsPhotoFeaturesOff_AndDeletesThePersonalPhotos()
    {
        var (client, auth, parent) = await Teen.ApprovedAsync(factory);
        var photoKey = $"tenant/{auth.TenantId}/body/p1.jpg";
        await factory.Storage.PutAsync(photoKey, [1, 2, 3], "image/jpeg", default);
        await factory.Repository.SaveAsync(new PhotoEntity { Id = "p1", TenantId = auth.TenantId, Kind = PhotoKind.Body, S3Key = photoKey, ContentType = "image/jpeg", Active = true });
        Assert.NotEqual("parental_consent_required", await (await client.PostJsonAsync("v1/tenant/photo/upload-url", new { kind = "body", contentType = "image/jpeg" })).CodeAsync());

        var withdrawn = await factory.CreateClient().PostJsonAsync("v1/parent-consent/withdraw", new { token = Teen.LastToken(factory, parent) });

        Assert.Equal(HttpStatusCode.OK, withdrawn.StatusCode);
        Assert.Equal("withdrawn", (await withdrawn.JsonAsync()).GetProperty("status").GetString());
        Assert.Equal("withdrawn", (await Teen.StatusAsync(client)).GetProperty("teen").GetProperty("status").GetString());
        Assert.Empty(await factory.Repository.GetAllAsync<PhotoEntity>(PhotoEntity.GetPk(auth.TenantId)));
        Assert.Contains(factory.Storage.DeletedPrefixes, p => p.StartsWith($"tenant/{auth.TenantId}/body", StringComparison.Ordinal));
        Assert.Equal("parental_consent_required", await (await client.PostJsonAsync("v1/tenant/photo/upload-url", new { kind = "body", contentType = "image/jpeg" })).CodeAsync());
        Assert.Contains(await factory.Repository.GetAllAsync<ParentalConsentEventEntity>(ParentalConsentEventEntity.GetPk(auth.TenantId)), h => h.Event == ParentalConsentEvent.Withdrawn);
    }

    [Fact]
    public async Task Expired_Link_Is410_Resend_IsRateLimited_ReplacesTheLink()
    {
        var (client, auth, _) = await Teen.RegisterAsync(factory);
        var parent = await Teen.RequestAsync(factory, client);
        var first = Teen.LastToken(factory, parent);

        // Resend right away: 1 per minute.
        var tooSoon = await client.PostAsync("v1/tenant/teen/parental-consent/resend", null);
        Assert.Equal(HttpStatusCode.TooManyRequests, tooSoon.StatusCode);

        // Seven days later (the stored expiry moved into the past).
        var row = (await factory.Repository.GetAllAsync<ParentalConsentTokenEntity>(ParentalConsentTokenEntity.GetPk())).Single(t => t.TokenHash == first.Sha256());
        row.ExpiresAt = DateTime.UtcNow.AddMinutes(-1);
        await factory.Repository.SaveAsync(row);
        var consent = (await factory.Repository.GetAsync<ParentalConsentEntity>(ParentalConsentEntity.GetPk(auth.TenantId), ParentalConsentEntity.GetSk()))!;
        consent.RequestExpiresAt = row.ExpiresAt;
        await factory.Repository.SaveAsync(consent);

        var anonymous = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Gone, (await anonymous.GetAsync($"v1/parent-consent?token={Uri.EscapeDataString(first)}")).StatusCode);
        Assert.Equal("parental_consent_link_expired", await (await Teen.DecideAsync(anonymous, first, approve: true)).CodeAsync());
        Assert.Equal("expired", (await Teen.StatusAsync(client)).GetProperty("teen").GetProperty("request").GetProperty("state").GetString());

        Teen.ResetMinuteLimit(factory);
        var resent = await client.PostAsync("v1/tenant/teen/parental-consent/resend", null);
        Assert.Equal(HttpStatusCode.Accepted, resent.StatusCode);
        var second = Teen.LastToken(factory, parent);
        Assert.NotEqual(first, second);
        Assert.Equal(HttpStatusCode.NotFound, (await anonymous.GetAsync($"v1/parent-consent?token={Uri.EscapeDataString(first)}")).StatusCode);   // replaced
        Assert.Equal(HttpStatusCode.OK, (await Teen.DecideAsync(anonymous, second, approve: true)).StatusCode);
        Assert.Equal("parental_consent_already_given", await (await client.PostAsync("v1/tenant/teen/parental-consent/resend", null)).CodeAsync());
    }

    [Fact]
    public async Task Request_Validation_AdultsAndUnknownTokens()
    {
        var (client, _, email) = await Teen.RegisterAsync(factory);
        var (adult, _) = await factory.RegisterAsync();

        Assert.Equal("parent_email_invalid", await (await client.PostJsonAsync("v1/tenant/teen/parental-consent", new { parentEmail = "nope" })).CodeAsync());
        Assert.Equal("parent_email_same_as_teen", await (await client.PostJsonAsync("v1/tenant/teen/parental-consent", new { parentEmail = email })).CodeAsync());
        Assert.Equal("parental_consent_not_requested", await (await client.PostAsync("v1/tenant/teen/parental-consent/resend", null)).CodeAsync());
        Assert.Equal("not_a_teen_account", await (await adult.PostJsonAsync("v1/tenant/teen/parental-consent", new { parentEmail = "p@example.com" })).CodeAsync());
        Assert.Equal(JsonValueKind.Null, (await Teen.StatusAsync(adult)).GetProperty("teen").ValueKind);
        Assert.Equal(HttpStatusCode.NotFound, (await factory.CreateClient().GetAsync("v1/parent-consent?token=unknown")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await factory.CreateClient().PostJsonAsync("v1/parent-consent/withdraw", new { token = "unknown" })).StatusCode);
    }
}

public class TeenRestrictionEndpointTests(TeenApiFactory factory) : IClassFixture<TeenApiFactory>
{
    [Fact]
    public async Task Social_IsClosed_ClosetStaysPrivate_BlockStaysOpen()
    {
        var (client, _, _) = await Teen.ApprovedAsync(factory);

        foreach (var (method, url, body) in new (string, string, object?)[]
        {
            ("POST", "v1/tenant/follow/someone", null),
            ("GET", "v1/tenant/follower", null),
            ("GET", "v1/tenant/following", null),
            ("GET", "v1/tenant/follow-request/incoming", null),
            ("GET", "v1/tenant/people?q=ayse", null),
            ("GET", "v1/tenant/people/suggested", null),
            ("PUT", "v1/tenant/people/someone/look/l1/rating", new { stars = 5 }),
            ("GET", "v1/tenant/feed", null),
            ("POST", "v1/tenant/share", new { kind = "look", id = "l1", channel = "link" }),
            ("GET", "v1/tenant/invite/link", null),
            ("POST", "v1/tenant/contacts/salt", null),
            ("PUT", "v1/tenant/profile/handle", new { handle = "elif" }),
            ("GET", "v1/tenant/saved-look", null),
        })
        {
            var request = new HttpRequestMessage(new HttpMethod(method), url) { Content = body is null ? null : JsonContent.Create(body, options: ApiFactory.Json) };
            var response = await client.SendAsync(request);
            Assert.True(response.StatusCode == HttpStatusCode.Forbidden, $"{method} {url}: {response.StatusCode}");
            var problem = await response.JsonAsync();
            Assert.Equal("teen_restricted", problem.GetProperty("code").GetString());
            Assert.Equal("social", problem.GetProperty("feature").GetString());
        }

        var profile = await (await client.GetAsync("v1/tenant/profile")).JsonAsync();
        var toPublic = await client.PutJsonAsync("v1/tenant/profile/visibility", new { closetVisibility = "public", baseVersion = profile.GetProperty("version").GetInt64() });
        Assert.Equal("closetVisibility", (await toPublic.JsonAsync()).GetProperty("feature").GetString());
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("v1/tenant/block")).StatusCode);
    }

    [Fact]
    public async Task Commerce_IsClosed_PaywallHidden()
    {
        var (client, _, _) = await Teen.ApprovedAsync(factory);

        foreach (var url in new[] { "v1/tenant/cart", "v1/tenant/watch-list", "v1/tenant/favorite/product", "v1/tenant/purchase-prompt", "v1/tenant/palette/products" })
        {
            var response = await client.GetAsync(url);
            Assert.True(response.StatusCode == HttpStatusCode.Forbidden, url);
            Assert.Equal("commerce", (await response.JsonAsync()).GetProperty("feature").GetString());
        }
        foreach (var url in new[] { "v1/tenant/entitlement/purchase", "v1/tenant/entitlement/restore", "v1/tenant/entitlement/self-premium", "v1/tenant/cart/line" })
            Assert.Equal("teen_restricted", await (await client.PostJsonAsync(url, new { })).CodeAsync());

        var entitlement = await (await client.GetAsync("v1/tenant/entitlement")).JsonAsync();
        Assert.True(entitlement.GetProperty("paywallHidden").GetBoolean());
        Assert.Equal("free", entitlement.GetProperty("tier").GetString());
    }

    [Fact]
    public async Task Analytics_NothingStored_ForATeen_AdultsUnchanged()
    {
        var (teen, teenAuth, _) = await Teen.RegisterAsync(factory);
        var (adult, _) = await factory.RegisterAsync();
        var batch = new { events = new[] { new { name = "signup_completed" }, new { name = "first_item_added" } } };

        var teenResult = await (await teen.PostJsonAsync("v1/tenant/event", batch)).JsonAsync();
        var adultResult = await (await adult.PostJsonAsync("v1/tenant/event", batch)).JsonAsync();

        Assert.Equal(0, teenResult.GetProperty("accepted").GetInt32());
        Assert.All(teenResult.GetProperty("rejected").EnumerateArray(), r => Assert.Equal(AnalyticsRules.OptedOut, r.GetProperty("code").GetString()));
        Assert.Empty(await factory.Repository.GetAllAsync<AnalyticsActorEventEntity>(AnalyticsActorEventEntity.GetPk(teenAuth.TenantId)));
        Assert.Equal(2, adultResult.GetProperty("accepted").GetInt32());
    }

    [Fact]
    public async Task Notifications_MarketingAndSocialStayOff_MarketingConsentCannotBeGiven()
    {
        var (client, _, _) = await Teen.RegisterAsync(factory);
        var marketing = await client.PutJsonAsync("v1/tenant/consents", new { consents = new[] { new { type = "marketingNotifications", granted = true, version = "2026-11-19" } } });
        var contacts = await client.PutJsonAsync("v1/tenant/consents", new { consents = new[] { new { type = "contacts", granted = true, version = "2026-11-19" } } });
        Assert.Equal("marketing", (await marketing.JsonAsync()).GetProperty("feature").GetString());
        Assert.Equal("contacts", (await contacts.JsonAsync()).GetProperty("feature").GetString());

        var saved = await client.PutJsonAsync("v1/tenant/user/me/notifications", new
        {
            morningOutfit = true, morningOutfitLocalTime = "07:30", weeklyEdit = false, friendRatings = true, priceDrop = false, followRequests = true,
            timeZone = "Europe/Istanbul", baseVersion = 0,
        });
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        var prefs = await (await client.GetAsync("v1/tenant/user/me/notifications")).JsonAsync();
        Assert.True(prefs.GetProperty("morningOutfit").GetBoolean());
        Assert.False(prefs.GetProperty("friendRatings").GetBoolean());
        Assert.False(prefs.GetProperty("followRequests").GetBoolean());

        var consents = await (await client.GetAsync("v1/tenant/consents")).JsonAsync();
        Assert.Contains(consents.GetProperty("consents").EnumerateArray(), c => c.GetProperty("type").GetString() == "teenTryOn");
    }

    [Fact]
    public async Task LimitedMode_UntilTheParentApproves()
    {
        var (client, _, _) = await Teen.RegisterAsync(factory);
        foreach (var (url, body) in new (string, object)[]
        {
            ("v1/tenant/photo/upload-url", new { kind = "body", contentType = "image/jpeg" }),
            ("v1/tenant/item/upload-url", new { contentType = "image/jpeg" }),
            ("v1/tenant/stylist/outfit", new { requestId = "r1", date = "2026-12-01" }),
            ("v1/tenant/palette/analyze", new { }),
            ("v1/tenant/profile/avatar/upload-url", new { contentType = "image/jpeg" }),
        })
        {
            var response = await client.PostJsonAsync(url, body);
            var problem = await response.JsonAsync();
            Assert.True(response.StatusCode == HttpStatusCode.Forbidden, url);
            Assert.Equal("parental_consent_required", problem.GetProperty("code").GetString());
            Assert.Equal("pendingParentalConsent", problem.GetProperty("status").GetString());
        }
        // Without photos or AI the wardrobe works.
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("v1/tenant/item")).StatusCode);
    }

    [Fact]
    public async Task AdultConsent_TeenTryOn_IsRefused_AndNotListed()
    {
        var (adult, _) = await factory.RegisterAsync(grantConsents: false);
        var response = await adult.PutJsonAsync("v1/tenant/consents", new { consents = new[] { new { type = "teenTryOn", granted = true, version = "2026-11-19" } } });
        Assert.Equal("teen_restricted", await response.CodeAsync());
        var consents = await (await adult.GetAsync("v1/tenant/consents")).JsonAsync();
        Assert.DoesNotContain(consents.GetProperty("consents").EnumerateArray(), c => c.GetProperty("type").GetString() == "teenTryOn");
    }

    [Fact]
    public async Task Akis_EditorContent_IsOpenToTeens_FriendsFeedStaysClosed()
    {
        var (client, _, _) = await Teen.RegisterAsync(factory);
        var now = DateTime.UtcNow;
        var postId = Domain.Extensions.Ulid.New();
        await factory.Repository.SaveAsync(new FeedPostEntity
        {
            Id = postId, Author = new FeedAuthor { Kind = FeedAuthorKind.Edit, Name = new() { ["tr"] = "Droblet Edit" } }, Occasion = Occasion.Office,
            Title = new() { ["tr"] = "Ofis" }, ImageUrls = ["https://img.example/f.jpg"], PublishAt = now.AddMinutes(-1), Published = true, CreatedAt = now, UpdatedAt = now,
        });

        var feed = await client.GetAsync("v1/content/feed");
        var stories = await client.GetAsync("v1/content/feed/story");
        var like = await client.PutAsync($"v1/tenant/feed-post/{postId}/like", null);
        var save = await client.PutAsync($"v1/tenant/feed-post/{postId}/save", null);
        var saved = await client.GetAsync("v1/tenant/feed-post/saved");
        var unknown = await client.PutAsync($"v1/tenant/feed-post/{Domain.Extensions.Ulid.New()}/like", null);
        var friends = await client.GetAsync("v1/tenant/feed");

        Assert.Equal(HttpStatusCode.OK, feed.StatusCode);
        Assert.Contains((await feed.JsonAsync()).GetProperty("items").EnumerateArray(), p => p.GetProperty("id").GetString() == postId);
        Assert.Equal(HttpStatusCode.OK, stories.StatusCode);
        Assert.Equal(HttpStatusCode.OK, like.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, save.StatusCode);
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);                  // a plain 404, not teen_restricted
        Assert.Equal("social", (await friends.JsonAsync()).GetProperty("feature").GetString());
    }
}

/// <summary>Try-on gating: Teen:TryOnEnabled false (default) closes it outright; with it on, the parent's box and the teen's own consent both hold.</summary>
public class TeenTryOnGateDefaultTests(TeenApiFactory factory) : IClassFixture<TeenApiFactory>
{
    [Fact]
    public async Task FlagOff_ByDefault_TryOnIsNotAvailable_EvenWithEverythingElse()
    {
        var (client, _, _) = await Teen.ApprovedAsync(factory, allowTryOn: true);
        await client.PutJsonAsync("v1/tenant/consents", new { consents = new[] { new { type = "teenTryOn", granted = true, version = "2026-11-19" } } });

        var response = await client.PostJsonAsync("v1/tenant/tryon", new { requestId = Guid.NewGuid().ToString("N"), target = new { kind = "item", id = "i1" } });
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        var problem = await response.JsonAsync();
        Assert.Equal("teen_try_on_not_available", problem.GetProperty("code").GetString());
        Assert.Equal("feature_off", problem.GetProperty("reason").GetString());
    }
}

public class TeenTryOnGateTests(TeenTryOnApiFactory factory) : IClassFixture<TeenTryOnApiFactory>
{
    private static Task<HttpResponseMessage> TryOn(HttpClient client, string kind = "item") =>
        client.PostJsonAsync("v1/tenant/tryon", new { requestId = Guid.NewGuid().ToString("N"), target = new { kind, id = "i1" } });

    private static async Task<string?> Reason(HttpResponseMessage response) =>
        (await response.JsonAsync()).TryGetProperty("reason", out var r) ? r.GetString() : null;

    [Fact]
    public async Task AllThreeConditions_AreNeeded_OutfitPhotoTryOnNever()
    {
        // Parent approved without the try-on box.
        var (noBox, _, _) = await Teen.ApprovedAsync(factory, allowTryOn: false);
        await noBox.PutJsonAsync("v1/tenant/consents", new { consents = new[] { new { type = "teenTryOn", granted = true, version = "2026-11-19" } } });
        Assert.Equal("parent_not_allowed", await Reason(await TryOn(noBox)));

        // Parent's box, but not the teen's own consent.
        var (withBox, _, parent) = await Teen.ApprovedAsync(factory, allowTryOn: true);
        Assert.True((await Teen.StatusAsync(withBox)).GetProperty("teen").GetProperty("parentAllowedTryOn").GetBoolean());
        Assert.Equal("own_consent_missing", await Reason(await TryOn(withBox)));

        // All three: the teen gate lets it through (the usual photo consents / photo checks answer next).
        (await withBox.PutJsonAsync("v1/tenant/consents", new { consents = new[] { new { type = "teenTryOn", granted = true, version = "2026-11-19" } } })).EnsureSuccessStatusCode();
        Assert.True((await Teen.StatusAsync(withBox)).GetProperty("teen").GetProperty("tryOn").GetProperty("available").GetBoolean());
        var passed = await TryOn(withBox);
        Assert.NotEqual("teen_try_on_not_available", await passed.CodeAsync());
        Assert.NotEqual("teen_restricted", await passed.CodeAsync());

        // The outfit-photo try-on (a photo of another person) stays off whatever the consents.
        foreach (var kind in new[] { "photo", "importPhoto" })
        {
            var photo = await TryOn(withBox, kind);
            var problem = await photo.JsonAsync();
            Assert.Equal("teen_restricted", problem.GetProperty("code").GetString());
            Assert.Equal("outfitPhotoTryOn", problem.GetProperty("feature").GetString());
        }

        // Withdrawal closes it again.
        await factory.CreateClient().PostJsonAsync("v1/parent-consent/withdraw", new { token = Teen.LastToken(factory, parent) });
        Assert.Equal("parental_consent_required", await (await TryOn(withBox)).CodeAsync());
    }

    [Fact]
    public async Task PendingTeen_IsInLimitedMode_ForTryOn()
    {
        var (client, _, _) = await Teen.RegisterAsync(factory);
        Assert.Equal("parental_consent_required", await (await TryOn(client)).CodeAsync());
    }
}

/// <summary>Teen:Stylist — the free-tier teen stylist allowance (defaults: 3 outfits a day, 1 week plan a week, no packing).</summary>
public class TeenStylistEndpointTests(TeenApiFactory factory) : IClassFixture<TeenApiFactory>
{
    private static Task<HttpResponseMessage> Outfit(HttpClient client) =>
        client.PostJsonAsync("v1/tenant/stylist/outfit", new { requestId = Domain.Extensions.Ulid.New(), date = "2026-12-01" });

    [Fact]
    public async Task ApprovedTeen_GetsThreeOutfits_ThenTheDailyLimitWithResetsAt_StatusShowsTheAllowance()
    {
        var (client, _, _) = await Teen.ApprovedAsync(factory);
        var before = (await Teen.StatusAsync(client)).GetProperty("teen").GetProperty("stylist");
        Assert.True(before.GetProperty("enabled").GetBoolean());
        Assert.Equal((3, 0, 3), (before.GetProperty("dailyLimit").GetInt32(), before.GetProperty("usedToday").GetInt32(), before.GetProperty("remainingToday").GetInt32()));
        Assert.Equal((1, 0), (before.GetProperty("weekPlanLimit").GetInt32(), before.GetProperty("tripPackLimit").GetInt32()));

        for (var i = 0; i < 3; i++)
            Assert.Equal(HttpStatusCode.Accepted, (await Outfit(client)).StatusCode);
        var over = await Outfit(client);
        var problem = await over.JsonAsync();
        var week = await client.PostJsonAsync("v1/tenant/stylist/week", new { requestId = Domain.Extensions.Ulid.New(), weekStart = "2026-11-30" });
        var secondWeek = await client.PostJsonAsync("v1/tenant/stylist/week", new { requestId = Domain.Extensions.Ulid.New(), weekStart = "2026-11-30" });

        Assert.Equal(HttpStatusCode.TooManyRequests, over.StatusCode);
        Assert.Equal("teen_stylist_daily_limit", problem.GetProperty("code").GetString());
        Assert.True(problem.GetProperty("resetsAt").GetDateTime() > DateTime.UtcNow);
        Assert.Equal(HttpStatusCode.Accepted, week.StatusCode);
        Assert.Equal("teen_stylist_weekly_limit", await secondWeek.CodeAsync());

        var after = (await Teen.StatusAsync(client)).GetProperty("teen").GetProperty("stylist");
        Assert.Equal((3, 0, 1), (after.GetProperty("usedToday").GetInt32(), after.GetProperty("remainingToday").GetInt32(), after.GetProperty("weekPlanUsed").GetInt32()));
    }

    [Fact]
    public async Task PendingTeen_StaysParentalConsentRequired_AdultFree_StaysPremiumRequired()
    {
        var (teen, _, _) = await Teen.RegisterAsync(factory);
        var (adult, _) = await factory.RegisterAsync();

        Assert.Equal("parental_consent_required", await (await Outfit(teen)).CodeAsync());
        var denied = await Outfit(adult);
        Assert.Equal((HttpStatusCode.Forbidden, "premium_required"), (denied.StatusCode, await denied.CodeAsync()));
    }
}

internal static class StringHashExtensions
{
    public static string Sha256(this string value) => Domain.Extensions.HashExtensions.Sha256Hex(value);
}
