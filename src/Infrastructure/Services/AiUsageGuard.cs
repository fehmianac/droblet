using Domain.Options;
using Domain.Services;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Infrastructure.Services;

/// <summary>AiLimits: fixed-window counters per tenant (IRateLimiter, DynamoDB, TTL'd). Every cap 0 = off.</summary>
public sealed class AiUsageGuard(IRateLimiter limiter, IOptionsMonitor<AiLimitsOptions> options, ILogger<AiUsageGuard> logger) : IAiUsageGuard
{
    public async Task<bool> AllowAsync(string tenantId, AiCap cap, int units, CancellationToken ct)
    {
        var limits = options.CurrentValue;
        if (units <= 0)
            return true;
        if (!await limiter.TryAcquireAsync("ai-start", tenantId, limits.AiStartsPerMinute, TimeSpan.FromMinutes(1), ct))
        {
            logger.LogWarning("AI start refused for tenant {TenantId}: {Cap} over the per-minute cap {Limit}", tenantId, cap, limits.AiStartsPerMinute);
            return false;
        }
        var (scope, daily) = cap switch
        {
            AiCap.Stylist => ("ai-stylist", limits.StylistJobsPerDay),
            AiCap.ItemRecognition => ("ai-recognition", limits.ItemRecognitionsPerDay),
            AiCap.Palette => ("ai-palette", limits.PaletteAnalysesPerDay),
            _ => ("ai-other", 0),
        };
        if (await limiter.TryAcquireAsync(scope, tenantId, daily, TimeSpan.FromDays(1), units, ct))
            return true;
        logger.LogWarning("AI start refused for tenant {TenantId}: {Cap} over the daily cap {Limit}", tenantId, cap, daily);
        return false;
    }
}
