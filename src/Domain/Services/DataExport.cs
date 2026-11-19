using Domain.Entity;

namespace Domain.Services;

public sealed record DataExportDto(
    string Id,
    string Status,
    DateTime CreatedAt,
    DateTime? CompletedAt,
    DateTime? ExpiresAt,
    long? SizeBytes,
    int? FileCount,
    // Ready and not expired: a fresh short-lived presigned GET (the app opens it; the e-mail link uses the token).
    string? DownloadUrl,
    DateTime? DownloadUrlExpiresAt);

/// <summary>GET v1/tenant/export: the latest export (null = none yet) and whether a new one may be started.</summary>
public sealed record DataExportStateDto(DataExportDto? Export, bool CanRequest, DateTime? NextRequestAt);

public enum DataExportStartOutcome { Started, InProgress, TooSoon }

public sealed record DataExportStartResult(DataExportStartOutcome Outcome, DataExportStateDto State);

public enum DataExportDownloadOutcome { Ready, NotFound, Expired }

/// <summary>"Verilerimi indir" on the Api side: start (one active, one per day), status, download link.</summary>
public interface IDataExportService
{
    Task<DataExportStartResult> StartAsync(string tenantId, string userId, string language, CancellationToken ct);
    Task<DataExportStateDto> GetStateAsync(string tenantId, CancellationToken ct);
    /// <summary>The e-mailed token → a fresh presigned GET of the ZIP.</summary>
    Task<(DataExportDownloadOutcome Outcome, string? Url)> ResolveDownloadAsync(string token, CancellationToken ct);
}

/// <summary>The worker: builds the ZIP, stores it, writes the inbox row and sends the e-mail.</summary>
public interface IDataExportJob
{
    /// <summary>Throws to let SQS retry; on the last attempt the export is marked failed instead.</summary>
    Task ProcessAsync(string tenantId, string exportId, bool isLastAttempt, CancellationToken ct);
}

public static class DataExportRules
{
    public static readonly TimeSpan MinInterval = TimeSpan.FromDays(1);
    public static readonly TimeSpan FileLifetime = TimeSpan.FromDays(DataExportEntity.FileDays);

    /// <summary>
    /// One active export at a time; at most one per day — a failed export does not count (the user may try again).
    /// Returns when the next request is allowed (null = now).
    /// </summary>
    public static DateTime? NextRequestAt(IEnumerable<DataExportEntity> exports, DateTime now)
    {
        var list = exports.ToList();
        if (list.Any(e => e.IsActive))
            return null;
        var last = list.Where(e => e.Status != DataExportStatus.Failed).MaxBy(e => e.CreatedAt);
        if (last is null)
            return null;
        var next = last.CreatedAt.Add(MinInterval);
        return next > now ? next : null;
    }

    public static string Code(DataExportStatus status) => status switch
    {
        DataExportStatus.Queued => "queued",
        DataExportStatus.Processing => "processing",
        DataExportStatus.Ready => "ready",
        _ => "failed",
    };
}
