using System.Text.Json.Serialization;
using Domain.Entity.Base;
using Domain.Enum;

namespace Domain.Entity;

public class StyleProfileEntity : IVersionedEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk();

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("segment")] public Segment Segment { get; set; }
    [JsonPropertyName("styleTags")] public List<StyleTag> StyleTags { get; set; } = [];
    [JsonPropertyName("budget")] public Budget Budget { get; set; }
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }
    [JsonPropertyName("version")] public long Version { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#styleprofile";
    public static string GetSk() => "current";
}

// Never visible to another tenant (VisibilityPolicy.BodyProfile is always false). Never logged.
public class BodyProfileEntity : IVersionedEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk();

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("heightCm")] public int HeightCm { get; set; }
    [JsonPropertyName("weightKg")] public decimal? WeightKg { get; set; }
    [JsonPropertyName("size")] public ClothingSize Size { get; set; }
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }
    [JsonPropertyName("version")] public long Version { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#bodyprofile";
    public static string GetSk() => "current";
}

public class HandleEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk();
    [JsonPropertyName("sk")] public string Sk => GetSk(Handle);

    [JsonPropertyName("handle")] public string Handle { get; set; } = null!;
    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }

    public static string GetPk() => "handle";
    public static string GetSk(string handle) => handle.Trim().ToLowerInvariant();
}

public class DeviceEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(DeviceId);

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("deviceId")] public string DeviceId { get; set; } = null!;
    [JsonPropertyName("platform")] public string? Platform { get; set; }
    [JsonPropertyName("pushToken")] public string? PushToken { get; set; }
    // fcm (Android, and any FCM token) | apns (raw iOS device token). Null on rows written before = fcm.
    [JsonPropertyName("pushTokenType")] public PushTokenType? PushTokenType { get; set; }
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#device";
    public static string GetSk(string deviceId) => deviceId;
}
