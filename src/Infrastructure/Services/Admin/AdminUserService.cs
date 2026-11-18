using Domain.Entity;
using Domain.Enum;
using Domain.Extensions;
using Domain.Manager;
using Domain.Services.Admin;
using Microsoft.Extensions.Logging;

namespace Infrastructure.Services.Admin;

/// <summary>
/// Admin accounts, managed by super admins. Guards: nobody changes their own role / disables / deletes themselves, and
/// the last active super admin cannot be demoted, disabled or deleted (the panel would become unmanageable).
/// </summary>
public sealed class AdminUserService(
    IRepository repository,
    AdminAuthService auth,
    IAuditLog audit,
    TimeProvider timeProvider,
    ILogger<AdminUserService> logger) : IAdminUserService
{
    private DateTime Now => timeProvider.GetUtcNow().UtcDateTime;

    public async Task<IReadOnlyList<AdminUserDto>> ListAsync(CancellationToken ct) =>
        (await repository.GetAllAsync<AdminUserEntity>(AdminUserEntity.GetPk(), ct))
        .OrderBy(a => a.Email, StringComparer.Ordinal)
        .Select(AdminUserDto.From)
        .ToList();

    public async Task<AdminUserResult> CreateAsync(AdminUserEntity actor, string email, string name, AdminRole role, AdminRequestInfo request, CancellationToken ct)
    {
        var now = Now;
        var admin = new AdminUserEntity
        {
            Id = Ulid.New(now),
            Email = AdminAuthService.NormalizeEmail(email),
            Name = name.Trim(),
            Role = role,
            CreatedBy = actor.Id,
            CreatedAt = now,
            UpdatedAt = now,
        };
        var result = await repository.TransactWriteAsync(
        [
            TransactWriteOperation.Create(new AdminEmailIndexEntity { Email = admin.Email, AdminId = admin.Id }),
            TransactWriteOperation.Create(admin),
        ], ct);
        if (result.Outcome == TransactOutcome.ConditionFailed && result.FailedIndex == 0)
            return new AdminUserResult(AdminUserOutcome.EmailTaken);
        if (!result.Applied)
            throw new InvalidOperationException($"Admin user could not be created: {result.Outcome}.");

        await audit.WriteAsync(actor, "admin.create", "admin", admin.Id, null, AdminUserDto.From(admin), request.Ip, ct);
        await TrySendLinkAsync(admin, AdminPasswordTokenPurpose.Invite, request.Language, ct);
        return new AdminUserResult(AdminUserOutcome.Ok, AdminUserDto.From(admin));
    }

    public async Task<AdminUserResult> UpdateAsync(AdminUserEntity actor, string id, string name, AdminRole role, bool disabled, string? ip, CancellationToken ct)
    {
        for (var attempt = 0; attempt < 5; attempt++)
        {
            var admin = await LoadAsync(id, ct);
            if (admin is null)
                return new AdminUserResult(AdminUserOutcome.NotFound);
            if (admin.Id == actor.Id && (role != admin.Role || disabled))
                return new AdminUserResult(AdminUserOutcome.CannotChangeSelf);
            var losesSuperAdmin = admin is { Role: AdminRole.SuperAdmin, Disabled: false } && (role != AdminRole.SuperAdmin || disabled);
            if (losesSuperAdmin && !await HasOtherActiveSuperAdminAsync(admin.Id, ct))
                return new AdminUserResult(AdminUserOutcome.LastSuperAdmin);

            var before = AdminUserDto.From(admin);
            var now = Now;
            if (role != admin.Role || (disabled && !admin.Disabled))
                admin.TokensValidAfter = now; // a role change or disable ends that admin's sessions at once
            admin.Name = name.Trim();
            admin.Role = role;
            admin.Disabled = disabled;
            admin.UpdatedAt = now;
            if (!await repository.SaveIfVersionAsync(admin, admin.Version, ct))
                continue;

            var after = AdminUserDto.From(admin);
            await audit.WriteAsync(actor, "admin.update", "admin", admin.Id, before, after, ip, ct);
            return new AdminUserResult(AdminUserOutcome.Ok, after);
        }
        throw new InvalidOperationException("Admin user could not be updated (too many concurrent writers).");
    }

    public async Task<AdminUserOutcome> InviteAsync(AdminUserEntity actor, string id, AdminRequestInfo request, CancellationToken ct)
    {
        var admin = await LoadAsync(id, ct);
        if (admin is null || admin.Disabled)
            return AdminUserOutcome.NotFound;
        await TrySendLinkAsync(admin, admin.PasswordSet ? AdminPasswordTokenPurpose.Reset : AdminPasswordTokenPurpose.Invite, request.Language, ct);
        await audit.WriteAsync(actor, "admin.invite", "admin", admin.Id, null, null, request.Ip, ct);
        return AdminUserOutcome.Ok;
    }

    public async Task<AdminUserOutcome> RevokeSessionsAsync(AdminUserEntity actor, string id, string? ip, CancellationToken ct)
    {
        if (await LoadAsync(id, ct) is null)
            return AdminUserOutcome.NotFound;
        await auth.RevokeAllAsync(id, ct);
        await audit.WriteAsync(actor, "admin.revoke_sessions", "admin", id, null, null, ip, ct);
        return AdminUserOutcome.Ok;
    }

    public async Task<AdminUserOutcome> DeleteAsync(AdminUserEntity actor, string id, string? ip, CancellationToken ct)
    {
        var admin = await LoadAsync(id, ct);
        if (admin is null)
            return AdminUserOutcome.NotFound;
        if (admin.Id == actor.Id)
            return AdminUserOutcome.CannotChangeSelf;
        if (admin is { Role: AdminRole.SuperAdmin, Disabled: false } && !await HasOtherActiveSuperAdminAsync(admin.Id, ct))
            return AdminUserOutcome.LastSuperAdmin;

        await repository.TransactWriteAsync(
        [
            TransactWriteOperation.Delete(admin.Pk, admin.Sk),
            TransactWriteOperation.Delete(AdminEmailIndexEntity.GetPk(), AdminEmailIndexEntity.GetSk(admin.Email)),
            TransactWriteOperation.Delete(AdminCredentialEntity.GetPk(), AdminCredentialEntity.GetSk(admin.Id)),
        ], ct);
        // Outstanding refresh tokens point to a deleted admin and are refused on use.
        await audit.WriteAsync(actor, "admin.delete", "admin", admin.Id, AdminUserDto.From(admin), null, ip, ct);
        return AdminUserOutcome.Ok;
    }

    private Task<AdminUserEntity?> LoadAsync(string id, CancellationToken ct) =>
        repository.GetAsync<AdminUserEntity>(AdminUserEntity.GetPk(), AdminUserEntity.GetSk(id), ct);

    private async Task<bool> HasOtherActiveSuperAdminAsync(string exceptId, CancellationToken ct) =>
        (await repository.GetAllAsync<AdminUserEntity>(AdminUserEntity.GetPk(), ct))
        .Any(a => a.Id != exceptId && a is { Role: AdminRole.SuperAdmin, Disabled: false });

    private async Task TrySendLinkAsync(AdminUserEntity admin, AdminPasswordTokenPurpose purpose, string language, CancellationToken ct)
    {
        try
        {
            await auth.SendPasswordLinkAsync(admin, purpose, language, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // The account exists; "resend invitation" retries the e-mail.
            logger.LogError(ex, "Admin {Purpose} e-mail failed for admin {AdminId}", purpose, admin.Id);
        }
    }
}
