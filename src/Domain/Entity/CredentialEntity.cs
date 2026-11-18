using System.Text.Json.Serialization;
using Domain.Entity.Base;

namespace Domain.Entity;

// Password hash for email + password sign-in (README §9.3). Kept apart from UserEntity so it never reaches a DTO.
public class CredentialEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk();
    [JsonPropertyName("sk")] public string Sk => GetSk(UserId);

    [JsonPropertyName("userId")] public string UserId { get; set; } = null!;
    [JsonPropertyName("passwordHash")] public string PasswordHash { get; set; } = null!;
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }

    public static string GetPk() => "credential";
    public static string GetSk(string userId) => userId;
}
