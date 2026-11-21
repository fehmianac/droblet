using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Domain.Entity;
using Domain.Enum;

namespace ApiTests;

/// <summary>Admin panel API (docs/api/admin.md): sign-in, token separation, role matrix, audit, settings, app users.</summary>
public class AdminEndpointTests(StoreSocialApiFactory factory) : IClassFixture<StoreSocialApiFactory>
{
    private static string NewEmail(string prefix = "admin") => $"{prefix}-{Guid.NewGuid():N}@droblet.test";

    private async Task<(string Email, string Id)> NewAdminAsync(AdminRole role = AdminRole.SuperAdmin, bool disabled = false)
    {
        var email = NewEmail(role.ToString().ToLowerInvariant());
        return (email, await factory.SeedAdminAsync(email, role, disabled));
    }

    private async Task<string> ChallengeAsync(HttpClient client, string email)
    {
        var login = await client.PostJsonAsync("v1/admin/auth/login", new { email, password = StoreSocialApiFactory.AdminPassword });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var body = await login.JsonAsync();
        Assert.Equal(6, body.GetProperty("codeLength").GetInt32());
        return body.GetProperty("challengeId").GetString()!;
    }

    // ── Token separation ────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task AppUserToken_Gets401_OnEveryKindOfAdminRoute_AndAdminToken_Gets401_OnAppRoutes()
    {
        var (user, _) = await factory.RegisterAsync();
        foreach (var path in new[] { "v1/admin/auth/me", "v1/admin/dashboard", "v1/admin/user", "v1/admin/setting", "v1/admin/admin-user", "v1/admin/audit", "v1/admin/library" })
            Assert.Equal(HttpStatusCode.Unauthorized, (await user.GetAsync(path)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await user.PostJsonAsync("v1/admin/auth/logout-all", new { })).StatusCode);

        var admin = await factory.AdminAsync();
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync("v1/admin/auth/me")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await admin.GetAsync("v1/tenant/profile")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await admin.GetAsync("v1/catalog/product")).StatusCode);
    }

    [Fact]
    public async Task TokenSignedWithTheAppKey_ButAdminClaims_IsRejected()
    {
        // An attacker who only knows the app signing key cannot mint an admin token.
        var (_, id) = await NewAdminAsync();
        var handler = new Microsoft.IdentityModel.JsonWebTokens.JsonWebTokenHandler();
        var forged = handler.CreateToken(new Microsoft.IdentityModel.Tokens.SecurityTokenDescriptor
        {
            Issuer = "droblet-admin",
            Audience = "droblet-admin-panel",
            Expires = DateTime.UtcNow.AddMinutes(5),
            Claims = new Dictionary<string, object> { ["sub"] = id, ["token_use"] = "admin" },
            SigningCredentials = new Microsoft.IdentityModel.Tokens.SigningCredentials(
                new Microsoft.IdentityModel.Tokens.SymmetricSecurityKey(System.Text.Encoding.UTF8.GetBytes("test-only-signing-key-0123456789-abcdefghijklmnop")),
                Microsoft.IdentityModel.Tokens.SecurityAlgorithms.HmacSha256),
        });
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.AdminClient(forged).GetAsync("v1/admin/auth/me")).StatusCode);
    }

    // ── Sign-in ──────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task SignIn_WrongPassword401_UnknownEmailSameAnswer_CodeStep_SingleUse()
    {
        var (email, _) = await NewAdminAsync();
        var client = factory.CreateClient();

        var wrong = await client.PostJsonAsync("v1/admin/auth/login", new { email, password = "Wrong-password-1" });
        var unknown = await client.PostJsonAsync("v1/admin/auth/login", new { email = NewEmail("nobody"), password = "Wrong-password-1" });
        Assert.Equal((HttpStatusCode.Unauthorized, "invalid_credentials"), (wrong.StatusCode, await wrong.CodeAsync()));
        Assert.Equal((HttpStatusCode.Unauthorized, "invalid_credentials"), (unknown.StatusCode, await unknown.CodeAsync()));

        var challengeId = await ChallengeAsync(client, email.ToUpperInvariant()); // e-mail is case-insensitive
        var code = factory.LastCodeFor(email);
        Assert.Matches("^[0-9]{6}$", code);

        var ok = await client.PostJsonAsync("v1/admin/auth/verify", new { challengeId, code });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var session = await ok.JsonAsync();
        Assert.Equal("superAdmin", session.GetProperty("admin").GetProperty("role").GetString());
        Assert.Contains("settings.manage", session.GetProperty("admin").GetProperty("permissions").EnumerateArray().Select(p => p.GetString()));

        var again = await client.PostJsonAsync("v1/admin/auth/verify", new { challengeId, code });
        Assert.Equal((HttpStatusCode.Unauthorized, "challenge_expired"), (again.StatusCode, await again.CodeAsync()));
    }

    [Fact]
    public async Task Code_FiveWrongTries_ThenTheChallengeIsGone_EvenForTheRightCode()
    {
        var (email, _) = await NewAdminAsync();
        var client = factory.CreateClient();
        var challengeId = await ChallengeAsync(client, email);
        var code = factory.LastCodeFor(email);
        var wrongCode = code == "000000" ? "111111" : "000000";

        for (var left = 4; left >= 0; left--)
        {
            var wrong = await client.PostJsonAsync("v1/admin/auth/verify", new { challengeId, code = wrongCode });
            Assert.Equal((HttpStatusCode.Unauthorized, "invalid_code"), (wrong.StatusCode, await wrong.CodeAsync()));
            Assert.Equal(left, (await wrong.JsonAsync()).GetProperty("attemptsLeft").GetInt32());
        }
        var right = await client.PostJsonAsync("v1/admin/auth/verify", new { challengeId, code });
        Assert.Equal((HttpStatusCode.Unauthorized, "challenge_expired"), (right.StatusCode, await right.CodeAsync()));
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostJsonAsync("v1/admin/auth/verify", new { challengeId, code = "12ab56" })).StatusCode);
    }

    [Fact]
    public async Task Lockout_AfterTenAttemptsPerEmail_EvenTheRightPasswordGets429()
    {
        var (email, _) = await NewAdminAsync();
        var client = factory.CreateClient();
        for (var i = 0; i < 10; i++)
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostJsonAsync("v1/admin/auth/login", new { email, password = $"Wrong-{i}-password" })).StatusCode);

        var locked = await client.PostJsonAsync("v1/admin/auth/login", new { email, password = StoreSocialApiFactory.AdminPassword });
        Assert.Equal((HttpStatusCode.TooManyRequests, "too_many_attempts"), (locked.StatusCode, await locked.CodeAsync()));
    }

    [Fact]
    public async Task Refresh_Rotates_ReuseRevokesAll_LogoutAll_DisabledAdmin()
    {
        var (email, id) = await NewAdminAsync();
        var session = await factory.AdminSignInAsync(email, StoreSocialApiFactory.AdminPassword);
        var client = factory.CreateClient();
        var first = session.GetProperty("refreshToken").GetString()!;

        var rotated = await client.PostJsonAsync("v1/admin/auth/refresh", new { refreshToken = first });
        Assert.Equal(HttpStatusCode.OK, rotated.StatusCode);
        var second = (await rotated.JsonAsync()).GetProperty("refreshToken").GetString()!;
        Assert.NotEqual(first, second);

        // Reuse of the rotated token = theft: every session ends, the new token too.
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostJsonAsync("v1/admin/auth/refresh", new { refreshToken = first })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostJsonAsync("v1/admin/auth/refresh", new { refreshToken = second })).StatusCode);

        await Task.Delay(1100); // tokens carry whole-second iat; a new session must be issued after the revocation second
        var fresh = await factory.AdminSignInAsync(email, StoreSocialApiFactory.AdminPassword);
        var admin = factory.AdminClient(fresh.GetProperty("accessToken").GetString()!);
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync("v1/admin/auth/me")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostJsonAsync("v1/admin/auth/logout-all", new { })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await admin.GetAsync("v1/admin/auth/me")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await client.PostJsonAsync("v1/admin/auth/refresh", new { refreshToken = fresh.GetProperty("refreshToken").GetString() })).StatusCode);

        // Disabled: the very next request fails, whatever the token says.
        await Task.Delay(1100);
        var third = await factory.AdminSignInAsync(email, StoreSocialApiFactory.AdminPassword);
        var thirdClient = factory.AdminClient(third.GetProperty("accessToken").GetString()!);
        var row = (await factory.Repository.GetAsync<AdminUserEntity>(AdminUserEntity.GetPk(), AdminUserEntity.GetSk(id)))!;
        row.Disabled = true;
        await factory.Repository.SaveAsync(row);
        Assert.Equal(HttpStatusCode.Unauthorized, (await thirdClient.GetAsync("v1/admin/auth/me")).StatusCode);
    }

    [Fact]
    public async Task Bootstrap_CreatesTheFirstSuperAdminWithoutPassword_OwnerSetsItByEmail()
    {
        var client = factory.CreateClient();
        var email = StoreSocialApiFactory.BootstrapEmail;

        // No password yet: sign-in fails the same way as a wrong password.
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostJsonAsync("v1/admin/auth/login", new { email, password = "Anything-123" })).StatusCode);
        var index = await factory.Repository.GetAsync<AdminEmailIndexEntity>(AdminEmailIndexEntity.GetPk(), AdminEmailIndexEntity.GetSk(email));
        Assert.NotNull(index);
        var admin = await factory.Repository.GetAsync<AdminUserEntity>(AdminUserEntity.GetPk(), AdminUserEntity.GetSk(index.AdminId));
        Assert.Equal((AdminRole.SuperAdmin, false), (admin!.Role, admin.PasswordSet));

        Assert.Equal(HttpStatusCode.Accepted, (await client.PostJsonAsync("v1/admin/auth/password/forgot", new { email })).StatusCode);
        var token = factory.LastLinkTokenFor(email);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostJsonAsync("v1/admin/auth/password/reset", new { token, newPassword = "short1" })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostJsonAsync("v1/admin/auth/password/reset", new { token, newPassword = "Owner-password-2026" })).StatusCode);
        var reused = await client.PostJsonAsync("v1/admin/auth/password/reset", new { token, newPassword = "Owner-password-2027" });
        Assert.Equal((HttpStatusCode.BadRequest, "invalid_token"), (reused.StatusCode, await reused.CodeAsync()));

        var session = await factory.AdminSignInAsync(email, "Owner-password-2026");
        Assert.Equal("superAdmin", session.GetProperty("admin").GetProperty("role").GetString());
        Assert.Single(await factory.Repository.GetAllAsync<AdminUserEntity>(AdminUserEntity.GetPk()), a => a.Email == email);
    }

    // ── Role matrix ──────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task RoleMatrix_IsEnforcedOnTheServer()
    {
        var editor = await factory.AdminAsync(AdminRole.ContentEditor);
        var moderator = await factory.AdminAsync(AdminRole.Moderator);
        var super = await factory.AdminAsync();

        async Task Expect(HttpClient client, string path, HttpStatusCode status) => Assert.Equal(status, (await client.GetAsync(path)).StatusCode);

        foreach (var path in new[] { "v1/admin/brand", "v1/admin/product", "v1/admin/edit", "v1/admin/collection/creator", "v1/admin/library", "v1/admin/report/revenue", "v1/admin/dashboard" })
        {
            await Expect(editor, path, HttpStatusCode.OK);
            await Expect(super, path, HttpStatusCode.OK);
        }
        foreach (var path in new[] { "v1/admin/user", "v1/admin/moderation/report", "v1/admin/setting", "v1/admin/admin-user", "v1/admin/audit" })
            await Expect(editor, path, HttpStatusCode.Forbidden);

        foreach (var path in new[] { "v1/admin/user", "v1/admin/moderation/report", "v1/admin/dashboard" })
            await Expect(moderator, path, HttpStatusCode.OK);
        foreach (var path in new[] { "v1/admin/brand", "v1/admin/product", "v1/admin/edit", "v1/admin/library", "v1/admin/report/revenue", "v1/admin/report/funnel", "v1/admin/setting", "v1/admin/admin-user", "v1/admin/audit" })
            await Expect(moderator, path, HttpStatusCode.Forbidden);

        var forbidden = await moderator.PutJsonAsync("v1/admin/brand/mod-brand", new { name = "X", source = "network" });
        Assert.Equal((HttpStatusCode.Forbidden, "forbidden"), (forbidden.StatusCode, await forbidden.CodeAsync()));
        var (_, auth) = await factory.RegisterAsync();
        Assert.Equal(HttpStatusCode.Forbidden, (await moderator.PutJsonAsync($"v1/admin/user/{auth.UserId}/test-premium", new { days = 7 })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await moderator.DeleteAsync($"v1/admin/user/{auth.UserId}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await moderator.PostJsonAsync("v1/admin/image/upload-url", new { purpose = "product", contentType = "image/png" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await editor.PostJsonAsync("v1/admin/image/upload-url", new { purpose = "product", contentType = "image/png" })).StatusCode);
    }

    // ── Admin users + audit ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task AdminUsers_InviteUniqueEmail_SelfAndLastSuperAdminGuards_AuditTrail()
    {
        var super = await factory.AdminAsync();
        var email = NewEmail("invitee");

        var created = await super.PostJsonAsync("v1/admin/admin-user", new { email = email.ToUpperInvariant(), name = "Editör", role = "contentEditor" });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var id = (await created.JsonAsync()).GetProperty("id").GetString()!;
        Assert.Contains("reset-password/?token=", factory.Email.Sent.Last(m => m.To == email).TextBody);
        var duplicate = await super.PostJsonAsync("v1/admin/admin-user", new { email, name = "Again", role = "moderator" });
        Assert.Equal((HttpStatusCode.Conflict, "email_taken"), (duplicate.StatusCode, await duplicate.CodeAsync()));

        var me = (await (await super.GetAsync("v1/admin/auth/me")).JsonAsync()).GetProperty("id").GetString()!;
        var self = await super.PutJsonAsync($"v1/admin/admin-user/{me}", new { name = "Me", role = "moderator", disabled = false });
        Assert.Equal((HttpStatusCode.UnprocessableEntity, "cannot_change_self"), (self.StatusCode, await self.CodeAsync()));
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await super.DeleteAsync($"v1/admin/admin-user/{me}")).StatusCode);

        var promoted = await super.PutJsonAsync($"v1/admin/admin-user/{id}", new { name = "Editör", role = "moderator", disabled = false });
        Assert.Equal("moderator", (await promoted.JsonAsync()).GetProperty("role").GetString());
        Assert.Equal(HttpStatusCode.NoContent, (await super.DeleteAsync($"v1/admin/admin-user/{id}")).StatusCode);

        var audit = await (await super.GetAsync("v1/admin/audit?limit=100")).JsonAsync();
        var actions = audit.GetProperty("items").EnumerateArray().Where(e => e.GetProperty("targetId").GetString() == id).Select(e => e.GetProperty("action").GetString()).ToList();
        Assert.Contains("admin.create", actions);
        Assert.Contains("admin.update", actions);
        Assert.Contains("admin.delete", actions);
        var update = audit.GetProperty("items").EnumerateArray().First(e => e.GetProperty("action").GetString() == "admin.update" && e.GetProperty("targetId").GetString() == id);
        Assert.Contains("contentEditor", update.GetProperty("before").GetString());
        Assert.Contains("moderator", update.GetProperty("after").GetString());
    }

    [Fact]
    public async Task ContentWrites_AreAudited_WithBeforeAndAfter()
    {
        var admin = await factory.AdminAsync();
        var brand = await factory.SeedBrandAsync(admin);
        (await admin.PutJsonAsync($"v1/admin/brand/{brand}", new { name = "Yeni Ad", source = "direct" })).EnsureSuccessStatusCode();

        var audit = await (await admin.GetAsync("v1/admin/audit?action=brand.&limit=100")).JsonAsync();
        var entries = audit.GetProperty("items").EnumerateArray().Where(e => e.GetProperty("targetId").GetString() == brand).ToList();
        Assert.Equal(2, entries.Count);
        var latest = entries[0];
        Assert.Equal(("brand.upsert", "brand"), (latest.GetProperty("action").GetString(), latest.GetProperty("targetType").GetString()));
        Assert.Contains("Marka", latest.GetProperty("before").GetString());
        Assert.Contains("Yeni Ad", latest.GetProperty("after").GetString());
        Assert.Equal(JsonValueKind.Null, entries[1].GetProperty("before").ValueKind);
        Assert.Equal(StoreSocialApiFactory.AdminEmail, latest.GetProperty("adminEmail").GetString());
    }

    // ── Settings ─────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Settings_ValidatedWritesReachEveryParameterOfTheGroup_OtherKeysKept_Audited()
    {
        factory.Settings.Values["/droblet/dev/api/Entitlements"] = """{"Premium":{"TryOnCreditsPerMonth":30},"Free":{"ItemRecognitionLimit":10}}""";
        factory.Settings.Values["/droblet/dev/worker/Entitlements"] = """{"Premium":{"TryOnCreditsPerMonth":30},"Free":{"ItemRecognitionLimit":10}}""";
        factory.Settings.Values["/droblet/dev/worker/Ai"] = """{"Enabled":false,"Provider":"OpenAI","TextModel":"gpt-6-astra"}""";
        var admin = await factory.AdminAsync();

        var all = await (await admin.GetAsync("v1/admin/setting")).JsonAsync();
        var groups = all.EnumerateArray().Select(g => g.GetProperty("group").GetString()).ToList();
        Assert.Equal(["entitlements", "packing", "ai", "notifications", "notifierSchedule", "authRateLimits"], groups);
        Assert.DoesNotContain("Jwt", all.GetRawText());
        Assert.DoesNotContain("ApiKey", all.GetRawText());

        var ok = await admin.PutJsonAsync("v1/admin/setting/entitlements", new { values = new Dictionary<string, object> { ["Free.ItemRecognitionLimit"] = 15 } });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        foreach (var scope in new[] { "api", "worker" })
        {
            var stored = JsonDocument.Parse(factory.Settings.Values[$"/droblet/dev/{scope}/Entitlements"]).RootElement;
            Assert.Equal(15, stored.GetProperty("Free").GetProperty("ItemRecognitionLimit").GetInt32());
            Assert.Equal(30, stored.GetProperty("Premium").GetProperty("TryOnCreditsPerMonth").GetInt32());
        }

        var ai = await admin.PutJsonAsync("v1/admin/setting/ai", new { values = new Dictionary<string, object> { ["Enabled"] = true } });
        Assert.Equal(HttpStatusCode.OK, ai.StatusCode);
        Assert.Contains("\"TextModel\":\"gpt-6-astra\"", factory.Settings.Values["/droblet/dev/worker/Ai"]);

        var invalid = await admin.PutJsonAsync("v1/admin/setting/entitlements", new { values = new Dictionary<string, object> { ["Free.ItemRecognitionLimit"] = -1, ["ApiKey"] = "x" } });
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        var errors = (await invalid.JsonAsync()).GetProperty("errors");
        Assert.Equal("out_of_range", errors.GetProperty("Free.ItemRecognitionLimit")[0].GetString());
        Assert.Equal("unknown_field", errors.GetProperty("ApiKey")[0].GetString());
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PutJsonAsync("v1/admin/setting/jwt", new { values = new Dictionary<string, object> { ["SecretKey"] = "x" } })).StatusCode);

        var audit = await (await admin.GetAsync("v1/admin/audit?action=setting.&limit=100")).JsonAsync();
        Assert.Contains(audit.GetProperty("items").EnumerateArray(), e => e.GetProperty("targetId").GetString() == "entitlements" && e.GetProperty("after").GetString()!.Contains("15"));
    }

    // ── App users ────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task TestPremium_AndCredits_AreGrantedRevokedAndAudited()
    {
        var admin = await factory.AdminAsync();
        var (user, auth) = await factory.RegisterAsync();

        var granted = await (await admin.PutJsonAsync($"v1/admin/user/{auth.UserId}/test-premium", new { days = 7, note = "QA" })).JsonAsync();
        Assert.Equal(("premium", "admin"), (granted.GetProperty("entitlement").GetProperty("tier").GetString(), granted.GetProperty("entitlement").GetProperty("source").GetString()));
        Assert.NotEqual(JsonValueKind.Null, granted.GetProperty("entitlement").GetProperty("testPremiumExpiresAt").ValueKind);
        Assert.Equal("premium", (await (await user.GetAsync("v1/tenant/entitlement")).JsonAsync()).GetProperty("tier").GetString());

        var credited = await (await admin.PostJsonAsync($"v1/admin/user/{auth.UserId}/credits", new { credits = 20 })).JsonAsync();
        Assert.Equal(20, credited.GetProperty("credits").GetProperty("packBalance").GetInt32());
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostJsonAsync($"v1/admin/user/{auth.UserId}/credits", new { credits = 501 })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutJsonAsync($"v1/admin/user/{auth.UserId}/test-premium", new { days = 91 })).StatusCode);

        var revoked = await (await admin.DeleteAsync($"v1/admin/user/{auth.UserId}/test-premium")).JsonAsync();
        Assert.Equal("free", revoked.GetProperty("entitlement").GetProperty("tier").GetString());

        var audit = await (await admin.GetAsync("v1/admin/audit?action=user.&limit=100")).JsonAsync();
        var mine = audit.GetProperty("items").EnumerateArray().Where(e => e.GetProperty("targetId").GetString() == auth.UserId).ToList();
        Assert.Equal(["user.test_premium_revoke", "user.credits_add", "user.test_premium_grant"], mine.Select(e => e.GetProperty("action").GetString()).ToList());
        Assert.All(mine, e => Assert.Contains("\"test\":true", e.GetProperty("after").GetString()));
    }

    [Fact]
    public async Task Suspend_BlocksSignInAndRefresh_Unsuspend_Restores_DetailHasNoImages()
    {
        var admin = await factory.AdminAsync(AdminRole.Moderator);
        var email = NewEmail("user");
        var (_, auth) = await factory.RegisterAsync(email);
        var client = factory.CreateClient();

        var found = await (await admin.GetAsync($"v1/admin/user?q={Uri.EscapeDataString(email)}")).JsonAsync();
        Assert.Equal(auth.UserId, found.GetProperty("items")[0].GetProperty("id").GetString());

        var suspended = await (await admin.PostJsonAsync($"v1/admin/user/{auth.UserId}/suspend", new { reason = "spam" })).JsonAsync();
        Assert.True(suspended.GetProperty("suspended").GetBoolean());
        var raw = suspended.GetRawText();
        Assert.DoesNotContain("photo", raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("imageUrl", raw, StringComparison.OrdinalIgnoreCase);

        var login = await client.PostJsonAsync("v1/auth/login", new { email, password = StoreSocialApiFactory.Password });
        Assert.Equal((HttpStatusCode.Forbidden, "account_suspended"), (login.StatusCode, await login.CodeAsync()));
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostJsonAsync("v1/auth/refresh", new { refreshToken = auth.RefreshToken })).StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await admin.PostJsonAsync($"v1/admin/user/{auth.UserId}/unsuspend", new { })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PostJsonAsync("v1/auth/login", new { email, password = StoreSocialApiFactory.Password })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync("v1/admin/user/NOPE")).StatusCode);
    }

    [Fact]
    public async Task ModerationBlock_SuspendsTheReportedAccount()
    {
        var moderator = await factory.AdminAsync(AdminRole.Moderator);
        var reporter = await factory.UserAsync();
        var target = await factory.UserAsync();
        var created = await reporter.Client.PostJsonAsync($"v1/tenant/people/{target.Handle}/report", new { targetKind = "profile", reason = "spam" });
        created.EnsureSuccessStatusCode();
        var reportId = (await created.JsonAsync()).GetProperty("reportId").GetString();

        var resolved = await moderator.PostJsonAsync($"v1/admin/moderation/report/{reportId}/resolve", new { resolution = "userSuspended", note = "repeat" });
        Assert.Equal(HttpStatusCode.OK, resolved.StatusCode);
        var user = await factory.Repository.GetAsync<UserEntity>(UserEntity.GetPk(), UserEntity.GetSk(target.UserId));
        Assert.NotNull(user!.SuspendedAt);
        Assert.StartsWith($"report:{reportId}", user.SuspendReason);
    }

    // ── Library, images, bulk preview, dashboard ─────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Library_FirstWriteKeepsTheSeed_ValidationAndRetire()
    {
        var admin = await factory.AdminAsync(AdminRole.ContentEditor);
        var before = await (await admin.GetAsync("v1/admin/library")).JsonAsync();
        var seedCount = before.GetArrayLength();
        Assert.True(seedCount > 0);

        var invalid = await admin.PutJsonAsync("v1/admin/library/lib-test-scarf", new { name = new { en = "Scarf" }, category = "accessory", colorIds = new[] { "nope" }, seasons = Array.Empty<string>(), sortOrder = 5 });
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        var errors = (await invalid.JsonAsync()).GetProperty("errors");
        Assert.True(errors.TryGetProperty("name", out _) && errors.TryGetProperty("colorIds", out _) && errors.TryGetProperty("seasons", out _));

        var ok = await admin.PutJsonAsync("v1/admin/library/lib-test-scarf", new
        {
            name = new { tr = "İpek eşarp", en = "Silk scarf" }, category = "accessory", colorIds = new[] { "white" }, seasons = new[] { "spring" },
            imageUrl = "https://test-catalog-images.s3.eu-central-1.amazonaws.com/catalog/library/x.png", sortOrder = 5,
        });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var after = await (await admin.GetAsync("v1/admin/library")).JsonAsync();
        Assert.Equal(seedCount + 1, after.GetArrayLength());
        Assert.All(after.EnumerateArray(), i => Assert.True(i.GetProperty("stored").GetBoolean()));

        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync("v1/admin/library/lib-test-scarf")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.DeleteAsync("v1/admin/library/lib-does-not-exist")).StatusCode);
    }

    [Fact]
    public async Task Library_Segment_RoundTrips_AndTheMensSeedNeedsImages()
    {
        var admin = await factory.AdminAsync(AdminRole.SuperAdmin);
        var list = (await (await admin.GetAsync("v1/admin/library")).JsonAsync()).EnumerateArray().ToList();
        var menSeed = list.Where(i => i.GetProperty("segment").GetString() == "men").ToList();
        Assert.True(menSeed.Count >= 25);
        Assert.All(menSeed, i => Assert.True(i.GetProperty("needsImage").GetBoolean()));

        var badSegment = await admin.PutJsonAsync("v1/admin/library/lib-test-tie", new { name = new { tr = "Kravat" }, category = "accessory", colorIds = new[] { "navy" }, seasons = new[] { "winter" }, sortOrder = 5, segment = "kids" });
        Assert.Equal(HttpStatusCode.BadRequest, badSegment.StatusCode);
        var ok = await admin.PutJsonAsync("v1/admin/library/lib-test-tie", new { name = new { tr = "Kravat" }, category = "accessory", colorIds = new[] { "navy" }, seasons = new[] { "winter" }, sortOrder = 5, segment = "unisex" });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        Assert.Equal(("unisex", true), ((await ok.JsonAsync()).GetProperty("segment").GetString(), (await ok.JsonAsync()).GetProperty("needsImage").GetBoolean()));
        Assert.Equal(CatalogSegment.Unisex, (await factory.Repository.GetAsync<LibraryItemEntity>(LibraryItemEntity.GetPk(), LibraryItemEntity.GetSk("lib-test-tie")))!.Segment);
        // After the first write the men's seed pieces are still listed (served from the seed until edited).
        var after = (await (await admin.GetAsync("v1/admin/library")).JsonAsync()).EnumerateArray().ToList();
        Assert.Equal(menSeed.Count, after.Count(i => i.GetProperty("segment").GetString() == "men"));
    }

    [Fact]
    public async Task ImageUpload_ReturnsAPresignedPostOnThePublicCatalogBucket()
    {
        var admin = await factory.AdminAsync(AdminRole.ContentEditor);
        var bad = await admin.PostJsonAsync("v1/admin/image/upload-url", new { purpose = "product", contentType = "image/gif" });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);

        var response = await admin.PostJsonAsync("v1/admin/image/upload-url", new { purpose = "product", contentType = "image/png" });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var upload = await response.JsonAsync();
        Assert.StartsWith("catalog/product/", upload.GetProperty("key").GetString());
        Assert.StartsWith("https://test-catalog-images.s3.eu-central-1.amazonaws.com/catalog/product/", upload.GetProperty("publicUrl").GetString());
        Assert.Equal("image/png", upload.GetProperty("fields").GetProperty("Content-Type").GetString());
    }

    [Fact]
    public async Task BulkDryRun_ValidatesWithoutWriting()
    {
        var admin = await factory.AdminAsync(AdminRole.ContentEditor);
        var brand = await factory.SeedBrandAsync(admin);
        var id = StoreSocialApiFactory.Unique("prod-");
        var body = new
        {
            products = new object[]
            {
                new { id, brandId = brand, name = StoreSocialApiFactory.Text("Gömlek", "Shirt"), category = "shirt", priceMinor = 1000, priceBand = "highStreet" },
                new { id = "BAD ID", brandId = brand, name = StoreSocialApiFactory.Text("X"), category = "shirt", priceMinor = 0, priceBand = "highStreet" },
            },
        };
        var preview = await (await admin.PostJsonAsync("v1/admin/product/bulk?dryRun=true", body)).JsonAsync();
        Assert.Equal((1, 1), (preview.GetProperty("created").GetInt32(), preview.GetProperty("failed").GetInt32()));
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync($"v1/admin/product/{id}")).StatusCode);

        (await admin.PostJsonAsync("v1/admin/product/bulk", body)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync($"v1/admin/product/{id}")).StatusCode);
    }

    [Fact]
    public async Task Products_Segment_ImportedOrOmitted_KeptOnUpdate_FilteredInTheList()
    {
        var admin = await factory.AdminAsync(AdminRole.ContentEditor);
        var brand = await factory.SeedBrandAsync(admin);
        var (men, plain, bad) = (StoreSocialApiFactory.Unique("prod-m-"), StoreSocialApiFactory.Unique("prod-w-"), StoreSocialApiFactory.Unique("prod-x-"));
        object Row(string id, string? segment) => segment is null
            ? new { id, brandId = brand, name = StoreSocialApiFactory.Text("Gömlek", "Shirt"), category = "shirt", priceMinor = 1000, priceBand = "highStreet" }
            : new { id, brandId = brand, name = StoreSocialApiFactory.Text("Gömlek", "Shirt"), category = "shirt", priceMinor = 1000, priceBand = "highStreet", segment };

        var import = await (await admin.PostJsonAsync("v1/admin/product/bulk", new { products = new[] { Row(men, "men"), Row(plain, null) } })).JsonAsync();
        Assert.Equal(2, import.GetProperty("created").GetInt32());
        // An unknown value is not a segment: the body does not bind (the CSV import checks the column per row first).
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostJsonAsync("v1/admin/product/bulk", new { products = new[] { Row(bad, "kids") } })).StatusCode);

        Assert.Equal("men", (await (await admin.GetAsync($"v1/admin/product/{men}")).JsonAsync()).GetProperty("segment").GetString());
        Assert.Equal("women", (await (await admin.GetAsync($"v1/admin/product/{plain}")).JsonAsync()).GetProperty("segment").GetString());
        // A feed without the column keeps the admin's choice.
        (await admin.PostJsonAsync("v1/admin/product/bulk", new { products = new[] { Row(men, null) } })).EnsureSuccessStatusCode();
        Assert.Equal("men", (await (await admin.GetAsync($"v1/admin/product/{men}")).JsonAsync()).GetProperty("segment").GetString());

        var filtered = (await (await admin.GetAsync("v1/admin/product?segment=men&limit=200")).JsonAsync()).GetProperty("items").EnumerateArray().Select(p => p.GetProperty("id").GetString()).ToList();
        Assert.Contains(men, filtered);
        Assert.DoesNotContain(plain, filtered);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.GetAsync("v1/admin/product?segment=kids")).StatusCode);
    }

    [Fact]
    public async Task Dashboard_CountsUsersCatalogContentAndReports()
    {
        var admin = await factory.AdminAsync(AdminRole.Moderator);
        await factory.RegisterAsync();
        var dashboard = await (await admin.GetAsync("v1/admin/dashboard")).JsonAsync();
        Assert.True(dashboard.GetProperty("users").GetProperty("total").GetInt32() >= 1);
        Assert.True(dashboard.GetProperty("users").GetProperty("last7Days").GetInt32() >= 1);
        Assert.True(dashboard.GetProperty("content").GetProperty("libraryItems").GetInt32() > 0);
    }

    // ── CORS ─────────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Cors_AdminRoutesAnswerOnlyThePanelOrigin_OtherRoutesStayPublic()
    {
        var client = factory.CreateClient();
        async Task<HttpResponseMessage> Preflight(string path, string origin)
        {
            var request = new HttpRequestMessage(HttpMethod.Options, path);
            request.Headers.Add("Origin", origin);
            request.Headers.Add("Access-Control-Request-Method", "POST");
            return await client.SendAsync(request);
        }

        var panel = await Preflight("v1/admin/auth/login", StoreSocialApiFactory.AdminOrigin);
        Assert.Equal(HttpStatusCode.NoContent, panel.StatusCode);
        Assert.Equal(StoreSocialApiFactory.AdminOrigin, panel.Headers.GetValues("Access-Control-Allow-Origin").Single());

        var evil = await Preflight("v1/admin/auth/login", "https://evil.example");
        Assert.False(evil.Headers.Contains("Access-Control-Allow-Origin"));

        var app = await Preflight("v1/auth/password/forgot", "https://droblet.alatech.co");
        Assert.Equal("*", app.Headers.GetValues("Access-Control-Allow-Origin").Single());
    }
}
