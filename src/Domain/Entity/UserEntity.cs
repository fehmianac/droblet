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
    // "I am 18 or older" (Terms §3, privacy §17): ticked at e-mail sign-up, or confirmed once after the first Apple / Google
    // sign-in (POST v1/tenant/profile/age-confirmation). Null = not confirmed yet: the app routes to the confirmation first.
    [JsonPropertyName("ageConfirmedAt")] public DateTime? AgeConfirmedAt { get; set; }
    // The address was proven: the 6-digit code / link of the verification e-mail, a password reset link, or Apple /
    // Google saying the address is verified. Null on an e-mail sign-up until then (the app asks, never blocks).
    [JsonPropertyName("emailVerifiedAt")] public DateTime? EmailVerifiedAt { get; set; }

    /// <summary>
    /// True when there is nothing to verify: verified, no address, or an account without an e-mail sign-in (Apple /
    /// Google only — the provider owns that address; contact matching lists it only when the provider verified it).
    /// </summary>
    [JsonIgnore]
    public bool IsEmailVerified =>
        EmailVerifiedAt is not null
        || string.IsNullOrEmpty(Email)
        || !Identities.Any(sk => sk.StartsWith("email#", StringComparison.Ordinal));

    public static string GetPk() => "users";
    public static string GetSk(string id) => id;
}
