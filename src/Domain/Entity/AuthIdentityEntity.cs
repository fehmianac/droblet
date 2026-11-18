using System.Text.Json.Serialization;
using Domain.Entity.Base;
using Domain.Enum;

namespace Domain.Entity;

// Provider identity -> userId. Email identities use the lower-cased address as subject.
public class AuthIdentityEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk();
    [JsonPropertyName("sk")] public string Sk => GetSk(Provider, Subject);

    [JsonPropertyName("provider")] public AuthProvider Provider { get; set; }
    [JsonPropertyName("subject")] public string Subject { get; set; } = null!;
    [JsonPropertyName("userId")] public string UserId { get; set; } = null!;
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }
    // Sign in with Apple only: the refresh token from the authorization-code exchange, AES-GCM encrypted
    // (AppleTokenProtector). Revoked at Apple when the account is deleted (App Store guideline 5.1.1(v)).
    [JsonPropertyName("appleRefreshToken")] public string? AppleRefreshToken { get; set; }

    public static string GetPk() => "authidentity";
    public static string GetSk(AuthProvider provider, string subject) =>
        $"{provider.ToString().ToLowerInvariant()}#{(provider == AuthProvider.Email ? subject.Trim().ToLowerInvariant() : subject)}";
}
