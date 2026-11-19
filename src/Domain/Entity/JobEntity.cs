using System.Text.Json.Serialization;
using Domain.Entity.Base;
using Domain.Enum;
using Domain.Extensions;

namespace Domain.Entity;

public class JobEntity : IEntity
{
    public const int RetentionDays = 7;

    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(Id);

    [JsonPropertyName("id")] public string Id { get; set; } = null!;
    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("kind")] public JobKind Kind { get; set; }
    [JsonPropertyName("status")] public JobStatus Status { get; set; }
    [JsonPropertyName("failure")] public JobFailure? Failure { get; set; }
    // Worker output (draft) as JSON; schema per JobKind (AI_ENGINEER.md).
    [JsonPropertyName("result")] public string? Result { get; set; }
    // Request parameters captured by the Api (schema per JobKind); workers read their input only from here.
    [JsonPropertyName("input")] public string? Input { get; set; }
    // Worker stage timings in ms (queue_wait, init, db, s3_get, ai.*, worker, …) — internal diagnostics, no user content.
    [JsonPropertyName("timings")] public Dictionary<string, long>? Timings { get; set; }
    // Estimated AI cost of the run in micro-USD per operation + "calls.{op}" + "total" (Ai:Pricing) — internal, never sent to the app.
    [JsonPropertyName("aiCost")] public Dictionary<string, long>? AiCost { get; set; }
    [JsonPropertyName("creditIdempotencyKey")] public string? CreditIdempotencyKey { get; set; }
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }

    [JsonPropertyName("ttl")] public long Ttl => CreatedAt.AddDays(RetentionDays).ToUnixTimeSeconds();

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#job";
    public static string GetSk(string id) => id;
}

/// <summary>
/// Typical end-to-end duration (enqueue → completed) of one job kind, an exponentially weighted moving average updated
/// by the workers on every completed job. The Api turns it into the poll hint of GET v1/tenant/job/{id}
/// (etaMs / retryAfterMs). Global, no tenant data.
/// </summary>
public class JobStatsEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk();
    [JsonPropertyName("sk")] public string Sk => GetSk(Kind);

    [JsonPropertyName("kind")] public JobKind Kind { get; set; }
    [JsonPropertyName("typicalMs")] public long TypicalMs { get; set; }
    [JsonPropertyName("samples")] public long Samples { get; set; }
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }

    public static string GetPk() => "system#jobstats";
    public static string GetSk(JobKind kind) => kind.ToString();
}
