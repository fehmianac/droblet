using System.Text.Json.Serialization;
using Domain.Entity.Base;

namespace Domain.Entity;

public class UserEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk();
    [JsonPropertyName("sk")] public string Sk => GetSk(Id);

    [JsonPropertyName("id")] public string Id { get; set; } = null!;
    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("displayName")] public string? DisplayName { get; set; }
    [JsonPropertyName("email")] public string? Email { get; set; }
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }
    // Refresh tokens issued before this instant are rejected (password reset, token reuse, logout-all).
    [JsonPropertyName("tokensValidAfter")] public DateTime? TokensValidAfter { get; set; }
    // AuthIdentityEntity sort keys linked to this user, so account deletion can remove them.
    [JsonPropertyName("identities")] public List<string> Identities { get; set; } = [];
    // Set by an admin (panel: suspend, or a report resolved with "userSuspended"). A suspended user cannot sign in or
    // refresh; TokensValidAfter is moved at the same time so existing refresh tokens die.
    [JsonPropertyName("suspendedAt")] public DateTime? SuspendedAt { get; set; }
    [JsonPropertyName("suspendReason")] public string? SuspendReason { get; set; }

    public static string GetPk() => "users";
    public static string GetSk(string id) => id;
}
