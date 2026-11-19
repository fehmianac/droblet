using Domain.Entity;
using Domain.Events;
using Domain.Extensions;
using Domain.Manager;
using Domain.Services;
using Microsoft.Extensions.Logging;

namespace Infrastructure.Services;

/// <summary>"Verilerimi indir", Api side. The ZIP is built by the data export worker (DataExportJob).</summary>
public sealed class DataExportService(
    IRepository repository,
    IObjectStorage storage,
    IEventManager events,
    TimeProvider timeProvider,
    ILogger<DataExportService> logger) : IDataExportService
{
    public static readonly TimeSpan DownloadUrlTtl = TimeSpan.FromMinutes(10);

    private DateTime Now => timeProvider.GetUtcNow().UtcDateTime;

    public async Task<DataExportStartResult> StartAsync(string tenantId, string userId, string language, CancellationToken ct)
    {
        var now = Now;
        var exports = await repository.GetAllAsync<DataExportEntity>(DataExportEntity.GetPk(tenantId), ct);
        if (exports.Any(e => e.IsActive))
            return new DataExportStartResult(DataExportStartOutcome.InProgress, await StateAsync(exports, now, ct));
        if (DataExportRules.NextRequestAt(exports, now) is not null)
            return new DataExportStartResult(DataExportStartOutcome.TooSoon, await StateAsync(exports, now, ct));

        var export = new DataExportEntity
        {
            Id = Ulid.New(now),
            TenantId = tenantId,
            UserId = userId,
            Status = DataExportStatus.Queued,
            Language = language,
            CreatedAt = now,
            UpdatedAt = now,
        };
        await repository.SaveAsync(export, ct);
        try
        {
            await events.PublishAsync(new DataExportRequestedEvent(tenantId, export.Id), ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Never leave a "preparing" export that nothing will finish: it would block the next request.
            export.Status = DataExportStatus.Failed;
            export.Failure = "queue_unavailable";
            export.UpdatedAt = Now;
            await repository.SaveAsync(export, ct);
            logger.LogError(ex, "Data export {ExportId} could not be queued for tenant {TenantId}", export.Id, tenantId);
            throw;
        }

        logger.LogInformation("Data export {ExportId} queued for tenant {TenantId}", export.Id, tenantId);
        exports.Add(export);
        return new DataExportStartResult(DataExportStartOutcome.Started, await StateAsync(exports, now, ct));
    }

    public async Task<DataExportStateDto> GetStateAsync(string tenantId, CancellationToken ct) =>
        await StateAsync(await repository.GetAllAsync<DataExportEntity>(DataExportEntity.GetPk(tenantId), ct), Now, ct);

    public async Task<(DataExportDownloadOutcome Outcome, string? Url)> ResolveDownloadAsync(string token, CancellationToken ct)
    {
        var hash = token.Sha256Hex();
        var pointer = await repository.GetAsync<DataExportTokenEntity>(DataExportTokenEntity.GetPk(), DataExportTokenEntity.GetSk(hash), ct);
        if (pointer is null)
            return (DataExportDownloadOutcome.NotFound, null);
        var export = await repository.GetAsync<DataExportEntity>(DataExportEntity.GetPk(pointer.TenantId), DataExportEntity.GetSk(pointer.ExportId), ct);
        if (export is null || export.DownloadTokenHash != hash || export.Status != DataExportStatus.Ready || export.S3Key is null)
            return (DataExportDownloadOutcome.NotFound, null);
        if (export.ExpiresAt is not { } expires || expires <= Now)
            return (DataExportDownloadOutcome.Expired, null);
        return (DataExportDownloadOutcome.Ready, await storage.CreateDownloadUrlAsync(export.S3Key, FileName(export), DownloadUrlTtl, ct));
    }

    public static string FileName(DataExportEntity export) => $"droblet-verilerim-{export.CreatedAt:yyyy-MM-dd}.zip";

    private async Task<DataExportStateDto> StateAsync(List<DataExportEntity> exports, DateTime now, CancellationToken ct)
    {
        var latest = exports.MaxBy(e => e.CreatedAt);
        var next = DataExportRules.NextRequestAt(exports, now);
        var canRequest = latest is not { IsActive: true } && next is null;
        return new DataExportStateDto(latest is null ? null : await ToDtoAsync(latest, now, ct), canRequest, next);
    }

    private async Task<DataExportDto> ToDtoAsync(DataExportEntity export, DateTime now, CancellationToken ct)
    {
        var expired = export.Status == DataExportStatus.Ready && export.ExpiresAt is { } at && at <= now;
        string? url = null;
        DateTime? urlExpires = null;
        if (export.Status == DataExportStatus.Ready && !expired && export.S3Key is not null)
        {
            url = await storage.CreateDownloadUrlAsync(export.S3Key, FileName(export), DownloadUrlTtl, ct);
            urlExpires = now.Add(DownloadUrlTtl);
        }
        return new DataExportDto(
            export.Id,
            expired ? "expired" : DataExportRules.Code(export.Status),
            export.CreatedAt,
            export.CompletedAt,
            export.ExpiresAt,
            export.SizeBytes,
            export.FileCount,
            url,
            urlExpires);
    }
}
