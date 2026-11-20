using System.Net;
using Domain.Entity;
using Domain.Enum;
using Domain.Services.Admin;
using Microsoft.Extensions.DependencyInjection;

namespace ApiTests;

/// <summary>Admin "Bakım" › publish-item-images (docs/api/admin.md §5d): maintenance.manage, 409 / 422 codes, audit.</summary>
public class AdminMaintenanceEndpointTests(StoreSocialApiFactory factory) : IClassFixture<StoreSocialApiFactory>
{
    private const string Route = "v1/admin/maintenance/publish-item-images";

    [Fact]
    public async Task Maintenance_SuperAdminOnly_EditorsModeratorsAndAppUsersAreRefused()
    {
        var super = await factory.AdminAsync();
        var me = await (await super.GetAsync("v1/admin/auth/me")).JsonAsync();
        Assert.Contains("maintenance.manage", me.GetProperty("permissions").EnumerateArray().Select(p => p.GetString()));

        foreach (var role in new[] { AdminRole.ContentEditor, AdminRole.Moderator })
        {
            var admin = await factory.AdminAsync(role);
            Assert.Equal(HttpStatusCode.Forbidden, (await admin.GetAsync(Route)).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await admin.PostJsonAsync(Route, new { dryRun = true })).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await admin.PostJsonAsync($"{Route}/x/cancel", new { })).StatusCode);
        }
        var (user, _) = await factory.RegisterAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await user.GetAsync(Route)).StatusCode);
    }

    [Fact]
    public async Task Start_Lists_Refuses_ASecond_Cancels_AndAudits()
    {
        var admin = await factory.AdminAsync();
        // A run left by another test of this class would block the start: finish it first.
        foreach (var run in (await factory.Services.GetRequiredService<IMaintenanceService>().ListPublishItemImagesAsync(default)).Runs.Where(r => r.Status is MaintenanceRunStatus.Queued or MaintenanceRunStatus.Running))
            await admin.PostJsonAsync($"{Route}/{run.Id}/cancel", new { });
        await DrainAsync();

        var started = await admin.PostJsonAsync(Route, new { dryRun = true });
        Assert.Equal(HttpStatusCode.Accepted, started.StatusCode);
        var body = await started.JsonAsync();
        var id = body.GetProperty("id").GetString()!;
        Assert.Equal(("queued", true, "publishItemImages"), (body.GetProperty("status").GetString(), body.GetProperty("dryRun").GetBoolean(), body.GetProperty("kind").GetString()));

        var second = await admin.PostJsonAsync(Route, new { dryRun = false });
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
        Assert.Equal("maintenance_run_active", (await second.JsonAsync()).GetProperty("code").GetString());

        var list = await (await admin.GetAsync(Route)).JsonAsync();
        Assert.Equal(id, list.GetProperty("runs")[0].GetProperty("id").GetString());
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync($"{Route}/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync($"{Route}/unknown")).StatusCode);

        var cancel = await admin.PostJsonAsync($"{Route}/{id}/cancel", new { });
        Assert.Equal("cancelling", (await cancel.JsonAsync()).GetProperty("status").GetString());
        await DrainAsync();
        Assert.Equal("cancelled", (await (await admin.GetAsync($"{Route}/{id}")).JsonAsync()).GetProperty("status").GetString());
        var again = await admin.PostJsonAsync($"{Route}/{id}/cancel", new { });
        Assert.Equal("maintenance_run_finished", (await again.JsonAsync()).GetProperty("code").GetString());
        var retry = await admin.PostJsonAsync($"{Route}/{id}/retry-failed", new { });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, retry.StatusCode);
        Assert.Equal("nothing_to_retry", (await retry.JsonAsync()).GetProperty("code").GetString());

        var audit = await factory.Repository.GetAllAsync<AdminAuditEntity>(AdminAuditEntity.GetPk());
        Assert.Contains(audit, e => e.Action == "maintenance.publish_item_images.start" && e.TargetId == id);
        Assert.Contains(audit, e => e.Action == "maintenance.publish_item_images.cancel" && e.TargetId == id);
    }

    /// <summary>Plays the recorded batch messages through the real job (as the item worker would).</summary>
    private async Task DrainAsync()
    {
        var services = factory.Services;
        var job = new Infrastructure.Services.Maintenance.PublishItemImagesJob(factory.Repository,
            new Infrastructure.Services.Maintenance.ItemImageMigrator(factory.Repository, services.GetRequiredService<Domain.Services.IObjectStorage>(),
                new Tests.Shared.FakeThumbnailer(), services.GetRequiredService<Domain.Services.IItemImagePublisher>(), TimeProvider.System),
            factory.MaintenanceQueue, services.GetRequiredService<Microsoft.Extensions.Options.IOptionsMonitor<Infrastructure.Services.Maintenance.MaintenanceOptions>>(),
            TimeProvider.System, Microsoft.Extensions.Logging.Abstractions.NullLogger<Infrastructure.Services.Maintenance.PublishItemImagesJob>.Instance);
        while (factory.MaintenanceQueue.Pending.TryDequeue(out var message))
            await job.RunBatchAsync(message, default);
    }
}
