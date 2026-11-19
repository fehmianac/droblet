using System.Net;
using System.Text.Json;
using Domain.Entity;
using Domain.Events;
using Domain.Extensions;

namespace ApiTests;

/// <summary>"Verilerimi indir" on the Api (docs/api/verification-export.md §2): start, one active, one per day, status, download.</summary>
public class DataExportEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static async Task<JsonElement> StateAsync(HttpClient client) => await (await client.GetAsync("v1/tenant/export")).JsonAsync();

    [Fact]
    public async Task Start_QueuesOneExport_SecondIs409_StateShowsIt()
    {
        var (client, auth) = await factory.RegisterAsync();
        var empty = await StateAsync(client);
        Assert.Equal(JsonValueKind.Null, empty.GetProperty("export").ValueKind);
        Assert.True(empty.GetProperty("canRequest").GetBoolean());

        var start = await client.PostJsonAsync("v1/tenant/export", new { });
        Assert.Equal(HttpStatusCode.Accepted, start.StatusCode);
        var body = await start.JsonAsync();
        Assert.Equal("queued", body.GetProperty("export").GetProperty("status").GetString());
        Assert.False(body.GetProperty("canRequest").GetBoolean());
        var exportId = body.GetProperty("export").GetProperty("id").GetString()!;
        Assert.Contains(factory.Events.Of<DataExportRequestedEvent>(auth.TenantId), e => e.JobId == exportId);

        var again = await client.PostJsonAsync("v1/tenant/export", new { });
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
        Assert.Equal("export_in_progress", await again.CodeAsync());
    }

    [Fact]
    public async Task Start_TwoParallelRequests_OneExportOneEvent()
    {
        var (client, auth) = await factory.RegisterAsync();

        var responses = await Task.WhenAll(Enumerable.Range(0, 2).Select(_ => client.PostJsonAsync("v1/tenant/export", new { })));

        Assert.Equal([HttpStatusCode.Accepted, HttpStatusCode.Conflict], responses.Select(r => r.StatusCode).Order().ToArray());
        var export = Assert.Single(await factory.Repository.GetAllAsync<DataExportEntity>(DataExportEntity.GetPk(auth.TenantId)));
        Assert.Equal(export.Id, Assert.Single(factory.Events.Of<DataExportRequestedEvent>(auth.TenantId)).JobId);
    }

    [Fact]
    public async Task Ready_HasAFreshDownloadUrl_OnePerDay_TokenLinkRedirects_ExpiresAfter7Days()
    {
        var (client, auth) = await factory.RegisterAsync();
        Assert.Equal(HttpStatusCode.Accepted, (await client.PostJsonAsync("v1/tenant/export", new { })).StatusCode);
        var export = (await factory.Repository.GetAllAsync<DataExportEntity>(DataExportEntity.GetPk(auth.TenantId))).Single();

        // What the worker writes when the ZIP is stored.
        var token = "test-download-token-0123456789abcdef";
        export.Status = DataExportStatus.Ready;
        export.S3Key = $"exports/{auth.TenantId}/{export.Id}.zip";
        export.CompletedAt = DateTime.UtcNow;
        export.ExpiresAt = DateTime.UtcNow.AddDays(7);
        export.SizeBytes = 1234;
        export.DownloadTokenHash = token.Sha256Hex();
        await factory.Repository.SaveAsync(export);
        await factory.Repository.SaveAsync(new DataExportTokenEntity { TokenHash = export.DownloadTokenHash, TenantId = auth.TenantId, ExportId = export.Id, ExpiresAt = export.ExpiresAt.Value });

        var state = await StateAsync(client);
        Assert.Equal("ready", state.GetProperty("export").GetProperty("status").GetString());
        Assert.Contains(export.S3Key, state.GetProperty("export").GetProperty("downloadUrl").GetString());
        Assert.False(state.GetProperty("canRequest").GetBoolean());
        Assert.NotEqual(JsonValueKind.Null, state.GetProperty("nextRequestAt").ValueKind);

        var tooSoon = await client.PostJsonAsync("v1/tenant/export", new { });
        Assert.Equal(HttpStatusCode.TooManyRequests, tooSoon.StatusCode);
        Assert.Equal("export_rate_limited", await tooSoon.CodeAsync());
        Assert.True((await tooSoon.JsonAsync()).TryGetProperty("nextRequestAt", out _));

        var anonymous = factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var download = await anonymous.GetAsync($"v1/export/download?token={token}");
        Assert.Equal(HttpStatusCode.Redirect, download.StatusCode);
        Assert.Contains(export.S3Key, download.Headers.Location!.ToString());
        Assert.Equal(HttpStatusCode.NotFound, (await anonymous.GetAsync("v1/export/download?token=wrong-token-value")).StatusCode);

        export.ExpiresAt = DateTime.UtcNow.AddMinutes(-1);
        await factory.Repository.SaveAsync(export);
        Assert.Equal(HttpStatusCode.Gone, (await anonymous.GetAsync($"v1/export/download?token={token}")).StatusCode);
        Assert.Equal("expired", (await StateAsync(client)).GetProperty("export").GetProperty("status").GetString());
    }

    [Fact]
    public async Task AFailedExport_DoesNotCountAgainstTheDay()
    {
        var (client, auth) = await factory.RegisterAsync();
        Assert.Equal(HttpStatusCode.Accepted, (await client.PostJsonAsync("v1/tenant/export", new { })).StatusCode);
        var export = (await factory.Repository.GetAllAsync<DataExportEntity>(DataExportEntity.GetPk(auth.TenantId))).Single();
        export.Status = DataExportStatus.Failed;
        await factory.Repository.SaveAsync(export);

        Assert.True((await StateAsync(client)).GetProperty("canRequest").GetBoolean());
        Assert.Equal(HttpStatusCode.Accepted, (await client.PostJsonAsync("v1/tenant/export", new { })).StatusCode);
    }

    [Fact]
    public async Task AnAbandonedExport_ShowsFailed_AndDoesNotBlockANewOne()
    {
        // The worker's last attempt was killed (Lambda timeout / OOM): the row stays "processing" and nothing marks it failed.
        var (client, auth) = await factory.RegisterAsync();
        Assert.Equal(HttpStatusCode.Accepted, (await client.PostJsonAsync("v1/tenant/export", new { })).StatusCode);
        var export = (await factory.Repository.GetAllAsync<DataExportEntity>(DataExportEntity.GetPk(auth.TenantId))).Single();
        export.Status = DataExportStatus.Processing;
        export.CreatedAt = DateTime.UtcNow.AddHours(-3);
        export.UpdatedAt = DateTime.UtcNow.AddHours(-2);
        await factory.Repository.SaveAsync(export);

        var state = await StateAsync(client);
        Assert.Equal("failed", state.GetProperty("export").GetProperty("status").GetString());
        Assert.True(state.GetProperty("canRequest").GetBoolean());
        Assert.Equal(HttpStatusCode.Accepted, (await client.PostJsonAsync("v1/tenant/export", new { })).StatusCode);
    }

    [Fact]
    public async Task AccountDeletion_RemovesTheExportsAndTheirFiles()
    {
        var (client, auth) = await factory.RegisterAsync();
        Assert.Equal(HttpStatusCode.Accepted, (await client.PostJsonAsync("v1/tenant/export", new { })).StatusCode);
        await factory.Storage.PutAsync($"exports/{auth.TenantId}/x.zip", [1], "application/zip", default);
        Assert.NotEmpty(await factory.Repository.GetKeysAsync(DataExportLockEntity.GetPk(auth.TenantId)));

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync("v1/auth/me")).StatusCode);

        Assert.Empty(await factory.Repository.GetAllAsync<DataExportEntity>(DataExportEntity.GetPk(auth.TenantId)));
        Assert.Empty(await factory.Repository.GetKeysAsync(DataExportLockEntity.GetPk(auth.TenantId)));
        Assert.DoesNotContain(factory.Storage.Objects.Keys, k => k.StartsWith($"exports/{auth.TenantId}/"));
    }
}
