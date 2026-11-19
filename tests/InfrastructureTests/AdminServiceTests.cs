using System.Text.Json;
using Domain.Entity;
using Domain.Enum;
using Domain.Extensions;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Domain.Services.Admin;
using Infrastructure.Services;
using Infrastructure.Services.Admin;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Time.Testing;
using Tests.Shared;

namespace InfrastructureTests;

/// <summary>Admin sign-in, admin users, audit and settings services with an in-memory table and a fake clock.</summary>
public class AdminServiceTests
{
    private const string Password = "Admin-password-1";

    private sealed class Mailbox : IEmailService
    {
        public List<EmailMessage> Sent { get; } = [];
        public bool Fail { get; set; }

        public Task SendAsync(EmailMessage message, CancellationToken ct)
        {
            if (Fail)
                throw new HttpRequestException("down");
            Sent.Add(message);
            return Task.CompletedTask;
        }

        public string LastCode() => System.Text.RegularExpressions.Regex.Match(Sent[^1].TextBody, @"\b\d{6}\b").Value;
    }

    private sealed record Host(InMemoryRepository Repository, FakeTimeProvider Clock, Mailbox Mail, AdminAuthService Auth, AdminUserService Users, AuditLog Audit, PasswordHasher Hasher);

    private static Host Create(string bootstrapEmail = "")
    {
        var repository = new InMemoryRepository();
        var clock = Fixtures.Clock();
        var mail = new Mailbox();
        var hasher = new PasswordHasher(1_000);
        var audit = new AuditLog(repository, clock, NullLogger<AuditLog>.Instance);
        var jwt = Options.Create(new AdminJwtOptions { SecretKey = "admin-key-0123456789-0123456789-0123456789" });
        var tokens = new AdminTokenService(jwt, Options.Create(new JwtOptions { SecretKey = "app-key-0123456789-0123456789-0123456789" }), clock);
        var auth = new AdminAuthService(repository, hasher, tokens, mail, new RateLimiter(repository, clock), audit,
            Fixtures.Monitor(new AdminAuthOptions { BootstrapSuperAdminEmail = bootstrapEmail }), jwt, clock, NullLogger<AdminAuthService>.Instance);
        var users = new AdminUserService(repository, auth, audit, clock, NullLogger<AdminUserService>.Instance);
        return new Host(repository, clock, mail, auth, users, audit, hasher);
    }

    private static async Task<AdminUserEntity> SeedAsync(Host host, string email, AdminRole role = AdminRole.SuperAdmin)
    {
        var admin = new AdminUserEntity { Id = Ulid.New(host.Clock.GetUtcNow().UtcDateTime), Email = email, Name = email, Role = role, PasswordSet = true, CreatedAt = Fixtures.Now, UpdatedAt = Fixtures.Now };
        await host.Repository.TransactWriteAsync(
        [
            TransactWriteOperation.Create(new AdminEmailIndexEntity { Email = email, AdminId = admin.Id }),
            TransactWriteOperation.Create(admin),
            TransactWriteOperation.Put(new AdminCredentialEntity { AdminId = admin.Id, PasswordHash = host.Hasher.Hash(Password), UpdatedAt = Fixtures.Now }),
        ]);
        return (await host.Repository.GetAsync<AdminUserEntity>(AdminUserEntity.GetPk(), AdminUserEntity.GetSk(admin.Id)))!;
    }

    private static readonly AdminRequestInfo Request = new("10.0.0.1", "en");

    [Fact]
    public async Task Code_ExpiresAfterTenMinutes_AndIsStoredOnlyAsAHash()
    {
        var host = Create();
        await SeedAsync(host, "a@droblet.test");
        var login = await host.Auth.LoginAsync("A@droblet.test", Password, Request, CancellationToken.None);
        Assert.Equal(AdminAuthOutcome.Success, login.Outcome);
        var code = host.Mail.LastCode();
        Assert.Equal(Fixtures.Now.AddMinutes(10), login.ExpiresAt);

        var stored = (await host.Repository.GetAllAsync<AdminLoginChallengeEntity>(AdminLoginChallengeEntity.GetPk())).Single();
        Assert.DoesNotContain(code, JsonSerializer.Serialize(stored));
        Assert.NotEqual(login.ChallengeId, stored.ChallengeHash);

        host.Clock.Advance(TimeSpan.FromMinutes(10));
        Assert.Equal(AdminAuthOutcome.ChallengeExpired, (await host.Auth.VerifyAsync(login.ChallengeId!, code, Request, CancellationToken.None)).Outcome);
    }

