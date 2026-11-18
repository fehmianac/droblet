using System.Text.Json.Serialization;
using Domain.Entity.Base;
using Domain.Enum;
using Domain.Extensions;

namespace Domain.Entity;

// Server-side try-on credit counter (brief §5.2). Only CreditLedger rules change these numbers.
public class CreditAccountEntity : IVersionedEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk();

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    // Start of the subscription month whose allowance AllowanceUsed refers to.
    [JsonPropertyName("periodStart")] public DateTime? PeriodStart { get; set; }
    [JsonPropertyName("allowanceUsed")] public int AllowanceUsed { get; set; }
    [JsonPropertyName("packBalance")] public int PackBalance { get; set; }
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }
    [JsonPropertyName("version")] public long Version { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#credit";
    public static string GetSk() => "account";
}

// One reservation per idempotency key: the same outfit/body photo never charges twice.
public class CreditReservationEntity : IVersionedEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(IdempotencyKey);

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("idempotencyKey")] public string IdempotencyKey { get; set; } = null!;
    [JsonPropertyName("jobId")] public string? JobId { get; set; }
    [JsonPropertyName("status")] public CreditReservationStatus Status { get; set; }
    [JsonPropertyName("fromAllowance")] public int FromAllowance { get; set; }
    [JsonPropertyName("fromPack")] public int FromPack { get; set; }
    [JsonPropertyName("periodStart")] public DateTime? PeriodStart { get; set; }
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }
    [JsonPropertyName("version")] public long Version { get; set; }

    [JsonPropertyName("ttl")] public long Ttl => CreatedAt.AddDays(400).ToUnixTimeSeconds();

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#creditreservation";
    public static string GetSk(string idempotencyKey) => idempotencyKey;
}

// Credit movements ("kredi hareketleri", brief §6) — append only.
public class CreditLedgerEntryEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(CreatedAt, Id);

    [JsonPropertyName("id")] public string Id { get; set; } = null!;
    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("kind")] public CreditLedgerEntryKind Kind { get; set; }
    [JsonPropertyName("allowanceDelta")] public int AllowanceDelta { get; set; }
    [JsonPropertyName("packDelta")] public int PackDelta { get; set; }
    [JsonPropertyName("idempotencyKey")] public string? IdempotencyKey { get; set; }
    [JsonPropertyName("reference")] public string? Reference { get; set; }
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }

    [JsonPropertyName("ttl")] public long Ttl => CreatedAt.AddDays(400).ToUnixTimeSeconds();

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#creditledger";
    public static string GetSk(DateTime createdAt, string id) => $"{createdAt.ToUnixTimeMilliseconds():D13}#{id}";
}
