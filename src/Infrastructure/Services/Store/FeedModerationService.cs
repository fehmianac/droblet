using Domain.Domain;
using Domain.Entity;
using Domain.Entity.Base;
using Domain.Enum;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Infrastructure.Services.Store;

/// <summary>
/// Akış F2, admin moderation of the shared looks (owner decision 21): the list of reported / auto-hidden posts and the two
/// decisions. Nothing new is invented for the decisions themselves — a restore dismisses the look's open reports, a remove
/// resolves them as contentRemoved and hands the look to the existing <see cref="IContentModeration"/> (the owner keeps it
/// with moderation { hidden, reason } and gets the content_removed inbox row; the report's POST …/restore undoes it).
/// </summary>
public sealed class FeedModerationService(
    IRepository repository,
    IFeedShareService shares,
    ISocialService social,
    IContentModeration moderation,
    IObjectStorage storage,
    IOptionsMonitor<PhotoOptions> photoOptions,
    TimeProvider timeProvider,
    ILogger<FeedModerationService> logger) : IFeedModeration
{
    private const int Retries = 5;

    private DateTime Now => timeProvider.GetUtcNow().UtcDateTime;

    public async Task<IReadOnlyList<AdminFeedUserPostDto>> ListAsync(CancellationToken ct)
    {
        var posts = (await repository.GetAllAsync<FeedUserPostEntity>(FeedUserPostEntity.GetPk(), ct))
            .Where(p => p.HiddenAt is not null || p.ReportCount > 0)
            .ToList();
        var result = new List<AdminFeedUserPostDto>(posts.Count);
        foreach (var post in posts)
            result.Add(await ToDtoAsync(post, ct));
        // Teen-involved first (moderation priority), then the auto-hidden ones, most reported and newest first.
        return result
            .OrderByDescending(p => p.InvolvesTeen).ThenByDescending(p => p.HiddenAt is not null).ThenByDescending(p => p.ReporterCount)
            .ThenByDescending(p => p.SharedAt).ThenBy(p => p.Id, StringComparer.Ordinal)
            .ToList();
    }

    public async Task<AdminFeedUserPostDto?> GetAsync(string postId, CancellationToken ct) =>
        await PostAsync(postId, ct) is { } post ? await ToDtoAsync(post, ct) : null;

    public async Task<FeedModerationOutcome> RestoreAsync(string postId, string adminUserId, string? note, CancellationToken ct)
    {
        if (await PostAsync(postId, ct) is not { } post)
            return FeedModerationOutcome.NotFound;

        // Dismissed reports no longer count: the next ContentFeed:ReportsToAutoHide reporters start from zero.
        foreach (var report in await shares.OpenReportsAsync(post.OwnerTenantId, post.LookId, ct))
            await social.ResolveReportAsync(report.Id, ReportResolution.Dismissed, note, adminUserId, ct);

        var now = Now;
        await UpdateAsync(postId, p =>
        {
            p.HiddenAt = null;
            p.ReportCount = 0;
            p.RestoredAt = now;
            p.RestoredByUserId = adminUserId;
            p.UpdatedAt = now;
        }, ct);
        logger.LogInformation("Feed post {PostId} of tenant {TenantId} restored to the feed by admin {UserId}", postId, post.OwnerTenantId, adminUserId);
        return FeedModerationOutcome.Ok;
    }

    public async Task<(FeedModerationOutcome Outcome, string? ReportId, ContentModerationResult? Removal)> RemoveAsync(
        string postId, string adminUserId, string? note, CancellationToken ct)
    {
        if (await PostAsync(postId, ct) is not { } post)
            return (FeedModerationOutcome.NotFound, null, null);
        var open = await shares.OpenReportsAsync(post.OwnerTenantId, post.LookId, ct);
        if (open.Count == 0)
            return (FeedModerationOutcome.NotReported, null, null);

        foreach (var report in open)
            await social.ResolveReportAsync(report.Id, ReportResolution.ContentRemoved, note, adminUserId, ct);
        // Recorded on the first report: the look gets its moderation flag once (the others find it already hidden).
        var removal = await moderation.RemoveAsync(open[0].Id, ct);

        var now = Now;
        await UpdateAsync(postId, p =>
        {
            // From here the look's own moderation flag keeps it out of the feed — and an admin restore of that report brings it back.
            p.HiddenAt = null;
            p.ReportCount = 0;
            p.RemovedAt = now;
            p.RemovedByUserId = adminUserId;
            p.UpdatedAt = now;
        }, ct);
        logger.LogInformation("Feed post {PostId} of tenant {TenantId} removed by admin {UserId} (report {ReportId})", postId, post.OwnerTenantId, adminUserId, open[0].Id);
        return (FeedModerationOutcome.Ok, open[0].Id, removal);
    }

    private async Task<FeedUserPostEntity?> PostAsync(string postId, CancellationToken ct) =>
        FeedRules.IsUserPostId(postId)
            ? await repository.GetAsync<FeedUserPostEntity>(FeedUserPostEntity.GetPk(), FeedUserPostEntity.GetSk(postId), ct)
            : null;

    private async Task UpdateAsync(string postId, Action<FeedUserPostEntity> change, CancellationToken ct)
    {
        for (var attempt = 0; attempt < Retries; attempt++)
        {
            if (await PostAsync(postId, ct) is not { } post)
                return;   // un-shared meanwhile
            change(post);
            if (await repository.SaveIfVersionAsync(post, post.Version, ct))
                return;
        }
        throw new InvalidOperationException($"Feed post {postId} could not be updated after retries.");
    }

    private async Task<AdminFeedUserPostDto> ToDtoAsync(FeedUserPostEntity post, CancellationToken ct)
    {
        var owner = await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(post.OwnerTenantId), ct);
        var look = await repository.GetAsync<LookEntity>(LookEntity.GetPk(post.OwnerTenantId), LookEntity.GetSk(post.LookId), ct);
        var cover = await repository.GetAsync<LookCoverEntity>(LookCoverEntity.GetPk(post.OwnerTenantId), LookCoverEntity.GetSk(post.LookId), ct);
        var stats = await repository.GetAsync<FeedPostStatsEntity>(FeedPostStatsEntity.GetPk(), FeedPostStatsEntity.GetSk(post.Id), ct);
        var open = await shares.OpenReportsAsync(post.OwnerTenantId, post.LookId, ct);

        var teen = owner?.IsTeen == true;
        var reports = new List<AdminFeedReportDto>(open.Count);
        foreach (var report in open)
        {
            var reporter = report.ReporterTenantId is null
                ? null
                : await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(report.ReporterTenantId), ct);
            teen |= reporter?.IsTeen == true;
            reports.Add(new AdminFeedReportDto(report.Id, report.Status, report.Reason, report.Note, report.ReporterTenantId, reporter?.Handle, report.CreatedAt));
        }

        // The moderator sees what the feed showed: the cover of the look's current pieces (short-lived presigned GET).
        string? imageUrl = null;
        if (look is not null && LookCoverRules.ReadyImageKey(cover, LookCoverRules.SlotsHash(look.Slots)) is { } key && StorageKeys.BelongsToTenant(key, post.OwnerTenantId))
            imageUrl = await storage.CreateReadUrlAsync(key, TimeSpan.FromSeconds(photoOptions.CurrentValue.ReadUrlTtlSeconds), ct);

        return new AdminFeedUserPostDto(
            post.Id, post.OwnerTenantId, owner?.Handle, post.LookId, look?.Name, look?.Occasion, imageUrl, post.SharedAt,
            post.HiddenAt is not null ? "autoHidden" : "reported",
            FeedRules.DistinctReporters(open),
            open.GroupBy(r => r.Reason).Select(g => new AdminFeedReasonCountDto(g.Key, g.Count())).OrderByDescending(r => r.Count).ThenBy(r => r.Reason).ToList(),
            reports, post.HiddenAt, post.RestoredAt, Math.Max(0, stats?.LikeCount ?? 0), teen);
    }
}
