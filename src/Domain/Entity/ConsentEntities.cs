using System.Text.Json.Serialization;
using Domain.Entity.Base;
using Domain.Enum;

namespace Domain.Entity;

/// <summary>
/// The current decision per consent type (one row per type). The audit trail is <see cref="ConsentHistoryEntity"/>;
/// this row is only the projection the guards read. Removed with the account (DeletionPlan).
/// </summary>
public class ConsentEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(Type);

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("userId")] public string? UserId { get; set; }
    [JsonPropertyName("type")] public ConsentType Type { get; set; }
    [JsonPropertyName("granted")] public bool Granted { get; set; }
    /// <summary>Version of the text the user saw when deciding (Consents:Versions).</summary>
    [JsonPropertyName("version")] public string Version { get; set; } = null!;
    /// <summary>Last time the consent was given (kept after a withdrawal, for the settings list).</summary>
    [JsonPropertyName("grantedAt")] public DateTime? GrantedAt { get; set; }
    [JsonPropertyName("withdrawnAt")] public DateTime? WithdrawnAt { get; set; }
    [JsonPropertyName("locale")] public string? Locale { get; set; }
    [JsonPropertyName("source")] public string? Source { get; set; }
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#consent";
    public static string GetSk(ConsentType type) => type.ToString().ToLowerInvariant();
}

/// <summary>
/// Append-only consent audit log: every grant and withdrawal (date, text version, locale, where it was given).
/// Never updated (create-only writes). Kept until the account is deleted (legal text: consents, "how these texts work").
/// </summary>
public class ConsentHistoryEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(Id);

    /// <summary>ULID: the sort key orders the log by time.</summary>
    [JsonPropertyName("id")] public string Id { get; set; } = null!;
    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("userId")] public string? UserId { get; set; }
    [JsonPropertyName("type")] public ConsentType Type { get; set; }
    [JsonPropertyName("granted")] public bool Granted { get; set; }
    [JsonPropertyName("version")] public string Version { get; set; } = null!;
    [JsonPropertyName("locale")] public string? Locale { get; set; }
    [JsonPropertyName("source")] public string? Source { get; set; }
    [JsonPropertyName("at")] public DateTime At { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#consentlog";
    public static string GetSk(string id) => id;
}