    [Fact]
    public async Task Verify_Succeeds_WithinTheWindow_AndIssuesAnAdminToken()
    {
        var host = Create();
        await SeedAsync(host, "b@droblet.test", AdminRole.Moderator);
        var login = await host.Auth.LoginAsync("b@droblet.test", Password, Request, CancellationToken.None);
        host.Clock.Advance(TimeSpan.FromMinutes(9));
        var verify = await host.Auth.VerifyAsync(login.ChallengeId!, host.Mail.LastCode(), Request, CancellationToken.None);

        Assert.Equal(AdminAuthOutcome.Success, verify.Outcome);
        Assert.Equal(AdminRole.Moderator, verify.Session!.Admin.Role);
        Assert.DoesNotContain(AdminPermissions.SettingsManage, verify.Session.Admin.Permissions);
        var token = new Microsoft.IdentityModel.JsonWebTokens.JsonWebToken(verify.Session.AccessToken);
        Assert.Equal(("droblet-admin", "admin"), (token.Issuer, token.GetClaim("token_use").Value));
        Assert.Equal(Fixtures.Now.AddMinutes(9).AddHours(12), verify.Session.RefreshTokenExpiresAt);
    }

    [Fact]
    public async Task Login_WhenTheCodeEmailFails_Is503AndLeavesNoChallenge()
    {
        var host = Create();
        await SeedAsync(host, "c@droblet.test");
        host.Mail.Fail = true;
        Assert.Equal(AdminAuthOutcome.EmailUnavailable, (await host.Auth.LoginAsync("c@droblet.test", Password, Request, CancellationToken.None)).Outcome);
        Assert.Empty(await host.Repository.GetAllAsync<AdminLoginChallengeEntity>(AdminLoginChallengeEntity.GetPk()));
    }

    [Fact]
    public async Task Bootstrap_IsIdempotent_AndNeverRunsTwice()
    {
        var host = Create("Owner@Droblet.test");
        await host.Auth.EnsureBootstrapAsync(CancellationToken.None);
        await host.Auth.EnsureBootstrapAsync(CancellationToken.None);
        var admins = await host.Repository.GetAllAsync<AdminUserEntity>(AdminUserEntity.GetPk());
        var owner = Assert.Single(admins);
        Assert.Equal(("owner@droblet.test", AdminRole.SuperAdmin, false), (owner.Email, owner.Role, owner.PasswordSet));
        Assert.Null(await host.Repository.GetAsync<AdminCredentialEntity>(AdminCredentialEntity.GetPk(), AdminCredentialEntity.GetSk(owner.Id)));

        // A new container (fresh service) with the marker in place does not create a second record, even if the
        // bootstrap admin was renamed meanwhile.
        await host.Repository.DeleteAsync(AdminEmailIndexEntity.GetPk(), AdminEmailIndexEntity.GetSk("owner@droblet.test"));
        var second = new AdminAuthService(host.Repository, host.Hasher, new AdminTokenService(Options.Create(new AdminJwtOptions()), Options.Create(new JwtOptions()), host.Clock),
            host.Mail, new RateLimiter(host.Repository, host.Clock), host.Audit, Fixtures.Monitor(new AdminAuthOptions { BootstrapSuperAdminEmail = "owner@droblet.test" }),
            Options.Create(new AdminJwtOptions()), host.Clock, NullLogger<AdminAuthService>.Instance);
        await second.EnsureBootstrapAsync(CancellationToken.None);
        Assert.Single(await host.Repository.GetAllAsync<AdminUserEntity>(AdminUserEntity.GetPk()));
    }

