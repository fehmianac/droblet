using System.Text.Json.Serialization;
using Domain.Entity.Base;
using Domain.Enum;
using Domain.Extensions;

namespace Domain.Entity;

/// <summary>
/// The current parental consent of a teen account (docs/api/teen.md §5): one row per tenant. The audit trail is
/// <see cref="ParentalConsentEventEntity"/>. The parent address is kept only to send the e-mails (resend, confirmation)
/// and is removed when the teen turns 18; the history keeps only its hash. Removed with the account (DeletionPlan).
/// </summary>
public class ParentalConsentEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk();

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("userId")] public string UserId { get; set; } = null!;
    [JsonPropertyName("status")] public ParentalConsentStatus Status { get; set; }
    [JsonPropertyName("parentEmail")] public string? ParentEmail { get; set; }
    [JsonPropertyName("language")] public string Language { get; set; } = "tr";
    // The open request (approval link). A new request / resend replaces it; the old token row stops resolving to it.
    [JsonPropertyName("requestId")] public string? RequestId { get; set; }
    [JsonPropertyName("requestSentAt")] public DateTime? RequestSentAt { get; set; }
    [JsonPropertyName("requestExpiresAt")] public DateTime? RequestExpiresAt { get; set; }
    // Set once the daily run recorded the expiry of RequestId (history "expired"), so it is recorded once.
    [JsonPropertyName("requestExpiredRecordedAt")] public DateTime? RequestExpiredRecordedAt { get; set; }
    [JsonPropertyName("decidedAt")] public DateTime? DecidedAt { get; set; }
    [JsonPropertyName("approvedAt")] public DateTime? ApprovedAt { get; set; }
    [JsonPropertyName("withdrawnAt")] public DateTime? WithdrawnAt { get; set; }
    [JsonPropertyName("parentAllowedTryOn")] public bool ParentAllowedTryOn { get; set; }
    [JsonPropertyName("textVersion")] public string? TextVersion { get; set; }
    // Hashes of the issued link tokens (request + manage), so the turning-18 / deletion paths can revoke them.
    [JsonPropertyName("tokenHashes")] public List<string> TokenHashes { get; set; } = [];
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#parentalconsent";
    public static string GetSk() => "current";
}

/// <summary>
/// Append-only history of the parental consent: who (hash of the parent e-mail), when, the IP hash (never the IP), the text
/// version, the try-on box and the three confirmations. Kept until the account is deleted.
/// </summary>
public class ParentalConsentEventEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(Id);

    /// <summary>ULID: the sort key orders the log by time.</summary>
    [JsonPropertyName("id")] public string Id { get; set; } = null!;
    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("event")] public ParentalConsentEvent Event { get; set; }
    [JsonPropertyName("at")] public DateTime At { get; set; }
    [JsonPropertyName("parentEmailHash")] public string? ParentEmailHash { get; set; }
    [JsonPropertyName("ipHash")] public string? IpHash { get; set; }
    [JsonPropertyName("textVersion")] public string? TextVersion { get; set; }
    [JsonPropertyName("tryOnAllowed")] public bool? TryOnAllowed { get; set; }
    [JsonPropertyName("confirmParent")] public bool? ConfirmParent { get; set; }
    [JsonPropertyName("confirmNotice")] public bool? ConfirmNotice { get; set; }
    [JsonPropertyName("confirmProcessing")] public bool? ConfirmProcessing { get; set; }
    [JsonPropertyName("requestId")] public string? RequestId { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#parentalconsentlog";
    public static string GetSk(string id) => id;
}

/// <summary>
/// Link token hash → the teen account (the parent opens the link signed out). Only the SHA-256 of the token is stored.
/// Request tokens die with their request (RequestId must still match) or after Teen:ConsentLinkDays; manage tokens at 18.
/// </summary>
public class ParentalConsentTokenEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk();
    [JsonPropertyName("sk")] public string Sk => GetSk(TokenHash);

    [JsonPropertyName("tokenHash")] public string TokenHash { get; set; } = null!;
    [JsonPropertyName("kind")] public ParentalTokenKind Kind { get; set; }
    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("userId")] public string UserId { get; set; } = null!;
    [JsonPropertyName("requestId")] public string? RequestId { get; set; }
    [JsonPropertyName("expiresAt")] public DateTime ExpiresAt { get; set; }
    // DynamoDB removes the row some time after this (an expired link answers 410 until then, 404 after).
    [JsonPropertyName("ttl")] public long Ttl => ExpiresAt.AddDays(30).ToUnixTimeSeconds();

    public static string GetPk() => "parentalconsenttoken";
    public static string GetSk(string tokenHash) => tokenHash;
}

/// <summary>
/// Every teen account in one partition, so the daily run (turning 18, retention, request expiry) never scans the table.
/// LastActiveAt = last sign-in / token refresh (retention clock). Removed at 18 and with the account.
/// </summary>
public class TeenAccountIndexEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk();
    [JsonPropertyName("sk")] public string Sk => GetSk(TenantId);

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("userId")] public string UserId { get; set; } = null!;
    [JsonPropertyName("adultFrom")] public string AdultFrom { get; set; } = null!;
    [JsonPropertyName("lastActiveAt")] public DateTime LastActiveAt { get; set; }
    [JsonPropertyName("photosPurgedAt")] public DateTime? PhotosPurgedAt { get; set; }
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }

    public static string GetPk() => "teenaccounts";
    public static string GetSk(string tenantId) => tenantId;
}
