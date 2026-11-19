using System.Text.Json.Serialization;
using Domain.Entity.Base;
using Domain.Extensions;

namespace Domain.Entity;

/// <summary>
/// The open e-mail verification of a user (one per user; a resend replaces it). Only hashes are stored: the 6-digit
/// code as SHA-256 of "{userId}:{code}", the link token as SHA-256. Removed when the address is verified, with the
/// account, or by TTL.
/// </summary>
public class EmailVerificationEntity : IEntity
{
    public const int MaxCodeAttempts = 5;

    [JsonPropertyName("pk")] public string Pk => GetPk();
    [JsonPropertyName("sk")] public string Sk => GetSk(UserId);

    [JsonPropertyName("userId")] public string UserId { get; set; } = null!;
    // The address the code was sent to: a code never verifies a different address.
    [JsonPropertyName("email")] public string Email { get; set; } = null!;
    [JsonPropertyName("codeHash")] public string CodeHash { get; set; } = null!;
    [JsonPropertyName("tokenHash")] public string TokenHash { get; set; } = null!;
    [JsonPropertyName("attempts")] public int Attempts { get; set; }
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }
    [JsonPropertyName("expiresAt")] public DateTime ExpiresAt { get; set; }

    [JsonPropertyName("ttl")] public long Ttl => ExpiresAt.ToUnixTimeSeconds();

    public static string GetPk() => "emailverification";
    public static string GetSk(string userId) => userId;
}

/// <summary>Link token hash → user (the link is opened signed out too, e.g. on the web page). Single use via the verification row.</summary>
public class EmailVerificationTokenEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk();
    [JsonPropertyName("sk")] public string Sk => GetSk(TokenHash);

    [JsonPropertyName("tokenHash")] public string TokenHash { get; set; } = null!;
    [JsonPropertyName("userId")] public string UserId { get; set; } = null!;
    [JsonPropertyName("expiresAt")] public DateTime ExpiresAt { get; set; }

    [JsonPropertyName("ttl")] public long Ttl => ExpiresAt.ToUnixTimeSeconds();

    public static string GetPk() => "emailverificationtoken";
    public static string GetSk(string tokenHash) => tokenHash;
}