    [Fact]
    public async Task PasswordLink_Expires_AndResetEndsEverySession()
    {
        var host = Create();
        var admin = await SeedAsync(host, "d@droblet.test");
        await host.Auth.RequestPasswordResetAsync("d@droblet.test", Request, CancellationToken.None);
        var token = Uri.UnescapeDataString(System.Text.RegularExpressions.Regex.Match(host.Mail.Sent[^1].TextBody, @"token=(\S+)").Groups[1].Value);
        Assert.StartsWith("https://droblet-admin.alatech.co/reset-password/?token=", System.Text.RegularExpressions.Regex.Match(host.Mail.Sent[^1].TextBody, @"https://\S+").Value);

        host.Clock.Advance(TimeSpan.FromMinutes(31));
        Assert.Equal(AdminAuthOutcome.InvalidToken, await host.Auth.ResetPasswordAsync(token, "New-password-22", null, CancellationToken.None));

        await host.Auth.RequestPasswordResetAsync("d@droblet.test", Request, CancellationToken.None);
        token = Uri.UnescapeDataString(System.Text.RegularExpressions.Regex.Match(host.Mail.Sent[^1].TextBody, @"token=(\S+)").Groups[1].Value);
        Assert.Equal(AdminAuthOutcome.Success, await host.Auth.ResetPasswordAsync(token, "New-password-22", null, CancellationToken.None));
        var after = await host.Repository.GetAsync<AdminUserEntity>(AdminUserEntity.GetPk(), AdminUserEntity.GetSk(admin.Id));
        Assert.Equal(host.Clock.GetUtcNow().UtcDateTime, after!.TokensValidAfter);
        Assert.Equal(AdminAuthOutcome.Success, (await host.Auth.LoginAsync("d@droblet.test", "New-password-22", Request, CancellationToken.None)).Outcome);
    }

    [Fact]
    public async Task LastSuperAdmin_CannotBeDemotedDisabledOrDeleted_RoleChangeEndsSessions()
    {
        var host = Create();
        var owner = await SeedAsync(host, "owner@droblet.test");
        var other = await SeedAsync(host, "other@droblet.test");

        // Two super admins: the owner may demote the other one; then the owner is the last one.
        var demoted = await host.Users.UpdateAsync(owner, other.Id, "Other", AdminRole.ContentEditor, false, null, CancellationToken.None);
        Assert.Equal(AdminUserOutcome.Ok, demoted.Outcome);
        var otherRow = await host.Repository.GetAsync<AdminUserEntity>(AdminUserEntity.GetPk(), AdminUserEntity.GetSk(other.Id));
        Assert.NotNull(otherRow!.TokensValidAfter);

        Assert.Equal(AdminUserOutcome.CannotChangeSelf, (await host.Users.UpdateAsync(owner, owner.Id, "Me", AdminRole.Moderator, false, null, CancellationToken.None)).Outcome);
        Assert.Equal(AdminUserOutcome.CannotChangeSelf, await host.Users.DeleteAsync(owner, owner.Id, null, CancellationToken.None));
        // Acting as the editor's would-be peer: removing the last active super admin is refused.
        var editor = otherRow;
        Assert.Equal(AdminUserOutcome.LastSuperAdmin, (await host.Users.UpdateAsync(editor, owner.Id, "Owner", AdminRole.Moderator, false, null, CancellationToken.None)).Outcome);
        Assert.Equal(AdminUserOutcome.LastSuperAdmin, (await host.Users.UpdateAsync(editor, owner.Id, "Owner", AdminRole.SuperAdmin, true, null, CancellationToken.None)).Outcome);
        Assert.Equal(AdminUserOutcome.LastSuperAdmin, await host.Users.DeleteAsync(editor, owner.Id, null, CancellationToken.None));
    }

    [Fact]
    public async Task Create_EmailIsUniqueCaseInsensitively()
    {
        var host = Create();
        var owner = await SeedAsync(host, "owner@droblet.test");
        Assert.Equal(AdminUserOutcome.Ok, (await host.Users.CreateAsync(owner, "New@Droblet.test", "New", AdminRole.Moderator, Request, CancellationToken.None)).Outcome);
        Assert.Equal(AdminUserOutcome.EmailTaken, (await host.Users.CreateAsync(owner, "NEW@droblet.TEST", "Dup", AdminRole.Moderator, Request, CancellationToken.None)).Outcome);
        Assert.Contains("reset-password/?token=", host.Mail.Sent[^1].TextBody);
    }

