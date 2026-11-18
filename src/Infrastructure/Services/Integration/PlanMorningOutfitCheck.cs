using Domain.Entity;
using Domain.Manager;
using Domain.Services;

namespace Infrastructure.Services.Integration;

/// <summary>
/// "Bugünün kombinin hazır" reminder gate: the user's local calendar day has a planned look, and that look still
/// exists with at least one piece. A day that only carries an occasion (no look) does not qualify.
/// Only the tenant's own PlanDay / Look partitions are read.
/// </summary>
public sealed class PlanMorningOutfitCheck(IRepository repository) : IMorningOutfitCheck
{
    public async Task<bool> HasOutfitForTodayAsync(string tenantId, string localDay, CancellationToken ct)
    {
        if (!CalendarDay.IsValid(localDay))
            return false;
        var day = await repository.GetAsync<PlanDayEntity>(PlanDayEntity.GetPk(tenantId), PlanDayEntity.GetSk(localDay), ct);
        if (string.IsNullOrEmpty(day?.LookId))
            return false;
        var look = await repository.GetAsync<LookEntity>(LookEntity.GetPk(tenantId), LookEntity.GetSk(day.LookId), ct);
        return look is { Slots.Count: > 0 };
    }
}
