using System.Collections.Concurrent;
using Domain.Entity;
using Domain.Enum;
using Domain.Manager;
using Domain.Services;

namespace Infrastructure.Services;

/// <summary>
/// Reads JobStatsEntity at most once a minute per kind and Lambda instance, so a poll costs no extra DynamoDB read
/// most of the time. A failed read answers "unknown" (the client then polls on its own schedule).
/// </summary>
public sealed class JobEtaProvider(IRepository repository, TimeProvider timeProvider) : IJobEtaProvider
{
    private static readonly TimeSpan CacheFor = TimeSpan.FromSeconds(60);
    private readonly ConcurrentDictionary<JobKind, (long? TypicalMs, DateTimeOffset ReadAt)> _cache = new();

    public async Task<long?> TypicalMsAsync(JobKind kind, CancellationToken ct)
    {
        var now = timeProvider.GetUtcNow();
        if (_cache.TryGetValue(kind, out var cached) && now - cached.ReadAt < CacheFor)
            return cached.TypicalMs;

        long? typical;
        try
        {
            var stats = await repository.GetAsync<JobStatsEntity>(JobStatsEntity.GetPk(), JobStatsEntity.GetSk(kind), ct);
            typical = stats is { TypicalMs: > 0 } ? stats.TypicalMs : null;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            typical = null;
        }
        _cache[kind] = (typical, now);
        return typical;
    }
}
