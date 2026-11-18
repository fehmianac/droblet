using System.Text.Json.Serialization;
using Domain.Entity.Base;
using Domain.Enum;
using Domain.Extensions;

namespace Domain.Entity;

// Admin panel accounts (owner decision 2, README §13). Separate from app users: own partition, own password,
// own tokens (AdminJwt). Nothing here is ever readable through an app (tenant) endpoint.

public class AdminUserEntity : IVersionedEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk();
    [JsonPropertyName("sk")] public string Sk => GetSk(Id);

    [JsonPropertyName("id")] public string Id { get; set; } = null!;
    /// <summary>Normalized (trimmed, lower-case). Uniqueness is held by <see cref="AdminEmailIndexEntity"/>.</summary>
    [JsonPropertyName("email")] public string Email { get; set; } = null!;
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("role")] public AdminRole Role { get; set; }
    [JsonPropertyName("disabled")] public bool Disabled { get; set; }
    [JsonPropertyName("passwordSet")] public bool PasswordSet { get; set; }
    /// <summary>Access and refresh tokens issued before this instant are rejected (logout-all, password change, disable, role change).</summary>
    [JsonPropertyName("tokensValidAfter")] public DateTime? TokensValidAfter { get; set; }
    [JsonPropertyName("lastLoginAt")] public DateTime? LastLoginAt { get; set; }
    [JsonPropertyName("createdBy")] public string? CreatedBy { get; set; }
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }
    [JsonPropertyName("version")] public long Version { get; set; }

    public static string GetPk() => "admin#user";
    public static string GetSk(string id) => id;
}

/// <summary>Case-insensitive unique e-mail → admin id. Created with a not-exists condition.</summary>
public class AdminEmailIndexEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk();
    [JsonPropertyName("sk")] public string Sk => GetSk(Email);

    [JsonPropertyName("email")] public string Email { get; set; } = null!;
    [JsonPropertyName("adminId")] public string AdminId { get; set; } = null!;

    public static string GetPk() => "admin#email";
    public static string GetSk(string normalizedEmail) => normalizedEmail;
}

/// <summary>PBKDF2 hash, kept apart from the admin row so it can never reach a DTO.</summary>
public class AdminCredentialEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk();
    [JsonPropertyName("sk")] public string Sk => GetSk(AdminId);

    [JsonPropertyName("adminId")] public string AdminId { get; set; } = null!;
    [JsonPropertyName("passwordHash")] public string PasswordHash { get; set; } = null!;
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }

    public static string GetPk() => "admin#credential";
    public static string GetSk(string adminId) => adminId;
}

/// <summary>
/// Second sign-in step: a 6-digit code e-mailed after a correct password. sk = SHA-256 of the opaque challenge id;
/// only a salted hash of the code is stored. Deleted on success (single use) or after the last allowed wrong try.
/// </summary>
public class AdminLoginChallengeEntity : IVersionedEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk();
    [JsonPropertyName("sk")] public string Sk => GetSk(ChallengeHash);

    [JsonPropertyName("challengeHash")] public string ChallengeHash { get; set; } = null!;
    [JsonPropertyName("adminId")] public string AdminId { get; set; } = null!;
    [JsonPropertyName("codeHash")] public string CodeHash { get; set; } = null!;
    [JsonPropertyName("failedAttempts")] public int FailedAttempts { get; set; }
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }
    [JsonPropertyName("expiresAt")] public DateTime ExpiresAt { get; set; }
    [JsonPropertyName("version")] public long Version { get; set; }

    [JsonPropertyName("ttl")] public long Ttl => ExpiresAt.AddDays(1).ToUnixTimeSeconds();

    public static string GetPk() => "admin#challenge";
    public static string GetSk(string challengeHash) => challengeHash;
}

public class AdminRefreshTokenEntity : IVersionedEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk();
    [JsonPropertyName("sk")] public string Sk => GetSk(TokenHash);

    [JsonPropertyName("tokenHash")] public string TokenHash { get; set; } = null!;
    [JsonPropertyName("adminId")] public string AdminId { get; set; } = null!;
    [JsonPropertyName("familyId")] public string FamilyId { get; set; } = null!;
    [JsonPropertyName("issuedAt")] public DateTime IssuedAt { get; set; }
    [JsonPropertyName("expiresAt")] public DateTime ExpiresAt { get; set; }
    [JsonPropertyName("rotatedAt")] public DateTime? RotatedAt { get; set; }
    [JsonPropertyName("version")] public long Version { get; set; }

    [JsonPropertyName("ttl")] public long Ttl => ExpiresAt.ToUnixTimeSeconds();

    public static string GetPk() => "admin#refresh";
    public static string GetSk(string tokenHash) => tokenHash;
}

public enum AdminPasswordTokenPurpose { Reset, Invite }

/// <summary>Set / reset password link token (single use). sk = SHA-256 of the token.</summary>
public class AdminPasswordTokenEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk();
    [JsonPropertyName("sk")] public string Sk => GetSk(TokenHash);

    [JsonPropertyName("tokenHash")] public string TokenHash { get; set; } = null!;
    [JsonPropertyName("adminId")] public string AdminId { get; set; } = null!;
    [JsonPropertyName("purpose")] public AdminPasswordTokenPurpose Purpose { get; set; }
    [JsonPropertyName("expiresAt")] public DateTime ExpiresAt { get; set; }

    [JsonPropertyName("ttl")] public long Ttl => ExpiresAt.ToUnixTimeSeconds();

    public static string GetPk() => "admin#passwordtoken";
    public static string GetSk(string tokenHash) => tokenHash;
}

/// <summary>
/// Append-only audit trail of admin writes. sk = the time-ordered ULID id (paged queries run newest first).
/// Never holds passwords, tokens or codes.
/// </summary>
public class AdminAuditEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk();
    [JsonPropertyName("sk")] public string Sk => GetSk(Id);

    [JsonPropertyName("id")] public string Id { get; set; } = null!;
    [JsonPropertyName("at")] public DateTime At { get; set; }
    [JsonPropertyName("adminId")] public string? AdminId { get; set; }
    [JsonPropertyName("adminEmail")] public string? AdminEmail { get; set; }
    [JsonPropertyName("action")] public string Action { get; set; } = null!;
    [JsonPropertyName("targetType")] public string? TargetType { get; set; }
    [JsonPropertyName("targetId")] public string? TargetId { get; set; }
    [JsonPropertyName("before")] public string? Before { get; set; }
    [JsonPropertyName("after")] public string? After { get; set; }
    [JsonPropertyName("ip")] public string? Ip { get; set; }

    public static string GetPk() => "admin#audit";
    public static string GetSk(string id) => id;
}

/// <summary>Written once together with the bootstrap super admin; its existence stops any later bootstrap.</summary>
public class AdminBootstrapMarkerEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk();
    [JsonPropertyName("sk")] public string Sk => GetSk();

    [JsonPropertyName("adminId")] public string AdminId { get; set; } = null!;
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }

    public static string GetPk() => "admin#bootstrap";
    public static string GetSk() => "marker";
}
