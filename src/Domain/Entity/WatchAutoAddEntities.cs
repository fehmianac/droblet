using System.Globalization;
using System.Text.Json.Serialization;
using Domain.Entity.Base;
using Domain.Extensions;

namespace Domain.Entity;

/// <summary>
/// Decision 10: a checkout click waiting for its conversion. Bucketed by the UTC hour it falls due
/// (click + Catalog:WatchAutoAddHours); the Notifier's 15-minute pass reads the due buckets and, when no conversion
/// came, puts the clicked products on the watch list. Ids only. TTL 7 days after it falls due.
/// </summary>
public class WatchAutoAddCandidateEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(DueAt);
    [JsonPropertyName("sk")] public string Sk => GetSk(TenantId, ClickId);

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("clickId")] public string ClickId { get; set; } = null!;
    [JsonPropertyName("productIds")] public List<string> ProductIds { get; set; } = [];
    [JsonPropertyName("clickedAt")] public DateTime ClickedAt { get; set; }
    [JsonPropertyName("dueAt")] public DateTime DueAt { get; set; }
    [JsonPropertyName("ttl")] public long Ttl => DueAt.AddDays(7).ToUnixTimeSeconds();

    public static string GetPk(DateTime dueAt) => $"watchauto#{dueAt.ToString("yyyy-MM-dd'T'HH", CultureInfo.InvariantCulture)}";
    public static string GetSk(string tenantId, string clickId) => $"{tenantId}#{clickId}";
}

/// <summary>
/// The user took a product off the watch list: the auto-add pass must not put it back for a click made before that.
/// TTL 30 days (longer than any auto-add window).
/// </summary>
public class WatchRemovedEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(ProductId);

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("productId")] public string ProductId { get; set; } = null!;
    [JsonPropertyName("removedAt")] public DateTime RemovedAt { get; set; }
    [JsonPropertyName("ttl")] public long Ttl => RemovedAt.AddDays(30).ToUnixTimeSeconds();

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#watchremoved";
    public static string GetSk(string productId) => productId;
}
