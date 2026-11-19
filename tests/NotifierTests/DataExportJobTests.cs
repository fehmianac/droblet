using System.IO.Compression;
using System.Text.Json;
using Amazon.Lambda.SQSEvents;
using Amazon.Lambda.TestUtilities;
using Domain.Entity;
using Domain.Enum;
using Domain.Events;
using Domain.Services;
using Infrastructure.Serialization;
using Infrastructure.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Notifier;
using Tests.Shared;

namespace NotifierTests;

/// <summary>"Verilerimi indir" worker: the ZIP's content, what is left out, the inbox row, the e-mail, failures.</summary>
public class DataExportJobTests
{
    private sealed class CapturingEmail : IEmailService
    {
        public List<EmailMessage> Sent { get; } = [];
        public bool Fail { get; set; }

        public Task SendAsync(EmailMessage message, CancellationToken ct)
        {
            if (Fail) throw new InvalidOperationException("down");
            Sent.Add(message);
            return Task.CompletedTask;
        }
    }

    private readonly CapturingEmail _email = new();
    private readonly WorkerTestHost _host;
    private const string TenantId = "01TENANTEXPORT000000000000";
    private const string UserId = "01USEREXPORT00000000000000";

    public DataExportJobTests()
    {
        _host = new WorkerTestHost(services =>
        {
            services.AddSingleton<IDataExportJob, DataExportJob>();
            services.Configure<DataExportOptions>(o => o.PublicApiBaseUrl = "https://api.test/");
            services.RemoveAll<IEmailService>();
            services.AddSingleton<IEmailService>(_email);
        });
    }

    private async Task<DataExportEntity> SeedAsync()
    {
        var now = WorkerTestHost.Now;
        await _host.Repository.SaveAsync(new UserEntity
        {
            Id = UserId, TenantId = TenantId, DisplayName = "Ayşe", Email = "ayse@example.com", CreatedAt = now.AddDays(-3),
            Identities = ["email#ayse@example.com"],
        });
        await _host.Repository.SaveAsync(new TenantEntity { Id = TenantId, OwnerUserId = UserId, DisplayName = "Ayşe", Handle = "ayse", Language = "tr", CreatedAt = now.AddDays(-3), UpdatedAt = now });
        await _host.Repository.SaveAsync(new ConsentEntity { TenantId = TenantId, Type = ConsentType.Contacts, Granted = true, Version = "2026-11-19", GrantedAt = now });
        await _host.Repository.SaveAsync(new DeviceEntity { TenantId = TenantId, DeviceId = "d1", Platform = "ios", PushToken = "SECRET-PUSH", UpdatedAt = now });
        await _host.Repository.SaveAsync(new ContactSaltEntity { TenantId = TenantId, SaltId = "s1", Salt = "SECRET-SALT", ExpiresAt = now.AddDays(1) });
        await _host.Repository.SaveAsync(AnalyticsRules.ToEntity("signup_step", TenantId, now.AddDays(-1), now.AddDays(-1), new Dictionary<string, string?> { ["step"] = "body" }, "01ANALYTICS000000000000000"));
        await _host.Repository.SaveAsync(AnalyticsRules.ToEntity("signup_step", "someone-else", now.AddDays(-1), now.AddDays(-1), null, "01ANALYTICS000000000000001"));
        await _host.Storage.PutAsync($"tenant/{TenantId}/face/f1.jpg", [1, 2, 3], "image/jpeg", default);
        await _host.Storage.PutAsync($"tenant/{TenantId}/tryon/t1.png", [4, 5], "image/png", default);
        await _host.Storage.PutAsync($"tenant/other/face/x.jpg", [9], "image/jpeg", default);
        var export = new DataExportEntity { Id = "01EXPORT000000000000000000", TenantId = TenantId, UserId = UserId, Status = DataExportStatus.Queued, Language = "tr", CreatedAt = now, UpdatedAt = now };
        await _host.Repository.SaveAsync(export);
        return export;
    }

    private Dictionary<string, byte[]> ReadZip(string key)
    {
        using var zip = new ZipArchive(new MemoryStream(_host.Storage.Objects[key].Data), ZipArchiveMode.Read);
        return zip.Entries.ToDictionary(e => e.FullName, e =>
        {
            using var s = e.Open();
            using var m = new MemoryStream();
            s.CopyTo(m);
            return m.ToArray();
        });
    }

