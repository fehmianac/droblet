using Domain.Entity;
using Domain.Entity.Base;
using Domain.Extensions;
using Domain.Manager;
using Domain.Services;
using Microsoft.Extensions.Logging;

namespace Infrastructure.Services;

/// <summary>
/// Own analytics in DynamoDB (README §9.2 — no third-party SDK). Events are TTL'd (400 days) and carry no personal
/// content. The funnel report reads the day partitions of the requested range. Every event is written twice: the day
/// row (funnel) and a per-actor copy (<see cref="AnalyticsActorEventEntity"/>: data export and account deletion).
/// </summary>
public sealed class AnalyticsService(IRepository repository, TimeProvider timeProvider, ILogger<AnalyticsService> logger) : IAnalyticsService
{
    private DateTime Now => timeProvider.GetUtcNow().UtcDateTime;

    public async Task<AnalyticsBatchResult> RecordBatchAsync(
        string tenantId, IReadOnlyList<AnalyticsEventInput> events, string? platform, string? appVersion, CancellationToken ct)
    {
        var now = Now;
        var rejected = new List<AnalyticsEventRejection>();
        var entities = new List<IEntity>(); // event row + per-actor copy, in pairs

        for (var i = 0; i < events.Count; i++)
        {
            var input = events[i];
            if (input is null)
            {
                rejected.Add(new AnalyticsEventRejection(i, "name_required"));
                continue;
            }
            if (AnalyticsRules.Validate(input, now) is { } code)
            {
                rejected.Add(new AnalyticsEventRejection(i, code));
                continue;
            }

            var props = input.Props?.ToDictionary(p => p.Key, p => p.Value) ?? [];
            if (AnalyticsRules.IsSafeValue(platform)) props.TryAdd("platform", platform);
            if (AnalyticsRules.IsSafeValue(appVersion)) props.TryAdd("appVersion", appVersion);
            var entity = AnalyticsRules.ToEntity(input.Name!, tenantId, input.OccurredAt?.ToUniversalTime() ?? now, now, props, Ulid.New(now));
            entities.Add(AnalyticsRules.ToActorEntity(entity));
            entities.Add(entity);
        }

        if (entities.Count > 0)
            await repository.BatchWriteAsync(entities, ct);
        return new AnalyticsBatchResult(entities.Count / 2, rejected);
    }

    public async Task RecordServerEventAsync(string name, string tenantId, IReadOnlyDictionary<string, string?>? props, CancellationToken ct)
    {
        try
        {
            var now = Now;
            var safe = props?.Where(p => AnalyticsRules.AllowedProps.Contains(p.Key) && AnalyticsRules.IsSafeValue(p.Value))
                .ToDictionary(p => p.Key, p => p.Value);
            var entity = AnalyticsRules.ToEntity(name, tenantId, now, now, safe, Ulid.New(now));
            await repository.BatchWriteAsync([AnalyticsRules.ToActorEntity(entity), entity], ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Analytics must never break the business flow it observes.
            logger.LogWarning(ex, "Analytics event {Event} could not be recorded", name);
        }
    }

    public async Task<FunnelReport> GetFunnelAsync(DateOnly from, DateOnly to, CancellationToken ct)
    {
        var events = new List<AnalyticsEventEntity>();
        for (var day = from; day <= to; day = day.AddDays(1))
            events.AddRange(await repository.GetAllAsync<AnalyticsEventEntity>(AnalyticsEventEntity.GetPk(WeeklyEditRules.Format(day)), ct));
        return AnalyticsRules.BuildFunnel(events, from, to);
    }
}
