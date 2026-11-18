using System.Text.Json.Serialization;
using Domain.Entity.Base;
using Domain.Extensions;

namespace Domain.Entity;

// sk is the SHA-256 of the token: a table read never yields a usable token.
public class RefreshTokenEntity : IVersionedEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk();
    [JsonPropertyName("sk")] public string Sk => GetSk(TokenHash);

    [JsonPropertyName("tokenHash")] public string TokenHash { get; set; } = null!;
    [JsonPropertyName("userId")] public string UserId { get; set; } = null!;
    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("familyId")] public string FamilyId { get; set; } = null!;
    [JsonPropertyName("issuedAt")] public DateTime IssuedAt { get; set; }
    [JsonPropertyName("expiresAt")] public DateTime ExpiresAt { get; set; }
    // Set when rotated; presenting a rotated token again is treated as theft (all sessions revoked).
    [JsonPropertyName("rotatedAt")] public DateTime? RotatedAt { get; set; }

    // Versioned so two concurrent refreshes cannot both rotate the same token.
    [JsonPropertyName("version")] public long Version { get; set; }

    [JsonPropertyName("ttl")] public long Ttl => ExpiresAt.ToUnixTimeSeconds();

    public static string GetPk() => "RefreshToken";
    public static string GetSk(string tokenHash) => tokenHash;
}
