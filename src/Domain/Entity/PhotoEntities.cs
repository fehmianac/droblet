using System.Text.Json.Serialization;
using Domain.Entity.Base;
using Domain.Enum;
using Domain.Extensions;

namespace Domain.Entity;

// Body / face photo. One active per kind. Owner-only, private S3, short-lived presigned GET.
public class PhotoEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(Kind, Id);

    [JsonPropertyName("id")] public string Id { get; set; } = null!;
    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("kind")] public PhotoKind Kind { get; set; }
    [JsonPropertyName("s3Key")] public string S3Key { get; set; } = null!;
    [JsonPropertyName("contentType")] public string ContentType { get; set; } = null!;
    [JsonPropertyName("sizeBytes")] public long SizeBytes { get; set; }
    [JsonPropertyName("active")] public bool Active { get; set; }
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#photo";
    public static string GetSk(PhotoKind kind, string id) => $"{KindPrefix(kind)}{id}";
    public static string KindPrefix(PhotoKind kind) => $"{kind.ToString().ToLowerInvariant()}#";
}

// An upload slot issued by POST v1/tenant/photo/upload-url; PUT v1/tenant/photo/{kind} only accepts these.
public class PhotoUploadEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(UploadId);

    [JsonPropertyName("uploadId")] public string UploadId { get; set; } = null!;
    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("kind")] public PhotoKind Kind { get; set; }
    [JsonPropertyName("contentType")] public string ContentType { get; set; } = null!;
    [JsonPropertyName("s3Key")] public string S3Key { get; set; } = null!;
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }

    // Same lifetime as the uploads/tmp/ S3 lifecycle rule (1 day).
    [JsonPropertyName("ttl")] public long Ttl => CreatedAt.AddDays(1).ToUnixTimeSeconds();

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#photoupload";
    public static string GetSk(string uploadId) => uploadId;
}

// Tenant-internal try-on cache. Never global. Deleted with the source body photo.
public class TryOnImageEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(BodyPhotoId, TargetKind, TargetId, TargetVersion);

    [JsonPropertyName("id")] public string Id { get; set; } = null!;
    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("bodyPhotoId")] public string BodyPhotoId { get; set; } = null!;
    [JsonPropertyName("targetKind")] public TryOnTargetKind TargetKind { get; set; }
    [JsonPropertyName("targetId")] public string TargetId { get; set; } = null!;
    [JsonPropertyName("targetVersion")] public long TargetVersion { get; set; }
    [JsonPropertyName("s3Key")] public string S3Key { get; set; } = null!;
    [JsonPropertyName("jobId")] public string? JobId { get; set; }
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#tryon";
    public static string GetSk(string bodyPhotoId, TryOnTargetKind kind, string targetId, long targetVersion) =>
        $"{bodyPhotoId}#{kind}#{targetId}#{targetVersion}";
}

public class PaletteResultEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk();

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("seasonTypeId")] public string SeasonTypeId { get; set; } = null!;
    [JsonPropertyName("flatteringColorIds")] public List<string> FlatteringColorIds { get; set; } = [];
    [JsonPropertyName("avoidColorIds")] public List<string> AvoidColorIds { get; set; } = [];
    [JsonPropertyName("sourcePhotoId")] public string? SourcePhotoId { get; set; }
    [JsonPropertyName("modelVersion")] public string? ModelVersion { get; set; }
    [JsonPropertyName("analyzedAt")] public DateTime AnalyzedAt { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#palette";
    public static string GetSk() => "current";
}

public class RateLimitCounterEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(Scope, KeyHash);
    [JsonPropertyName("sk")] public string Sk => GetSk(WindowStart);

    [JsonPropertyName("scope")] public string Scope { get; set; } = null!;
    [JsonPropertyName("keyHash")] public string KeyHash { get; set; } = null!;
    [JsonPropertyName("windowStart")] public long WindowStart { get; set; }
    [JsonPropertyName("count")] public long Count { get; set; }

    public static string GetPk(string scope, string keyHash) => $"ratelimit#{scope}#{keyHash}";
    public static string GetSk(long windowStart) => windowStart.ToString(System.Globalization.CultureInfo.InvariantCulture);
}
