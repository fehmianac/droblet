using System.Text.Json.Serialization;
using Domain.Entity.Base;

namespace Domain.Entity;

public enum MaintenanceRunStatus { Queued, Running, Cancelling, Completed, Cancelled, Failed }

/// <summary>One piece the migration could not publish (kept for "retry failed"; at most MaintenanceRunEntity.MaxFailedItems).</summary>
public sealed class MaintenanceFailedItem
{
    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("itemId")] public string ItemId { get; set; } = null!;
    [JsonPropertyName("reason")] public string Reason { get; set; } = null!;
}

public sealed class MaintenanceItemRef
{
    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("itemId")] public string ItemId { get; set; } = null!;
}

/// <summary>
/// A run of an admin maintenance job ("publish-item-images", docs/images.md §8). Global row (not tenant data: ids and
/// counters only). The worker processes it in batches; <see cref="Cursor"/> and <see cref="Seq"/> make every batch
/// resumable and a redelivered message a no-op. Version-checked writes merge the admin's cancel with the worker's progress.
/// </summary>
public class MaintenanceRunEntity : IVersionedEntity
{
    public const string PublishItemImages = "publish-item-images";
    public const int MaxFailedItems = 100;

    [JsonPropertyName("pk")] public string Pk => GetPk(Kind);
    [JsonPropertyName("sk")] public string Sk => GetSk(Id);

    [JsonPropertyName("id")] public string Id { get; set; } = null!;   // ULID: newest last in the partition
    [JsonPropertyName("kind")] public string Kind { get; set; } = PublishItemImages;
    [JsonPropertyName("dryRun")] public bool DryRun { get; set; }
    [JsonPropertyName("status")] public MaintenanceRunStatus Status { get; set; }

    // Progress. Cursor = the last tenant fully done + the last item done inside the current tenant (ordinal order).
    [JsonPropertyName("seq")] public int Seq { get; set; }
    [JsonPropertyName("cursorTenant")] public string? CursorTenant { get; set; }
    [JsonPropertyName("cursorItem")] public string? CursorItem { get; set; }
    [JsonPropertyName("tenants")] public int Tenants { get; set; }
    [JsonPropertyName("scanned")] public int Scanned { get; set; }
    [JsonPropertyName("published")] public int Published { get; set; }
    [JsonPropertyName("alreadyPublic")] public int AlreadyPublic { get; set; }
    [JsonPropertyName("hidden")] public int Hidden { get; set; }
    [JsonPropertyName("renditionsMade")] public int RenditionsMade { get; set; }
    [JsonPropertyName("failed")] public int Failed { get; set; }
    [JsonPropertyName("skipReasons")] public Dictionary<string, int> SkipReasons { get; set; } = [];
    [JsonPropertyName("failedItems")] public List<MaintenanceFailedItem> FailedItems { get; set; } = [];

    // "Retry failed": only these pieces (in this order), not a scan of every tenant.
    [JsonPropertyName("retryOf")] public string? RetryOf { get; set; }
    [JsonPropertyName("onlyItems")] public List<MaintenanceItemRef>? OnlyItems { get; set; }
    [JsonPropertyName("onlyIndex")] public int OnlyIndex { get; set; }

    [JsonPropertyName("startedById")] public string StartedById { get; set; } = null!;
    [JsonPropertyName("startedByEmail")] public string StartedByEmail { get; set; } = null!;
    [JsonPropertyName("startedAt")] public DateTime StartedAt { get; set; }
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }
    [JsonPropertyName("finishedAt")] public DateTime? FinishedAt { get; set; }
    [JsonPropertyName("cancelRequestedAt")] public DateTime? CancelRequestedAt { get; set; }
    [JsonPropertyName("version")] public long Version { get; set; }

    [JsonIgnore] public bool IsActive => Status is MaintenanceRunStatus.Queued or MaintenanceRunStatus.Running or MaintenanceRunStatus.Cancelling;
    [JsonIgnore] public int Skipped => SkipReasons.Values.Sum();

    public static string GetPk(string kind) => $"maintenance#{kind}";
    public static string GetSk(string id) => $"run#{id}";
}

/// <summary>"One active run at a time": created conditionally with the run, deleted when the run finishes.</summary>
public class MaintenanceLockEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => MaintenanceRunEntity.GetPk(Kind);
    [JsonPropertyName("sk")] public string Sk => GetSk();

    [JsonPropertyName("kind")] public string Kind { get; set; } = MaintenanceRunEntity.PublishItemImages;
    [JsonPropertyName("runId")] public string RunId { get; set; } = null!;
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }

    public static string GetSk() => "active";
}
