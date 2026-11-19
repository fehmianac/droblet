using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Domain.Entity;
using Domain.Enum;
using Domain.Extensions;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace Infrastructure.Services;

/// <summary>Where the e-mailed download link points (the Api's public base URL; template env PUBLIC_API_BASE_URL).</summary>
public sealed class DataExportOptions
{
    public const string Section = "DataExport";
    public string? PublicApiBaseUrl { get; set; }
}

/// <summary>
/// Builds the "Verilerimi indir" ZIP: README.txt, profile.json (account + profile), one JSON file per stored entity
/// of the tenant (every partition in DeletionPlan except internal bookkeeping), the user's analytics events, and the
/// user's own files (body / face photos, try-on images, item images, profile picture) under files/. Secrets and
/// storage internals (push tokens, salts, hashes, keys) are left out. The ZIP goes to exports/{tenantId}/ (7 days),
/// then an inbox row and an e-mail carry the link.
/// </summary>
public sealed class DataExportJob(
    IRepository repository,
    IObjectStorage storage,
    INotificationInbox inbox,
    IEmailService emailService,
    IOptionsMonitor<DataExportOptions> options,
    TimeProvider timeProvider,
    ILogger<DataExportJob> logger) : IDataExportJob
{
    /// <summary>Internal bookkeeping, not personal data the user gave or we derived (or a duplicate of the files).</summary>
    private static readonly HashSet<Type> Skipped =
    [
        typeof(MutationReceiptEntity), typeof(ContactSaltEntity), typeof(ContactDirectoryPointerEntity),
        typeof(PhotoUploadEntity), typeof(ItemUploadEntity), typeof(AvatarUploadEntity), typeof(NotificationSentEntity),
        typeof(DataExportEntity),
    ];

    /// <summary>Fields never exported: keys, secrets, hashes, storage internals.</summary>
    private static readonly HashSet<string> SkippedFields = new(StringComparer.Ordinal)
    {
        "pk", "sk", "ttl", "pushToken", "salt", "codeHash", "tokenHash", "passwordHash", "appleRefreshToken", "downloadTokenHash",
        "creditIdempotencyKey", "identities",
    };

    private static readonly JsonSerializerOptions Json = new()
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    private static readonly MethodInfo GetAllMethod = typeof(IRepository).GetMethods()
        .Single(m => m is { Name: nameof(IRepository.GetAllAsync), IsGenericMethodDefinition: true } && m.GetParameters().Length == 2);

    private DateTime Now => timeProvider.GetUtcNow().UtcDateTime;

    public async Task ProcessAsync(string tenantId, string exportId, bool isLastAttempt, CancellationToken ct)
    {
        var export = await repository.GetAsync<DataExportEntity>(DataExportEntity.GetPk(tenantId), DataExportEntity.GetSk(exportId), ct);
        if (export is null || export.Status is DataExportStatus.Ready or DataExportStatus.Failed)
            return; // deleted with the account meanwhile, or a duplicate delivery

        export.Status = DataExportStatus.Processing;
        export.UpdatedAt = Now;
        await repository.SaveAsync(export, ct);

        var path = Path.Combine(Path.GetTempPath(), $"droblet-export-{exportId}.zip");
        try
        {
            int fileCount;
            await using (var file = File.Create(path))
                fileCount = await WriteZipAsync(file, export, ct);

            var key = StorageKeys.Export(tenantId, exportId);
            await storage.PutFileAsync(key, path, "application/zip", ct);

            var now = Now;
            var token = Base64UrlEncoder.Encode(RandomNumberGenerator.GetBytes(32));
            export.Status = DataExportStatus.Ready;
            export.S3Key = key;
            export.SizeBytes = new FileInfo(path).Length;
            export.FileCount = fileCount;
            export.CompletedAt = now;
            export.ExpiresAt = now.Add(DataExportRules.FileLifetime);
            export.DownloadTokenHash = token.Sha256Hex();
            export.UpdatedAt = now;
            await repository.TransactWriteAsync(
            [
                TransactWriteOperation.PutExisting(export),
                TransactWriteOperation.Put(new DataExportTokenEntity { TokenHash = export.DownloadTokenHash, TenantId = tenantId, ExportId = exportId, ExpiresAt = export.ExpiresAt.Value }),
            ], ct);

            await inbox.AddAsync(tenantId, NotificationType.DataExportReady, exportId, new Dictionary<string, string> { ["exportId"] = exportId }, now, ct);
            await SendEmailAsync(export, token, ct);
            logger.LogInformation("Data export {ExportId} ready for tenant {TenantId}: {Bytes} bytes, {Files} entries", exportId, tenantId, export.SizeBytes, fileCount);
        }
        catch (Exception ex) when (ex is not OperationCanceledException && isLastAttempt)
        {
            logger.LogError(ex, "Data export {ExportId} failed for tenant {TenantId}", exportId, tenantId);
            export.Status = DataExportStatus.Failed;
            export.Failure = "build_failed";
            export.UpdatedAt = Now;
            await repository.SaveAsync(export, ct);
        }
        finally
        {
            if (File.Exists(path))
                File.Delete(path);
        }
    }

    private async Task SendEmailAsync(DataExportEntity export, string token, CancellationToken ct)
    {
        var user = await repository.GetAsync<UserEntity>(UserEntity.GetPk(), UserEntity.GetSk(export.UserId), ct);
        var baseUrl = options.CurrentValue.PublicApiBaseUrl?.TrimEnd('/');
        if (user?.Email is not { Length: > 0 } email || string.IsNullOrEmpty(baseUrl))
        {
            logger.LogWarning("Data export {ExportId}: no e-mail sent (address or public API URL missing); the inbox has it", export.Id);
            return;
        }
        var link = $"{baseUrl}/v1/export/download?token={Uri.EscapeDataString(token)}";
        try
        {
            await emailService.SendAsync(EmailTemplates.DataExportReady(email, link, export.Language, export.ExpiresAt!.Value), ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // The file and the inbox row exist; the app shows the download too.
            logger.LogError(ex, "Data export {ExportId}: e-mail failed", export.Id);
        }
    }

    /// <summary>Writes the archive; returns the number of entries.</summary>
    private async Task<int> WriteZipAsync(Stream output, DataExportEntity export, CancellationToken ct)
    {
        var tenantId = export.TenantId;
        var entries = 0;
        using var zip = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: true);

        async Task AddJsonAsync(string name, object value)
        {
            var entry = zip.CreateEntry(name, CompressionLevel.Optimal);
            await using var stream = entry.Open();
            await JsonSerializer.SerializeAsync(stream, value, Json, ct);
            entries++;
        }

        var user = await repository.GetAsync<UserEntity>(UserEntity.GetPk(), UserEntity.GetSk(export.UserId), ct);
        var tenant = await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(tenantId), ct);
        await AddJsonAsync("profile.json", new
        {
            exportedAt = Now,
            account = user is null ? null : Clean(JsonSerializer.SerializeToNode(user, Json)),
            signInMethods = user?.Identities.Select(sk => sk.Split('#')[0]).Distinct().ToList() ?? [],
            profile = tenant is null ? null : Clean(JsonSerializer.SerializeToNode(tenant, Json)),
        });

        var files = new List<string>();
        foreach (var type in DeletionPlan.TenantScopedEntityTypes.Where(t => !Skipped.Contains(t)))
        {
            var pk = DeletionPlan.TenantPartitionKeys(tenantId)[DeletionPlan.TenantScopedEntityTypes.ToList().IndexOf(type)];
            var rows = await ReadPartitionAsync(type, pk, ct);
            if (rows.Count == 0)
                continue;
            var name = $"data/{FileNameFor(type)}.json";
            await AddJsonAsync(name, rows);
            files.Add(name);
        }

        var analytics = await AnalyticsEventsAsync(tenantId, tenant?.CreatedAt ?? user?.CreatedAt ?? Now.AddDays(-AnalyticsEventEntity.TtlDays), ct);
        if (analytics.Count > 0)
        {
            await AddJsonAsync("data/analytics-events.json", analytics);
            files.Add("data/analytics-events.json");
        }

        foreach (var key in await storage.ListKeysAsync(StorageKeys.TenantRoot(tenantId), ct))
        {
            await using var source = await storage.OpenReadAsync(key, ct);
            if (source is null)
                continue;
            var relative = key[StorageKeys.TenantRoot(tenantId).Length..];
            // Images are already compressed.
            var entry = zip.CreateEntry($"files/{relative}", CompressionLevel.NoCompression);
            await using (var target = entry.Open())
                await source.CopyToAsync(target, ct);
            entries++;
            files.Add($"files/{relative}");
        }

        var readme = zip.CreateEntry("README.txt", CompressionLevel.Optimal);
        await using (var writer = new StreamWriter(readme.Open(), new UTF8Encoding(false)))
            await writer.WriteAsync(Readme(export.Language, files));
        return entries + 1;
    }

    private async Task<List<JsonNode>> ReadPartitionAsync(Type type, string pk, CancellationToken ct)
    {
        var task = (Task)GetAllMethod.MakeGenericMethod(type).Invoke(repository, [pk, ct])!;
        await task;
        var items = (System.Collections.IEnumerable)task.GetType().GetProperty("Result")!.GetValue(task)!;
        var rows = new List<JsonNode>();
        foreach (var item in items)
        {
            if (Clean(JsonSerializer.SerializeToNode(item, type, Json)) is { } node)
                rows.Add(node);
        }
        return rows;
    }

    /// <summary>The user's analytics events (pseudonymous actor) from the day partitions since the account was created.</summary>
    private async Task<List<JsonNode>> AnalyticsEventsAsync(string tenantId, DateTime since, CancellationToken ct)
    {
        var actor = AnalyticsRules.Actor(tenantId);
        var today = DateOnly.FromDateTime(Now);
        var first = DateOnly.FromDateTime(since);
        var oldest = today.AddDays(-AnalyticsEventEntity.TtlDays);
        if (first < oldest)
            first = oldest;
        var days = new List<DateOnly>();
        for (var day = first; day <= today; day = day.AddDays(1))
            days.Add(day);

        var found = new List<JsonNode>();
        foreach (var chunk in days.Chunk(8))
        {
            var batches = await Task.WhenAll(chunk.Select(d => repository.GetAllAsync<AnalyticsEventEntity>(AnalyticsEventEntity.GetPk(WeeklyEditRules.Format(d)), ct)));
            foreach (var e in batches.SelectMany(b => b).Where(e => e.Actor == actor))
            {
                if (Clean(JsonSerializer.SerializeToNode(e, Json)) is { } node)
                    found.Add(node);
            }
        }
        return found;
    }

    private static JsonNode? Clean(JsonNode? node)
    {
        if (node is JsonObject obj)
        {
            foreach (var key in obj.Select(p => p.Key).ToList())
            {
                if (SkippedFields.Contains(key) || key.StartsWith("gsi", StringComparison.OrdinalIgnoreCase))
                    obj.Remove(key);
                else
                    Clean(obj[key]);
            }
        }
        else if (node is JsonArray array)
        {
            foreach (var child in array)
                Clean(child);
        }
        return node;
    }

    /// <summary>"ConsentHistoryEntity" → "consent-history".</summary>
    public static string FileNameFor(Type type)
    {
        var name = type.Name.EndsWith("Entity", StringComparison.Ordinal) ? type.Name[..^"Entity".Length] : type.Name;
        var builder = new StringBuilder();
        for (var i = 0; i < name.Length; i++)
        {
            if (char.IsUpper(name[i]) && i > 0)
                builder.Append('-');
            builder.Append(char.ToLowerInvariant(name[i]));
        }
        return builder.ToString();
    }

    private string Readme(string language, IReadOnlyList<string> files)
    {
        var tr = language.StartsWith("tr", StringComparison.OrdinalIgnoreCase);
        var list = string.Join('\n', files.Select(f => "  " + f));
        return tr
            ? $"""
              Droblet — veri kopyan ({Now:yyyy-MM-dd HH:mm} UTC)

              Bu arşiv, hesabında tuttuğumuz verilerin bir kopyasıdır (KVKK m.11, GDPR md.15 ve 20).
              - profile.json: hesap ve profil bilgilerin (ad, e-posta, @kullanıcı adı, dil, şehir, gizlilik).
              - data/*.json: kaydettiğimiz her kayıt türü, makine tarafından okunabilir JSON olarak
                (gardırop parçaları, kombinler, plan günleri, giyim kaydı, seyahatler, stil ve vücut profili,
                rızalar ve rıza geçmişi, takip ilişkileri, puanlar, sepet ve izleme listesi, bildirimler,
                satın almalar, üyelik ve kredi geçmişi, analitik olaylar).
              - files/: yüklediğin ve senin için oluşturulan görseller (vücut / yüz fotoğrafları, "Üzerimde gör"
                görselleri, parça görselleri, profil fotoğrafı).
              Şifre özetleri, oturum anahtarları, bildirim jetonları ve iç anahtarlar güvenlik için dahil değildir.

              Dosyalar:
              {list}
              """
            : $"""
              Droblet — your data ({Now:yyyy-MM-dd HH:mm} UTC)

              This archive is a copy of the data we keep for your account (KVKK art. 11, GDPR art. 15 and 20).
              - profile.json: your account and profile (name, e-mail, @handle, language, city, privacy).
              - data/*.json: every kind of record we store, as machine-readable JSON (wardrobe items, looks,
                plan days, wear log, trips, style and body profile, consents and their history, follows,
                ratings, cart and watch list, notifications, purchases, membership and credit history,
                analytics events).
              - files/: the images you uploaded and the ones made for you (body / face photos, "See it on me"
                images, item images, profile picture).
              Password hashes, session keys, push tokens and internal keys are left out for security.

              Files:
              {list}
              """;
    }
}
