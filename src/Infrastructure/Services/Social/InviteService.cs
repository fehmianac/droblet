using Domain.Entity;
using Domain.Enum;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Infrastructure.Services.Social;

/// <summary>
/// Brief §5.7: every shared link carries the sharer's invite code; after install the first authenticated call with
/// the code stores the inviter (deferred deep link). Phase 1 pays no reward — this only measures acquisition.
/// </summary>
public sealed class InviteService(
    IRepository repository,
    IAnalyticsService analytics,
    IOptionsMonitor<SocialOptions> options,
    TimeProvider timeProvider,
    ILogger<InviteService> logger) : IInviteService
{
    private const int CodeAttempts = 5;

    private DateTime Now => timeProvider.GetUtcNow().UtcDateTime;

    private static Task<InviteEntity?> OwnAsync(IRepository repository, string tenantId, CancellationToken ct) =>
        repository.GetAsync<InviteEntity>(InviteEntity.GetPk(tenantId), InviteEntity.GetSk(), ct);

    private async Task<string> EnsureCodeAsync(string tenantId, CancellationToken ct)
    {
        for (var attempt = 0; attempt < CodeAttempts; attempt++)
        {
            var own = await OwnAsync(repository, tenantId, ct);
            if (own?.Code is { Length: > 0 } existing)
                return existing;

            var now = Now;
            var code = InviteCodeRules.Generate();
            var invite = own ?? new InviteEntity { TenantId = tenantId };
            invite.Code = code;
            invite.CreatedAt = now;

            var result = await repository.TransactWriteAsync(
            [
                TransactWriteOperation.Create(new InviteCodeEntity { Code = code, OwnerTenantId = tenantId, CreatedAt = now }), // uniqueness
                own is null ? TransactWriteOperation.Create(invite) : TransactWriteOperation.Put(invite),
            ], ct);
            if (result.Applied)
                return code;
            // Code collision or another device created the invite first: re-read and retry.
        }
        throw new InvalidOperationException("Invite code could not be allocated.");
    }

    public async Task<InviteLinkDto> GetLinkAsync(string tenantId, CancellationToken ct)
    {
        var code = await EnsureCodeAsync(tenantId, ct);
        var invited = (await repository.GetKeysAsync(InviteeEntity.GetPk(tenantId), ct)).Count;
        return new InviteLinkDto(code, InviteCodeRules.Link(options.CurrentValue.InviteUrl, code), invited);
    }

    public async Task<ShareDto> RecordShareAsync(
        string tenantId, string shareId, ShareChannel channel, ShareTargetKind targetKind, string? targetId, string? ownerHandle, CancellationToken ct)
    {
        var code = await EnsureCodeAsync(tenantId, ct);
        var handle = string.IsNullOrWhiteSpace(ownerHandle) ? null : HandleRules.Normalize(ownerHandle);
        var url = InviteCodeRules.Link(options.CurrentValue.InviteUrl, code, targetKind, targetId, handle);

        var pk = ShareEntity.GetPk(tenantId);
        if (await repository.GetAsync<ShareEntity>(pk, ShareEntity.GetSk(shareId), ct) is { } existing)
            return new ShareDto(existing.Id, existing.InviteCode, url, existing.Channel); // replay of the same share

        await repository.SaveAsync(new ShareEntity
        {
            Id = shareId, TenantId = tenantId, Channel = channel, TargetKind = targetKind,
            TargetId = string.IsNullOrWhiteSpace(targetId) ? null : targetId, OwnerHandle = handle, InviteCode = code, CreatedAt = Now,
        }, ct);

        await analytics.RecordServerEventAsync(AnalyticsRules.Share, tenantId, new Dictionary<string, string?>
        {
            ["channel"] = channel.ToString().ToLowerInvariant(),
            ["source"] = targetKind.ToString().ToLowerInvariant(),
        }, ct);
        return new ShareDto(shareId, code, url, channel);
    }

    public async Task<InvitePreviewDto?> ResolveAsync(string code, CancellationToken ct)
    {
        if (!InviteCodeRules.IsValid(code))
            return null;
        var entry = await repository.GetAsync<InviteCodeEntity>(InviteCodeEntity.GetPk(), InviteCodeEntity.GetSk(code), ct);
        if (entry is null)
            return null;
        var inviter = await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(entry.OwnerTenantId), ct);
        if (inviter is null)
            return null;
        // Anonymous endpoint: first name only (SECURITY_ENGINEER.md §Davet).
        var firstName = inviter.DisplayName?.Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
        return new InvitePreviewDto(entry.Code, firstName);
    }

    public async Task<InviteOutcome> AttributeAsync(string tenantId, string code, CancellationToken ct)
    {
        var entry = InviteCodeRules.IsValid(code)
            ? await repository.GetAsync<InviteCodeEntity>(InviteCodeEntity.GetPk(), InviteCodeEntity.GetSk(code), ct)
            : null;
        var own = await OwnAsync(repository, tenantId, ct);
        var tenant = await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(tenantId), ct);
        var now = Now;

        var decision = InviteCodeRules.Decide(tenantId, entry?.OwnerTenantId, own?.InvitedByTenantId is not null,
            tenant?.CreatedAt ?? DateTime.MinValue, now, options.CurrentValue.InviteAttributionWindowDays);
        switch (decision)
        {
            case InviteAttributionDecision.CodeNotFound: return InviteOutcome.CodeNotFound;
            case InviteAttributionDecision.Self: return InviteOutcome.Self;
            case InviteAttributionDecision.AlreadyAttributed: return InviteOutcome.AlreadyAttributed;
            case InviteAttributionDecision.WindowClosed: return InviteOutcome.WindowClosed;
        }

        var inviterId = entry!.OwnerTenantId;
        var invite = own ?? new InviteEntity { TenantId = tenantId, CreatedAt = now };
        invite.InvitedByTenantId = inviterId;
        invite.InvitedByCode = entry.Code;
        invite.AttributedAt = now;

        var result = await repository.TransactWriteAsync(
        [
            own is null ? TransactWriteOperation.Create(invite) : TransactWriteOperation.Put(invite),
            TransactWriteOperation.Create(new InviteeEntity { TenantId = inviterId, InviteeTenantId = tenantId, CreatedAt = now }), // once per invitee
        ], ct);
        if (!result.Applied)
            return InviteOutcome.AlreadyAttributed;

        await analytics.RecordServerEventAsync(AnalyticsRules.InvitedInstall, tenantId, new Dictionary<string, string?> { ["source"] = "invite" }, ct);
        logger.LogInformation("Invite attributed: tenant {TenantId} invited by {InviterTenantId}", tenantId, inviterId);
        return InviteOutcome.Attributed;
    }
}
