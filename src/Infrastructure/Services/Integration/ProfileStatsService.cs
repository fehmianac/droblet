using Domain.Domain;
using Domain.Entity;
using Domain.Manager;
using Domain.Services;

namespace Infrastructure.Services.Integration;

public interface IProfileStatsService
{
    Task<ProfileStatsDto> GetAsync(string tenantId, CancellationToken ct);
}

/// <summary>Screen 28 counters of the caller's own account: key-only reads of the caller's partitions (no entity is loaded).</summary>
public sealed class ProfileStatsService(IRepository repository) : IProfileStatsService
{
    public async Task<ProfileStatsDto> GetAsync(string tenantId, CancellationToken ct)
    {
        async Task<int> Count(string pk) => (await repository.GetKeysAsync(pk, ct)).Count;

        return new ProfileStatsDto(
            await Count(ItemEntity.GetPk(tenantId)),
            await Count(LookEntity.GetPk(tenantId)),
            await Count(TripEntity.GetPk(tenantId)),
            await Count(FollowerEntity.GetPk(tenantId)),
            await Count(FollowingEntity.GetPk(tenantId)));
    }
}
