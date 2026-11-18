using System.Text.Json.Serialization;
using Domain.Entity.Base;
using Domain.Extensions;

namespace Domain.Entity;

public class PasswordResetEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk();
    [JsonPropertyName("sk")] public string Sk => GetSk(TokenHash);

    [JsonPropertyName("tokenHash")] public string TokenHash { get; set; } = null!;
    [JsonPropertyName("userId")] public string UserId { get; set; } = null!;
    [JsonPropertyName("expiresAt")] public DateTime ExpiresAt { get; set; }

    [JsonPropertyName("ttl")] public long Ttl => ExpiresAt.ToUnixTimeSeconds();

    public static string GetPk() => "passwordreset";
    public static string GetSk(string tokenHash) => tokenHash;
}
