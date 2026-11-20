using System.Net;
using Domain.Entity;
using Domain.Enum;
using Domain.Services;
using Microsoft.Extensions.DependencyInjection;

namespace ApiTests;

/// <summary>Admin AI usage and cost (docs/api/admin.md §5c): ai.usage.view, the audited user view, the board.</summary>
public class AdminAiUsageEndpointTests(StoreSocialApiFactory factory) : IClassFixture<StoreSocialApiFactory>
{
    private Task RecordAsync(string tenantId, string marker, long costMicro, DateTime at) =>
        factory.Services.GetRequiredService<IAiUsageRecorder>().RecordAsync(new AiUsageRecord(tenantId, marker, JobKind.StylistOutfit, AiUsageOutcome.Completed,
            [new AiUsageCall("outfit", "gpt-6-astra", 200, 1200, 400, 0, 0, costMicro)], at), default);

    [Fact]
    public async Task AiUsageView_SuperAdminOnly_EditorsModeratorsAndAppUsersAreRefused()
    {
        var super = await factory.AdminAsync();
        var me = await (await super.GetAsync("v1/admin/auth/me")).JsonAsync();
        Assert.Contains("ai.usage.view", me.GetProperty("permissions").EnumerateArray().Select(p => p.GetString()));

        var (_, auth) = await factory.RegisterAsync();
        foreach (var role in new[] { AdminRole.ContentEditor, AdminRole.Moderator })
        {
            var admin = await factory.AdminAsync(role);
            Assert.Equal(HttpStatusCode.Forbidden, (await admin.GetAsync("v1/admin/ai-usage/summary")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await admin.GetAsync($"v1/admin/user/{auth.UserId}/ai-usage")).StatusCode);
        }
        var (user, _) = await factory.RegisterAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await user.GetAsync("v1/admin/ai-usage/summary")).StatusCode);
    }

    [Fact]
    public async Task UserAiUsage_ReturnsTheUsersNumbers_AndEveryViewIsAudited()
    {
        var admin = await factory.AdminAsync();
        var (_, auth) = await factory.RegisterAsync();
        await RecordAsync(auth.TenantId, "job-" + auth.UserId, 27_000, DateTime.UtcNow);

        var response = await admin.GetAsync($"v1/admin/user/{auth.UserId}/ai-usage");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.JsonAsync();
        Assert.Equal(27_000, body.GetProperty("totals").GetProperty("costMicroUsd").GetInt64());
        Assert.Equal("stylist_outfit", body.GetProperty("operations")[0].GetProperty("operation").GetString());
        Assert.Equal("free", body.GetProperty("plan").GetString());
        Assert.Equal(43m, body.GetProperty("rates").GetProperty("usdTry").GetDecimal());

        var audit = await factory.Repository.GetAllAsync<AdminAuditEntity>(AdminAuditEntity.GetPk());
        Assert.Contains(audit, e => e.Action == "user.ai_usage_view" && e.TargetId == auth.UserId);

        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync("v1/admin/user/01JNOSUCHUSER0000000000000/ai-usage")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.GetAsync($"v1/admin/user/{auth.UserId}/ai-usage?from=2026-01-01&to=2026-12-31")).StatusCode);   // > 92 days
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.GetAsync($"v1/admin/user/{auth.UserId}/ai-usage?from=nope")).StatusCode);
    }

    [Fact]
    public async Task Summary_ListsTheTopUserMasked_WithALinkableUserId()
    {
        var admin = await factory.AdminAsync();
        var (_, auth) = await factory.RegisterAsync();
        await RecordAsync(auth.TenantId, "big-" + auth.UserId, 90_000_000, DateTime.UtcNow);   // $90: the top user of any test run

        var body = await (await admin.GetAsync("v1/admin/ai-usage/summary")).JsonAsync();

        Assert.Equal(30, body.GetProperty("days").GetArrayLength());
        var top = body.GetProperty("topUsers")[0];
        Assert.Equal(auth.UserId, top.GetProperty("userId").GetString());
        Assert.EndsWith("***.com", top.GetProperty("email").GetString());
        Assert.DoesNotContain("@example.com", top.GetProperty("email").GetString());
        Assert.Contains(body.GetProperty("anomalies").EnumerateArray(), a => a.GetProperty("tenantId").GetString() == auth.TenantId
            && a.GetProperty("reasons").EnumerateArray().Any(r => r.GetString() == "absolute"));
        Assert.Contains(body.GetProperty("plans").EnumerateArray(), p => p.GetProperty("plan").GetString() == "premium");
    }
}
