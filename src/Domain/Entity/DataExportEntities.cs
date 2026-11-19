using System.Text.Json.Serialization;
using Domain.Entity.Base;
using Domain.Extensions;

namespace Domain.Entity;

public enum DataExportStatus { Queued, Processing, Ready, Failed }

/// <summary>
/// "Verilerimi indir" (KVKK m.11 / GDPR art.15 + 20): one ZIP of everything stored about the account, built by the
/// data export worker into the private photo bucket under exports/{tenantId}/ (bucket lifecycle: 7 days). The row is
/// kept a little longer than the file so the app can still say "expired".
/// </summary>
public class DataExportEntity : IEntity
{
    public const int FileDays = 7;
    public const int RowDays = 30;

    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(Id);

    [JsonPropertyName("id")] public string Id { get; set; } = null!;
    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("userId")] public string UserId { get; set; } = null!;
    [JsonPropertyName("status")] public DataExportStatus Status { get; set; }
    // Language of the e-mail and of README.txt (the request's language).
    [JsonPropertyName("language")] public string Language { get; set; } = "tr";
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }
    [JsonPropertyName("completedAt")] public DateTime? CompletedAt { get; set; }
    // Ready: the link and the file work until then (CompletedAt + 7 days).
    [JsonPropertyName("expiresAt")] public DateTime? ExpiresAt { get; set; }
    [JsonPropertyName("s3Key")] public string? S3Key { get; set; }
    [JsonPropertyName("sizeBytes")] public long? SizeBytes { get; set; }
    [JsonPropertyName("fileCount")] public int? FileCount { get; set; }
    // SHA-256 of the e-mailed download token (the link works signed out, on any device).
    [JsonPropertyName("downloadTokenHash")] public string? DownloadTokenHash { get; set; }
    [JsonPropertyName("failure")] public string? Failure { get; set; }

    [JsonPropertyName("ttl")] public long Ttl => CreatedAt.AddDays(RowDays).ToUnixTimeSeconds();

    [JsonIgnore] public bool IsActive => Status is DataExportStatus.Queued or DataExportStatus.Processing;

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#dataexport";
    public static string GetSk(string id) => id;
}

/// <summary>Download token hash → export (GET v1/export/download?token=…, anonymous). Expires with the file.</summary>
public class DataExportTokenEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk();
    [JsonPropertyName("sk")] public string Sk => GetSk(TokenHash);

    [JsonPropertyName("tokenHash")] public string TokenHash { get; set; } = null!;
    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("exportId")] public string ExportId { get; set; } = null!;
    [JsonPropertyName("expiresAt")] public DateTime ExpiresAt { get; set; }

    [JsonPropertyName("ttl")] public long Ttl => ExpiresAt.ToUnixTimeSeconds();

    public static string GetPk() => "dataexporttoken";
    public static string GetSk(string tokenHash) => tokenHash;
}