    [Fact]
    public async Task Audit_SummariesAreCapped_AndQueriedNewestFirst()
    {
        var host = Create();
        var owner = await SeedAsync(host, "owner@droblet.test");
        await host.Audit.WriteAsync(owner, "product.upsert", "product", "p1", null, new { name = new string('x', 10_000) }, "1.2.3.4", CancellationToken.None);
        host.Clock.Advance(TimeSpan.FromSeconds(1));
        await host.Audit.WriteAsync(owner, "brand.upsert", "brand", "b1", new { name = "A" }, new { name = "B" }, null, CancellationToken.None);

        var page = await host.Audit.QueryAsync(new AuditQuery(null, null, null, null, 50), CancellationToken.None);
        Assert.Equal(["brand.upsert", "product.upsert"], page.Items.Select(i => i.Action).ToList());
        Assert.True(page.Items[1].After!.Length <= AuditLog.MaxSummaryLength + 1);
        Assert.Equal("owner@droblet.test", page.Items[0].AdminEmail);
        Assert.Single((await host.Audit.QueryAsync(new AuditQuery(null, "product.", null, null, 50), CancellationToken.None)).Items);
    }

    [Fact]
    public void AdminSigningKey_MustExistAndDifferFromTheAppKey()
    {
        var app = new JwtOptions { SecretKey = "shared-key-0123456789-0123456789-0123456789" };
        Assert.Throws<InvalidOperationException>(() => AdminTokenService.SigningKey(new AdminJwtOptions { SecretKey = app.SecretKey }, app));
        Assert.Throws<InvalidOperationException>(() => AdminTokenService.SigningKey(new AdminJwtOptions { SecretKey = "short" }, app));
        Assert.Throws<InvalidOperationException>(() => AdminTokenService.SigningKey(new AdminJwtOptions { SecretKey = "CHANGE_ME" }, app));
        Assert.NotNull(AdminTokenService.SigningKey(new AdminJwtOptions { SecretKey = "other-key-0123456789-0123456789-0123456789" }, app));
    }

    [Fact]
    public async Task Settings_WriteBothParameters_KeepOtherKeys_ReadNeverDecrypts()
    {
        var store = new MemoryStore();
        store.Values["/droblet/prod/api/Packing"] = """{"CabinMaxItems":12,"MaxTripDays":21}""";
        store.Values["/droblet/prod/worker/Packing"] = """{"CabinMaxItems":12,"MaxTripDays":21,"Extra":"kept"}""";
        var host = Create();
        var owner = await SeedAsync(host, "owner@droblet.test");
        var service = new AdminSettingsService(store, host.Audit, "prod");

        var values = new Dictionary<string, JsonElement> { ["CabinMaxItems"] = JsonDocument.Parse("8").RootElement };
        var result = await service.UpdateAsync(owner, "packing", values, null, CancellationToken.None);
        Assert.Equal(SettingWriteOutcome.Ok, result.Outcome);
        Assert.Equal("""{"CabinMaxItems":8,"MaxTripDays":21}""", store.Values["/droblet/prod/api/Packing"]);
        Assert.Equal("""{"CabinMaxItems":8,"MaxTripDays":21,"Extra":"kept"}""", store.Values["/droblet/prod/worker/Packing"]);

        var tooBig = new Dictionary<string, JsonElement> { ["CabinMaxItems"] = JsonDocument.Parse("101").RootElement };
        Assert.Equal(SettingWriteOutcome.Invalid, (await service.UpdateAsync(owner, "packing", tooBig, null, CancellationToken.None)).Outcome);
        Assert.Equal(SettingWriteOutcome.NotFound, (await service.UpdateAsync(owner, "Jwt", values, null, CancellationToken.None)).Outcome);
        Assert.Equal(8, (await service.GetAllAsync(CancellationToken.None)).Single(g => g.Group == "packing").Fields[0].Value!.GetValue<int>());
    }

    private sealed class MemoryStore : ISettingsStore
    {
        public Dictionary<string, string> Values { get; } = [];
        public Task<string?> GetAsync(string name, CancellationToken ct) => Task.FromResult(Values.GetValueOrDefault(name));
        public Task PutAsync(string name, string value, CancellationToken ct)
        {
            Values[name] = value;
            return Task.CompletedTask;
        }
    }
}
