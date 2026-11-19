using Domain.Entity;
using Domain.Extensions;
using Domain.Manager;
using Domain.Services;

namespace Infrastructure.Services;

/// <summary>Fixed-window counters in DynamoDB (TTL'd). Keys (e-mail, IP) are hashed — never stored or logged raw.</summary>
public sealed class RateLimiter(IRepository repository, TimeProvider timeProvider) : IRateLimiter
{
    /// <summary>A refused attempt still counts (brute-force protection: hammering keeps the window closed).</summary>
    public async Task<bool> TryAcquireAsync(string scope, string key, int limit, TimeSpan window, CancellationToken ct)
    {
        if (limit <= 0)
            return true;
        return await AddAsync(scope, key, window, 1, ct) <= limit;
    }

    /// <summary>Units of a quota (e.g. photos per day): a refused request gives its units back, so a bulk request that does not fit never uses up the rest of the window.</summary>
    public async Task<bool> TryAcquireAsync(string scope, string key, int limit, TimeSpan window, int units, CancellationToken ct)
    {
        if (limit <= 0 || units <= 0)
            return true;
        if (await AddAsync(scope, key, window, units, ct) <= limit)
            return true;
        await AddAsync(scope, key, window, -units, ct);
        return false;
    }

    private Task<long> AddAsync(string scope, string key, TimeSpan window, long amount, CancellationToken ct)
    {
        var now = timeProvider.GetUtcNow().ToUnixTimeSeconds();
        var windowSeconds = (long)window.TotalSeconds;
        var windowStart = now - now % windowSeconds;
        var keyHash = key.Trim().ToLowerInvariant().Sha256Hex();
        return repository.IncrementCounterAsync(
            RateLimitCounterEntity.GetPk(scope, keyHash),
            RateLimitCounterEntity.GetSk(windowStart),
            "count",
            windowStart + windowSeconds + 3600,
            ct,
            amount);
    }
}
