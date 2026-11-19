using System.Text.Json;
using Domain.Enum;
using Domain.Services.Admin;

namespace DomainTests.Services;

public class AdminRulesTests
{
    [Theory]
    [InlineData(AdminRole.SuperAdmin, "settings.manage", true)]
    [InlineData(AdminRole.SuperAdmin, "admins.manage", true)]
    [InlineData(AdminRole.SuperAdmin, "users.grant", true)]
    [InlineData(AdminRole.ContentEditor, "catalog.manage", true)]
    [InlineData(AdminRole.ContentEditor, "content.manage", true)]
    [InlineData(AdminRole.ContentEditor, "image.upload", true)]
    [InlineData(AdminRole.ContentEditor, "users.read", false)]
    [InlineData(AdminRole.ContentEditor, "moderation.manage", false)]
    [InlineData(AdminRole.ContentEditor, "settings.manage", false)]
    [InlineData(AdminRole.Moderator, "users.read", true)]
    [InlineData(AdminRole.Moderator, "users.suspend", true)]
    [InlineData(AdminRole.Moderator, "moderation.manage", true)]
    [InlineData(AdminRole.Moderator, "users.delete", false)]
    [InlineData(AdminRole.Moderator, "users.grant", false)]
    [InlineData(AdminRole.Moderator, "catalog.manage", false)]
    [InlineData(AdminRole.Moderator, "analytics.view", false)]
    [InlineData(AdminRole.Moderator, "audit.view", false)]
    public void RoleMatrix(AdminRole role, string permission, bool expected) =>
        Assert.Equal(expected, AdminPermissions.Has(role, permission));

    [Fact]
    public void SuperAdmin_HasEveryPermission_AndUnknownPermissionsAreDenied()
    {
        Assert.Equal(AdminPermissions.All, AdminPermissions.Of(AdminRole.SuperAdmin));
        Assert.False(AdminPermissions.Has(AdminRole.SuperAdmin, "anything.else"));
        Assert.All(Enum.GetValues<AdminRole>(), r => Assert.Contains(AdminPermissions.DashboardView, AdminPermissions.Of(r)));
    }

    private static Dictionary<string, JsonElement> Values(string json) =>
        JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(json)!;

    [Theory]
    [InlineData("entitlements", """{"Free.ItemRecognitionLimit":0}""", null)]
    [InlineData("entitlements", """{"Free.ItemRecognitionLimit":1001}""", "out_of_range")]
    [InlineData("entitlements", """{"Free.ItemRecognitionLimit":"10"}""", "invalid")]
    [InlineData("entitlements", """{"Free.ItemRecognitionLimit":1.5}""", "invalid")]
    [InlineData("ai", """{"Enabled":true}""", null)]
    [InlineData("ai", """{"Enabled":"yes"}""", "invalid")]
    [InlineData("notifications", """{"DefaultMorningLocal":"07:30"}""", null)]
    [InlineData("notifications", """{"DefaultMorningLocal":"25:00"}""", "invalid")]
    [InlineData("notifications", """{"DefaultTimeZone":"Europe/Istanbul"}""", null)]
    [InlineData("notifications", """{"DefaultTimeZone":"Mars/Olympus"}""", "invalid")]
    [InlineData("notifierSchedule", """{"DefaultWeeklyEditLocal":"Mon 09:00"}""", null)]
    [InlineData("notifierSchedule", """{"DefaultWeeklyEditLocal":"Monday 9"}""", "invalid")]
    [InlineData("authRateLimits", """{"LoginPerEmailPer15Minutes":0}""", "out_of_range")]
    [InlineData("packing", """{"SecretKey":"x"}""", "unknown_field")]
    public void Settings_Validation(string group, string json, string? error)
    {
        var errors = SettingsCatalog.Validate(SettingsCatalog.Find(group)!, Values(json));
        if (error is null)
            Assert.Empty(errors);
        else
            Assert.Equal(error, Assert.Single(errors).Value.Single());
    }

    [Fact]
    public void Settings_Apply_ChangesOnlyTheGivenKeys_AndCreatesMissingObjects()
    {
        Assert.Equal("""{"Premium":{"TryOnCreditsPerMonth":30},"Free":{"ItemRecognitionLimit":3}}""",
            SettingsCatalog.Apply("""{"Premium":{"TryOnCreditsPerMonth":30},"Free":{"ItemRecognitionLimit":10}}""", Values("""{"Free.ItemRecognitionLimit":3}""")));
        Assert.Equal("""{"Free":{"ItemRecognitionLimit":3}}""", SettingsCatalog.Apply(null, Values("""{"Free.ItemRecognitionLimit":3}""")));
    }

    [Fact]
    public void Settings_NoGroupTouchesASecretParameter()
    {
        var secretSections = new[] { "Jwt", "AdminJwt", "Email", "AppleAuth", "GoogleAuth", "AffiliatePostback", "Store" };
        Assert.DoesNotContain(SettingsCatalog.WritableParameters, p => secretSections.Contains(p.Section));
        // PromptCacheKey is a switch (send prompt_cache_key = the operation name), not a secret.
        string[] notSecret = ["PromptCacheKey"];
        Assert.DoesNotContain(SettingsCatalog.Groups.SelectMany(g => g.Fields).Where(f => !notSecret.Contains(f.Key)),
            f => f.Key.Contains("Key", StringComparison.OrdinalIgnoreCase) || f.Key.Contains("Secret", StringComparison.OrdinalIgnoreCase));
    }
}
