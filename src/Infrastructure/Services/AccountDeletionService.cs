using Domain.Entity;
using Domain.Manager;
using Domain.Services;
using Microsoft.Extensions.Logging;

namespace Infrastructure.Services;

/// <summary>
/// "Hesabımı sil": every tenant partition (DeletionPlan), the tenant's S3 prefixes, then global records
/// (handle, identities, credential, tenant, user). Global records go last so a failed run can be retried.
/// Refresh tokens become unusable once the user record is gone and expire by TTL.
/// Cross-tenant edges and global indexes (follows, ratings, blocks, reports, invite, watch list, click linkage) are
/// removed first by <see cref="ICrossTenantCleanup"/> — the tenant partitions are their only index.
/// </summary>
public sealed class AccountDeletionService(
    IRepository repository,
    IObjectStorage storage,
    ICrossTenantCleanup crossTenantCleanup,
    ILogger<AccountDeletionService> logger) : IAccountDeletionService
{
    public async Task DeleteAccountAsync(string userId, string tenantId, CancellationToken ct)
    {
        await crossTenantCleanup.CleanAsync(tenantId, ct);

        foreach (var prefix in DeletionPlan.AccountS3Prefixes(tenantId))
            await storage.DeletePrefixAsync(prefix, ct);

        foreach (var pk in DeletionPlan.TenantPartitionKeys(tenantId))
        {
            var keys = await repository.GetKeysAsync(pk, ct);
            if (keys.Count > 0)
                await repository.BatchDeleteKeysAsync(keys, ct);
        }

        var user = await repository.GetAsync<UserEntity>(UserEntity.GetPk(), UserEntity.GetSk(userId), ct);
        var tenant = await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(tenantId), ct);

        var globals = new List<(string, string)>
        {
            (CredentialEntity.GetPk(), CredentialEntity.GetSk(userId)),
            (UserTenantIndexEntity.GetPk(userId), UserTenantIndexEntity.GetSk(tenantId)),
            (TenantEntity.GetPk(), TenantEntity.GetSk(tenantId)),
            (EmailVerificationEntity.GetPk(), EmailVerificationEntity.GetSk(userId)),
        };
        if (tenant?.Handle is { Length: > 0 } handle)
            globals.Add((HandleEntity.GetPk(), HandleEntity.GetSk(handle)));
        if (user is not null)
            globals.AddRange(user.Identities.Select(sk => (AuthIdentityEntity.GetPk(), sk)));

        await repository.BatchDeleteKeysAsync(globals, ct);
        await repository.DeleteAsync(UserEntity.GetPk(), UserEntity.GetSk(userId), ct);

        logger.LogInformation("Account deleted for user {UserId} tenant {TenantId}", userId, tenantId);
    }
}