    [Fact]
    public async Task Process_BuildsTheZip_StoresIt_InboxAndEmail_WithoutSecrets()
    {
        var export = await SeedAsync();

        await _host.Get<IDataExportJob>().ProcessAsync(TenantId, export.Id, isLastAttempt: false, default);

        var stored = await _host.Repository.GetAsync<DataExportEntity>(export.Pk, export.Sk);
        Assert.Equal(DataExportStatus.Ready, stored!.Status);
        Assert.Equal($"exports/{TenantId}/{export.Id}.zip", stored.S3Key);
        Assert.Equal(WorkerTestHost.Now.AddDays(7), stored.ExpiresAt);
        Assert.NotNull(stored.DownloadTokenHash);
        Assert.Equal("application/zip", _host.Storage.Objects[stored.S3Key!].ContentType);

        var files = ReadZip(stored.S3Key!);
        Assert.Contains("README.txt", files.Keys);
        Assert.Contains("profile.json", files.Keys);
        Assert.Contains("data/consent.json", files.Keys);
        Assert.Contains("data/device.json", files.Keys);
        Assert.Contains("data/analytics-events.json", files.Keys);
        Assert.Equal([1, 2, 3], files[$"files/face/f1.jpg"]);
        Assert.Equal([4, 5], files[$"files/tryon/t1.png"]);
        Assert.DoesNotContain(files.Keys, k => k.Contains("contact-salt") || k.Contains("x.jpg") || k.Contains("data-export"));

        var all = string.Join('\n', files.Where(f => f.Key.EndsWith(".json") || f.Key.EndsWith(".txt")).Select(f => System.Text.Encoding.UTF8.GetString(f.Value)));
        Assert.DoesNotContain("SECRET-PUSH", all);
        Assert.DoesNotContain("SECRET-SALT", all);
        Assert.DoesNotContain("\"pk\"", all);
        var profile = JsonDocument.Parse(files["profile.json"]).RootElement;
        Assert.Equal("ayse@example.com", profile.GetProperty("account").GetProperty("email").GetString());
        Assert.Equal("ayse", profile.GetProperty("profile").GetProperty("handle").GetString());
        Assert.Equal("email", profile.GetProperty("signInMethods")[0].GetString());
        var analytics = JsonDocument.Parse(files["data/analytics-events.json"]).RootElement;
        Assert.Equal(1, analytics.GetArrayLength());
        Assert.Contains("veri kopyan", System.Text.Encoding.UTF8.GetString(files["README.txt"]));

        var inbox = await _host.Repository.GetAllAsync<NotificationInboxEntity>(NotificationInboxEntity.GetPk(TenantId));
        Assert.Equal(NotificationType.DataExportReady, Assert.Single(inbox).Type);
        Assert.Equal(export.Id, inbox[0].Data["exportId"]);

        var mail = Assert.Single(_email.Sent);
        Assert.Equal("ayse@example.com", mail.To);
        Assert.Equal("Droblet verilerin hazır", mail.Subject);
        Assert.Contains("https://api.test/v1/export/download?token=", mail.TextBody);
        var token = Uri.UnescapeDataString(mail.TextBody.Split("token=")[1].Split('\n')[0].Trim());
        Assert.Equal(stored.DownloadTokenHash, Domain.Extensions.HashExtensions.Sha256Hex(token));
        Assert.NotNull(await _host.Repository.GetAsync<DataExportTokenEntity>(DataExportTokenEntity.GetPk(), DataExportTokenEntity.GetSk(stored.DownloadTokenHash!)));
    }

    [Fact]
    public async Task Process_EmailDown_StillReady_InboxHasIt()
    {
        var export = await SeedAsync();
        _email.Fail = true;
        await _host.Get<IDataExportJob>().ProcessAsync(TenantId, export.Id, false, default);
        Assert.Equal(DataExportStatus.Ready, (await _host.Repository.GetAsync<DataExportEntity>(export.Pk, export.Sk))!.Status);
        Assert.Single(await _host.Repository.GetAllAsync<NotificationInboxEntity>(NotificationInboxEntity.GetPk(TenantId)));
    }

    [Fact]
    public async Task Process_DeletedOrDone_DoesNothing()
    {
        await _host.Get<IDataExportJob>().ProcessAsync(TenantId, "01MISSING00000000000000000", false, default);
        Assert.DoesNotContain(_host.Storage.Objects.Keys, k => k.StartsWith("exports/"));
    }

    [Fact]
    public async Task Entrypoint_DataExport_RoutesTheMessage()
    {
        var export = await SeedAsync();
        var entrypoint = new Entrypoint(_host.Services);
        var message = MessageSerializer.Serialize(new DataExportRequestedEvent(TenantId, export.Id));
        var response = await entrypoint.DataExport(
            new SQSEvent { Records = [new SQSEvent.SQSMessage { MessageId = "m1", Body = message, Attributes = new Dictionary<string, string> { ["ApproximateReceiveCount"] = "1" } }] },
            new TestLambdaContext { RemainingTime = TimeSpan.FromMinutes(5) });
        Assert.Empty(response.BatchItemFailures);
        Assert.Equal(DataExportStatus.Ready, (await _host.Repository.GetAsync<DataExportEntity>(export.Pk, export.Sk))!.Status);
    }

    [Fact]
    public void FileNames_AreKebabCase()
    {
        Assert.Equal("consent-history", DataExportJob.FileNameFor(typeof(ConsentHistoryEntity)));
        Assert.Equal("wear-log", DataExportJob.FileNameFor(typeof(WearLogEntity)));
    }
}
