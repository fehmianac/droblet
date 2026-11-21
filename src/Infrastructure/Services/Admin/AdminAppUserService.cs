using Domain.Entity;
using Domain.Enum;
using Domain.Extensions;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Domain.Services.Admin;
using Infrastructure.Services.Integration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Infrastructure.Services.Admin;

/// <summary>
/// App accounts as seen by support / moderation. Deliberately returns no body or face photos, try-on images or
/// wardrobe images — only identity, counters, membership, credits and devices. Every write is audited.
/// </summary>
public sealed class AdminAppUserService(
    IRepository repository,
    IEntitlementService entitlements,
    ICreditService credits,
    IProfileStatsService stats,
    IAccountDeletionService deletion,
    IAuditLog audit,
    ITeenService teens,
    IOptionsMonitor<EntitlementOptions> entitlementOptions,
    TimeProvider timeProvider,
    ILogger<AdminAppUserService> logger) : IAdminAppUserService
{
    public const string TestPremiumId = "admin-test-premium";

    private DateTime Now => timeProvider.GetUtcNow().UtcDateTime;

    public async Task<AdminAppUserPageDto> SearchAsync(string? query, string? pageToken, int limit, CancellationToken ct)
    {
        var q = query?.Trim() ?? "";
        if (q.Length > 0 && pageToken is null)
        {
            var exact = await FindExactAsync(q, ct);
            if (exact is not null)
                return new AdminAppUserPageDto([await SummaryAsync(exact, ct)], null);
        }

        // Newest accounts first; a free-text query filters the page (part of the e-mail or the display name).
        var (users, next, _) = await repository.GetPagedAsync<UserEntity>(UserEntity.GetPk(), pageToken, Math.Clamp(limit, 1, 100), ct);
        var needle = q.TrimStart('@').ToLowerInvariant();
        var matches = users.Where(u => needle.Length == 0
                                       || (u.Email?.Contains(needle, StringComparison.OrdinalIgnoreCase) ?? false)
                                       || (u.DisplayName?.Contains(needle, StringComparison.OrdinalIgnoreCase) ?? false)
                                       || u.Id.Equals(q, StringComparison.Ordinal));
        var items = new List<AdminAppUserSummaryDto>();
        foreach (var user in matches)
            items.Add(await SummaryAsync(user, ct));
        return new AdminAppUserPageDto(items, next);
    }

    private async Task<UserEntity?> FindExactAsync(string q, CancellationToken ct)
    {
        if (q.Contains('@', StringComparison.Ordinal) && !q.StartsWith('@'))
        {
            var identity = await repository.GetAsync<AuthIdentityEntity>(AuthIdentityEntity.GetPk(), AuthIdentityEntity.GetSk(AuthProvider.Email, q), ct);
            if (identity is not null)
                return await GetUserAsync(identity.UserId, ct);
            return (await repository.GetAllAsync<UserEntity>(UserEntity.GetPk(), ct))
                .FirstOrDefault(u => string.Equals(u.Email, q.Trim(), StringComparison.OrdinalIgnoreCase));
        }

        var handle = await repository.GetAsync<HandleEntity>(HandleEntity.GetPk(), HandleEntity.GetSk(HandleRules.Normalize(q)), ct);
        if (handle is not null)
        {
            var tenant = await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(handle.TenantId), ct);
            if (tenant is not null)
                return await GetUserAsync(tenant.OwnerUserId, ct);
        }
        return Ulid.IsValid(q) ? await GetUserAsync(q, ct) : null;
    }

    private async Task<AdminAppUserSummaryDto> SummaryAsync(UserEntity user, CancellationToken ct)
    {
        var tenant = await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(user.TenantId), ct);
        return new AdminAppUserSummaryDto(user.Id, user.TenantId, user.Email, user.DisplayName ?? tenant?.DisplayName, tenant?.Handle, user.CreatedAt, user.SuspendedAt is not null,
            user.AgeBand ?? (user.AgeConfirmedAt is null ? null : AgeBand.Adult));
    }

    public async Task<AdminAppUserDetailDto?> GetAsync(string userId, CancellationToken ct)
    {
        var user = await GetUserAsync(userId, ct);
        return user is null ? null : await DetailAsync(user, ct);
    }

    private async Task<AdminAppUserDetailDto> DetailAsync(UserEntity user, CancellationToken ct)
    {
        var tenant = await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(user.TenantId), ct);
        var counters = await stats.GetAsync(user.TenantId, ct);
        var snapshot = await entitlements.GetAsync(user.TenantId, ct);
        var all = await repository.GetAllAsync<EntitlementEntity>(EntitlementEntity.GetPk(user.TenantId), ct);
        var test = all.FirstOrDefault(e => e is { Source: EntitlementSource.Admin, Id: TestPremiumId } && (e.ExpiresAt is null || e.ExpiresAt > Now));
        var devices = await repository.GetAllAsync<DeviceEntity>(DeviceEntity.GetPk(user.TenantId), ct);
        var recognition = snapshot.ItemRecognition;

        return new AdminAppUserDetailDto(
            user.Id, user.TenantId, user.Email, user.DisplayName ?? tenant?.DisplayName, tenant?.Handle, user.CreatedAt, tenant?.Language, tenant?.ClosetVisibility,
            user.Identities.Select(i => i.Split('#')[0]).Distinct().ToList(),
            user.SuspendedAt is not null, user.SuspendedAt, user.SuspendReason,
            new AdminAppUserCounts(counters.ItemCount, counters.LookCount, counters.TripCount, counters.FollowerCount, counters.FollowingCount),
            new AdminAppUserEntitlement(snapshot.Active.Tier, snapshot.Active.Source?.Source, snapshot.Active.Source?.ExpiresAt, test?.ExpiresAt),
            new AdminAppUserCredits(snapshot.Credits.MonthlyAllowance, snapshot.Credits.AllowanceRemaining, snapshot.Credits.PackRemaining),
            new AdminAppUserRecognition(recognition?.Used ?? 0, recognition?.Limit ?? entitlementOptions.CurrentValue.Free.ItemRecognitionLimit, recognition?.Unlimited ?? false),
            devices.OrderByDescending(d => d.UpdatedAt).Select(d => new AdminAppUserDevice(d.DeviceId, d.Platform, d.UpdatedAt, !string.IsNullOrEmpty(d.PushToken))).ToList(),
            user.AgeBand ?? (user.AgeConfirmedAt is null ? null : AgeBand.Adult),
            await teens.AdminAsync(user.TenantId, ct));
    }

    public async Task<AdminAppUserDetailDto?> SuspendAsync(AdminUserEntity actor, string userId, string reason, string? ip, CancellationToken ct)
    {
        var user = await GetUserAsync(userId, ct);
        if (user is null)
            return null;
        await SuspendUserAsync(actor, user, reason, ip, ct);
        return await DetailAsync(user, ct);
    }

    public async Task<bool> SuspendTenantOwnerAsync(AdminUserEntity actor, string tenantId, string reason, string? ip, CancellationToken ct)
    {
        var tenant = await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(tenantId), ct);
        var user = tenant is null ? null : await GetUserAsync(tenant.OwnerUserId, ct);
        if (user is null)
            return false;
        await SuspendUserAsync(actor, user, reason, ip, ct);
        return true;
    }

    private async Task SuspendUserAsync(AdminUserEntity actor, UserEntity user, string reason, string? ip, CancellationToken ct)
    {
        var before = new { suspendedAt = user.SuspendedAt, suspendReason = user.SuspendReason };
        var now = Now;
        user.SuspendedAt ??= now;
        user.SuspendReason = reason.Trim();
        user.TokensValidAfter = now; // refresh tokens die now; access tokens within their lifetime
        await repository.SaveAsync(user, ct);
        await audit.WriteAsync(actor, "user.suspend", "user", user.Id, before, new { suspendedAt = user.SuspendedAt, suspendReason = user.SuspendReason }, ip, ct);
        logger.LogInformation("User {UserId} suspended by admin {AdminId}", user.Id, actor.Id);
    }

    public async Task<AdminAppUserDetailDto?> UnsuspendAsync(AdminUserEntity actor, string userId, string? ip, CancellationToken ct)
    {
        var user = await GetUserAsync(userId, ct);
        if (user is null)
            return null;
        var before = new { suspendedAt = user.SuspendedAt, suspendReason = user.SuspendReason };
        user.SuspendedAt = null;
        user.SuspendReason = null;
        await repository.SaveAsync(user, ct);
        await audit.WriteAsync(actor, "user.unsuspend", "user", user.Id, before, new { suspendedAt = (DateTime?)null }, ip, ct);
        return await DetailAsync(user, ct);
    }

    public async Task<bool> DeleteAsync(AdminUserEntity actor, string userId, string? ip, CancellationToken ct)
    {
        var user = await GetUserAsync(userId, ct);
        if (user is null)
            return false;
        var before = await SummaryAsync(user, ct);
        await deletion.DeleteAccountAsync(user.Id, user.TenantId, ct);
        await audit.WriteAsync(actor, "user.delete", "user", user.Id, before, null, ip, ct);
        logger.LogInformation("User {UserId} deleted by admin {AdminId}", user.Id, actor.Id);
        return true;
    }

    public async Task<AdminAppUserDetailDto?> GrantTestPremiumAsync(AdminUserEntity actor, string userId, int days, string? note, string? ip, CancellationToken ct)
    {
        var user = await GetUserAsync(userId, ct);
        if (user is null)
            return null;
        var now = Now;
        var grant = new EntitlementEntity
        {
            Id = TestPremiumId,
            TenantId = user.TenantId,
            Tier = Tier.Premium,
            Source = EntitlementSource.Admin,
            ProductId = TestPremiumId,
            StartsAt = now,
            ExpiresAt = now.AddDays(days),
            PeriodAnchor = now,
            UpdatedAt = now,
        };
        await repository.SaveAsync(grant, ct);
        await audit.WriteAsync(actor, "user.test_premium_grant", "user", user.Id, null, new { test = true, days, expiresAt = grant.ExpiresAt, note }, ip, ct);
        return await DetailAsync(user, ct);
    }

    public async Task<AdminAppUserDetailDto?> RevokeTestPremiumAsync(AdminUserEntity actor, string userId, string? ip, CancellationToken ct)
    {
        var user = await GetUserAsync(userId, ct);
        if (user is null)
            return null;
        await repository.DeleteAsync(EntitlementEntity.GetPk(user.TenantId), EntitlementEntity.GetSk(EntitlementSource.Admin, TestPremiumId), ct);
        await audit.WriteAsync(actor, "user.test_premium_revoke", "user", user.Id, null, new { test = true }, ip, ct);
        return await DetailAsync(user, ct);
    }

    public async Task<AdminAppUserDetailDto?> AddCreditsAsync(AdminUserEntity actor, string userId, int amount, string? note, string? ip, CancellationToken ct)
    {
        var user = await GetUserAsync(userId, ct);
        if (user is null)
            return null;
        var reference = $"admin-test#{Ulid.New(Now)}";
        await credits.AddPackCreditsAsync(user.TenantId, amount, reference, ct);
        await audit.WriteAsync(actor, "user.credits_add", "user", user.Id, null, new { test = true, credits = amount, reference, note }, ip, ct);
        return await DetailAsync(user, ct);
    }

    private Task<UserEntity?> GetUserAsync(string userId, CancellationToken ct) =>
        repository.GetAsync<UserEntity>(UserEntity.GetPk(), UserEntity.GetSk(userId), ct);
}
