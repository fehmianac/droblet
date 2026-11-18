using Domain.Entity;
using Domain.Extensions;
using Domain.Manager;
using Domain.Services;

namespace Infrastructure.Services;

/// <summary>Fixed-window counters in DynamoDB (TTL'd). Keys (e-mail, IP) are hashed — never stored or logged raw.</summary>
public sealed class RateLimiter(IRepository repository, TimeProvider timeProvider) : IRateLimiter
{
    public async Task<bool> TryAcquireAsync(string scope, string key, int limit, TimeSpan window, CancellationToken ct)
    {
        if (limit <= 0)
            return true;

        var now = timeProvider.GetUtcNow().ToUnixTimeSeconds();
        var windowSeconds = (long)window.TotalSeconds;
        var windowStart = now - now % windowSeconds;
        var keyHash = key.Trim().ToLowerInvariant().Sha256Hex();

        var count = await repository.IncrementCounterAsync(
            RateLimitCounterEntity.GetPk(scope, keyHash),
            RateLimitCounterEntity.GetSk(windowStart),
            "count",
            windowStart + windowSeconds + 3600,
            ct);

        return count <= limit;
    }
}
