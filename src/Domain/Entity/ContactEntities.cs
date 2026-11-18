using System.Text.Json.Serialization;
using Domain.Entity.Base;
using Domain.Extensions;

namespace Domain.Entity;

// Decision 13 — contact matching. See Domain.Services.ContactHashRules and docs/privacy/contacts-matching.md.

/// <summary>Single-use salt of one contact-matching request. Deleted when used; TTL = expiry.</summary>
public class ContactSaltEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(SaltId);

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("saltId")] public string SaltId { get; set; } = null!;
    [JsonPropertyName("salt")] public string Salt { get; set; } = null!;
    [JsonPropertyName("expiresAt")] public DateTime ExpiresAt { get; set; }
    [JsonPropertyName("ttl")] public long Ttl => ExpiresAt.ToUnixTimeSeconds();

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#contactsalt";
    public static string GetSk(string saltId) => saltId;
}

/// <summary>
/// Global directory bucket: a member's verified e-mail as an unsalted SHA-256 (never the address), bucketed by the
/// first hex characters. Removed on account deletion through <see cref="ContactDirectoryPointerEntity"/>.
/// </summary>
public class ContactDirectoryEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(Prefix);
    [JsonPropertyName("sk")] public string Sk => GetSk(TenantId, Hash);

    [JsonPropertyName("prefix")] public string Prefix { get; set; } = null!;
    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("hash")] public string Hash { get; set; } = null!;
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }

    public static string GetPk(string prefix) => $"contactdir#{prefix}";
    public static string GetSk(string tenantId, string hash) => $"{tenantId}#{hash}";
}

/// <summary>In the member's partition: which directory rows are theirs (for account deletion).</summary>
public class ContactDirectoryPointerEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(Hash);

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("hash")] public string Hash { get; set; } = null!;
    [JsonPropertyName("prefix")] public string Prefix { get; set; } = null!;

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#contactdir";
    public static string GetSk(string hash) => hash;
}
