using System.Text.Json;
using Domain.Entity;
using Domain.Entity.Base;
using Domain.Enum;
using Domain.Manager;
using Domain.Services;
using Microsoft.Extensions.Logging;

namespace Infrastructure.Services.Social;

/// <summary>
/// <see cref="IContentModeration"/> on the single table. The flag lives on the target row itself (look / item / tenant), so
/// every reader that already loads the row sees it — no extra index, nothing cached. Flag writes are versioned: an owner
/// edit made on a copy read before the flag fails with 409 instead of silently dropping it, and a moderation write retries
/// on top of a concurrent owner edit.
/// </summary>
public sealed class ContentModerationService(
    IRepository repository,
    INotificationInbox inbox,
    IItemImagePublisher itemImages,
    TimeProvider timeProvider,
    ILogger<ContentModerationService> logger) : IContentModeration
{
    private const int Retries = 5;

    private DateTime Now => timeProvider.GetUtcNow().UtcDateTime;

    public async Task<ContentModerationResult> RemoveAsync(string reportId, CancellationToken ct)
    {
        var (report, refusal) = await ResolvedContentRemovedAsync(reportId, ct);
        if (report is null)
            return new ContentModerationResult(refusal);
        // Once per report: a repeated resolve call, or one after an admin restore, never hides the target again.
        if (report.ContentRemovedAt is not null || report.ContentRestoredAt is not null)
            return new ContentModerationResult(ContentModerationOutcome.Unchanged);

        var now = Now;
        var result = await ChangeAsync(report, hide: true, now, ct);
        // Hidden by this report (now, or by an earlier call that stopped before the stamp): tell the owner once. Content an
        // earlier report already removed does not notify twice.
        if (result.Outcome == ContentModerationOutcome.Applied || (result.Outcome == ContentModerationOutcome.Unchanged && result.Before?.ReportId == report.Id))
            await NotifyOwnerAsync(report, now, ct);

        // Stamped last: a crash before this line lets the next call finish the job (flag write and inbox row are idempotent).
        report.ContentRemovedAt = now;
        await repository.SaveAsync(report, ct);
        logger.LogInformation("Report {ReportId}: content removal of {Kind} {TargetId} of {TenantId} → {Outcome}",
            report.Id, report.TargetKind, report.TargetId, report.TargetTenantId, result.Outcome);
        return result;
    }

    public async Task<ContentModerationResult> RestoreAsync(string reportId, string adminUserId, CancellationToken ct)
    {
        var (report, refusal) = await ResolvedContentRemovedAsync(reportId, ct);
        if (report is null)
            return new ContentModerationResult(refusal);

        var now = Now;
        var result = await ChangeAsync(report, hide: false, now, ct);
        if (report.ContentRestoredAt is null)
        {
            report.ContentRestoredAt = now;
            report.ContentRestoredByUserId = adminUserId;
            await repository.SaveAsync(report, ct);
        }
        logger.LogInformation("Report {ReportId}: content restore of {Kind} {TargetId} of {TenantId} by admin {UserId} → {Outcome}",
            report.Id, report.TargetKind, report.TargetId, report.TargetTenantId, adminUserId, result.Outcome);
        return result;
    }

    private async Task<(ReportEntity? Report, ContentModerationOutcome Refusal)> ResolvedContentRemovedAsync(string reportId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(reportId))
            return (null, ContentModerationOutcome.ReportNotFound);
        var report = await repository.GetAsync<ReportEntity>(ReportEntity.GetPk(ReportStatus.Resolved), ReportEntity.GetSk(reportId), ct);
        if (report is null)
        {
            var open = await repository.GetAsync<ReportEntity>(ReportEntity.GetPk(ReportStatus.Open), ReportEntity.GetSk(reportId), ct);
            return (null, open is null ? ContentModerationOutcome.ReportNotFound : ContentModerationOutcome.ReportNotResolved);
        }
        return report.Resolution == ReportResolution.ContentRemoved
            ? (report, ContentModerationOutcome.Applied)
            : (null, ContentModerationOutcome.NotContentRemoved);
    }

    private async Task<ContentModerationResult> ChangeAsync(ReportEntity report, bool hide, DateTime now, CancellationToken ct)
    {
        for (var attempt = 0; attempt < Retries; attempt++)
        {
            var target = await LoadAsync(report, ct);
            if (target is null)
            {
                var missing = Snapshot(report, null);
                return new ContentModerationResult(ContentModerationOutcome.TargetMissing, missing, missing);
            }

            var before = Snapshot(report, target);
            if (target.IsModerationHidden() == hide)
                return new ContentModerationResult(ContentModerationOutcome.Unchanged, before, before);

            target.ModerationHiddenAt = hide ? now : null;
            target.ModerationReportId = hide ? report.Id : null;
            target.ModerationReason = hide ? report.Reason : null;

            // A piece's public image (docs/images.md): hiding removes it for everyone (new keys on restore, so no cache
            // can serve the old URL again); restoring publishes a fresh copy. The owner keeps the presigned private image.
            IReadOnlyList<string> unpublish = [];
            PublishedItemImage? published = null;
            if (target is ItemEntity item)
            {
                if (hide)
                {
                    unpublish = item.PublicImageKeys();
                    item.SetPublicImage(null);
                }
                else
                {
                    unpublish = item.PublicImageKeys(); // stale keys of an earlier publication, if any
                    published = await itemImages.PublishAsync(item, ct);
                    item.SetPublicImage(published);
                }
            }

            if (await repository.SaveIfVersionAsync(target, target.Version, ct))
            {
                if (target is ItemEntity saved)
                    await itemImages.UnpublishAsync(saved.TenantId, unpublish, ct);
                return new ContentModerationResult(ContentModerationOutcome.Applied, before, Snapshot(report, target));
            }
            if (published is not null && target is ItemEntity lost)
                await itemImages.UnpublishAsync(lost.TenantId, published.Keys, ct); // the write lost a race: copies of nothing
        }
        throw new InvalidOperationException($"Moderation flag of report {report.Id} could not be written after retries.");
    }

    private async Task<IModeratedEntity?> LoadAsync(ReportEntity report, CancellationToken ct) => report.TargetKind switch
    {
        ReportTargetKind.Profile => await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(report.TargetTenantId), ct),
        ReportTargetKind.Look when !string.IsNullOrWhiteSpace(report.TargetId) =>
            await repository.GetAsync<LookEntity>(LookEntity.GetPk(report.TargetTenantId), LookEntity.GetSk(report.TargetId), ct),
        ReportTargetKind.Item when !string.IsNullOrWhiteSpace(report.TargetId) =>
            await repository.GetAsync<ItemEntity>(ItemEntity.GetPk(report.TargetTenantId), ItemEntity.GetSk(report.TargetId), ct),
        _ => null,
    };

    private static ModerationTargetSnapshot Snapshot(ReportEntity report, IModeratedEntity? target) => new(
        report.TargetKind,
        report.TargetTenantId,
        report.TargetKind == ReportTargetKind.Profile ? null : report.TargetId,
        Exists: target is not null,
        Hidden: target?.IsModerationHidden() ?? false,
        target?.ModerationHiddenAt,
        target?.ModerationReportId);

    /// <summary>Inbox only (never pushed), once per report: ids and codes only — the app phrases it (NotificationTexts has the TR / EN text).</summary>
    private async Task NotifyOwnerAsync(ReportEntity report, DateTime now, CancellationToken ct)
    {
        var data = new Dictionary<string, string>
        {
            ["targetKind"] = JsonNamingPolicy.CamelCase.ConvertName(report.TargetKind.ToString()),
            ["reason"] = JsonNamingPolicy.CamelCase.ConvertName(report.Reason.ToString()),
        };
        if (report.TargetKind != ReportTargetKind.Profile && !string.IsNullOrWhiteSpace(report.TargetId))
            data["targetId"] = report.TargetId;
        await inbox.AddAsync(report.TargetTenantId, NotificationType.ContentRemoved, report.Id, data, now, ct);
    }
}
