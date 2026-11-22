using Domain.Entity;
using Domain.Enum;
using Domain.Manager;
using Domain.Services;
using Microsoft.Extensions.Logging;

namespace Infrastructure.Services.Social;

/// <summary>
/// "Hesabımı sil", the part outside the account's own partitions (BACKEND_ENGINEER.md rule 22). Runs BEFORE the tenant
/// partitions are deleted, because they are the only index of what the account left elsewhere:
/// follow edges, Akış likes (counter correction), ratings given (with summary correction) and received, saved looks (both directions), blocks, reports, invite code and edges,
/// watcher index, public profile index, notification send lists, and the tenant id on clicks / conversions
/// (revenue rows stay, without the person). Every step is idempotent — a failed deletion can be retried.
/// </summary>
public sealed class CrossTenantCleanup(IRepository repository, IFeedShareService feedShares, TimeProvider timeProvider, ILogger<CrossTenantCleanup> logger) : ICrossTenantCleanup
{
    private const int SummaryRetries = 5;

    public async Task CleanAsync(string tenantId, CancellationToken ct)
    {
        var keys = new List<(string Pk, string Sk)>();

        // Follow edges: my followees' Follower rows, my followers' Following rows.
        foreach (var f in await repository.GetAllAsync<FollowingEntity>(FollowingEntity.GetPk(tenantId), ct))
        {
            keys.Add((FollowerEntity.GetPk(f.FolloweeTenantId), FollowerEntity.GetSk(tenantId)));
            // The "new follow request" inbox row I left in their inbox (it carries my handle).
            keys.Add((NotificationInboxEntity.GetPk(f.FolloweeTenantId), NotificationInboxEntity.GetSk(NotificationType.FollowRequest, tenantId)));
        }
        foreach (var f in await repository.GetAllAsync<FollowerEntity>(FollowerEntity.GetPk(tenantId), ct))
            keys.Add((FollowingEntity.GetPk(f.FollowerTenantId), FollowingEntity.GetSk(tenantId)));

        // Follow requests (decision 8): mine in the targets' partitions, and the requesters' pointers to me.
        foreach (var r in await repository.GetAllAsync<FollowRequestEntity>(FollowRequestEntity.GetPk(tenantId), ct))
        {
            keys.Add((FollowRequestReceivedEntity.GetPk(r.TargetTenantId), FollowRequestReceivedEntity.GetSk(tenantId)));
            keys.Add((NotificationQueueEntity.GetPk(NotificationType.FollowRequest), NotificationQueueEntity.GetSk(r.TargetTenantId, tenantId)));
            keys.Add((NotificationInboxEntity.GetPk(r.TargetTenantId), NotificationInboxEntity.GetSk(NotificationType.FollowRequest, tenantId)));
        }
        foreach (var r in await repository.GetAllAsync<FollowRequestReceivedEntity>(FollowRequestReceivedEntity.GetPk(tenantId), ct))
            keys.Add((FollowRequestEntity.GetPk(r.RequesterTenantId), FollowRequestEntity.GetSk(tenantId)));

        // Contact-matching directory rows (decision 13).
        foreach (var d in await repository.GetAllAsync<ContactDirectoryPointerEntity>(ContactDirectoryPointerEntity.GetPk(tenantId), ct))
            keys.Add((ContactDirectoryEntity.GetPk(d.Prefix), ContactDirectoryEntity.GetSk(tenantId, d.Hash)));

        // Push outbox rows addressed to me.
        foreach (var type in Enum.GetValues<NotificationType>())
        {
            foreach (var row in await repository.GetAllAsync<NotificationQueueEntity>(NotificationQueueEntity.GetPk(type), $"{tenantId}#", SkOperator.BeginsWith, ct))
                keys.Add((row.Pk, row.Sk));
        }

        // Akış F2, as an owner: the looks I shared leave the feed with everything other people left on them.
        await feedShares.RemoveAllAsync(tenantId, ct);

        // Akış likes: take each one back off the post's counter (the like rows go with it). On a shared look (F2) also my
        // row in its reaction index and the owner's digest marker.
        var feedNow = timeProvider.GetUtcNow().UtcDateTime;
        foreach (var like in await repository.GetAllAsync<FeedLikeEntity>(FeedLikeEntity.GetPk(tenantId), ct))
        {
            var userPost = FeedRules.IsUserPostId(like.PostId)
                ? await repository.GetAsync<FeedUserPostEntity>(FeedUserPostEntity.GetPk(), FeedUserPostEntity.GetSk(like.PostId), ct)
                : null;
            await Store.FeedLikeCounter.UnlikeAsync(repository, tenantId, like.PostId, feedNow, SummaryRetries, ct, userPost);
        }
        // Saves of shared looks are counted (the owner's feedStats); hides and report pointers leave the posts' reaction index.
        foreach (var save in await repository.GetAllAsync<FeedSaveEntity>(FeedSaveEntity.GetPk(tenantId), ct))
        {
            if (FeedRules.IsUserPostId(save.PostId))
                await Store.FeedLikeCounter.UnsaveAsync(repository, tenantId, save.PostId, feedNow, SummaryRetries, ct);
        }
        foreach (var hide in await repository.GetAllAsync<FeedHideEntity>(FeedHideEntity.GetPk(tenantId), ct))
            keys.Add((FeedPostReactionEntity.GetPk(hide.PostId), FeedPostReactionEntity.GetSk(FeedReactionKind.Hide, tenantId)));
        foreach (var report in await repository.GetAllAsync<FeedReportEntity>(FeedReportEntity.GetPk(tenantId), ct))
            keys.Add((FeedPostReactionEntity.GetPk(report.PostId), FeedPostReactionEntity.GetSk(FeedReactionKind.Report, tenantId)));

        // Ratings I gave: remove from the owner's partition and correct the average.
        foreach (var given in await repository.GetAllAsync<RatingGivenEntity>(RatingGivenEntity.GetPk(tenantId), ct))
            await RemoveGivenRatingAsync(tenantId, given, ct);
        // Ratings I received: the raters' "given" pointers.
        foreach (var rating in await repository.GetAllAsync<RatingEntity>(RatingEntity.GetPk(tenantId), ct))
            keys.Add((RatingGivenEntity.GetPk(rating.RaterTenantId), RatingGivenEntity.GetSk(tenantId, rating.LookId)));

        // Saved looks: my pointers in the owners' partitions, and other people's saves of my looks.
        foreach (var s in await repository.GetAllAsync<SavedLookEntity>(SavedLookEntity.GetPk(tenantId), ct))
            keys.Add((SavedByEntity.GetPk(s.OwnerTenantId), SavedByEntity.GetSk(s.LookId, tenantId)));
        foreach (var s in await repository.GetAllAsync<SavedByEntity>(SavedByEntity.GetPk(tenantId), ct))
            keys.Add((SavedLookEntity.GetPk(s.SaverTenantId), SavedLookEntity.GetSk(tenantId, s.LookId)));

        // Blocks, both directions.
        foreach (var b in await repository.GetAllAsync<BlockEntity>(BlockEntity.GetPk(tenantId), ct))
            keys.Add((BlockedByEntity.GetPk(b.BlockedTenantId), BlockedByEntity.GetSk(tenantId)));
        foreach (var b in await repository.GetAllAsync<BlockedByEntity>(BlockedByEntity.GetPk(tenantId), ct))
            keys.Add((BlockEntity.GetPk(b.BlockerTenantId), BlockEntity.GetSk(tenantId)));

        await CleanReportsAsync(tenantId, keys, ct);
        await CleanInvitesAsync(tenantId, keys, ct);

        // Watch list reverse index.
        foreach (var w in await repository.GetAllAsync<WatchItemEntity>(WatchItemEntity.GetPk(tenantId), ct))
            keys.Add((ProductWatcherEntity.GetPk(w.ProductId), ProductWatcherEntity.GetSk(tenantId)));

        // Discovery index and notification send lists.
        foreach (var segment in Enum.GetValues<Segment>())
            keys.Add((PublicProfileIndexEntity.GetPk(segment), PublicProfileIndexEntity.GetSk(tenantId)));
        foreach (var type in Enum.GetValues<NotificationType>())
            keys.Add((NotificationSubscriberEntity.GetPk(type), NotificationSubscriberEntity.GetSk(tenantId)));
        foreach (var pref in await repository.GetAllAsync<NotificationPrefEntity>(NotificationPrefEntity.GetPk(tenantId), ct))
            keys.Add((ReminderSlotEntity.GetPk(pref.MorningOutfitLocalTime), ReminderSlotEntity.GetSk(tenantId)));

        var today = DateOnly.FromDateTime(timeProvider.GetUtcNow().UtcDateTime);
        for (var i = 0; i <= 3; i++)
            keys.Add((RatingDigestEntity.GetPk(WeeklyEditRules.Format(today.AddDays(-i))), RatingDigestEntity.GetSk(tenantId)));

        // Watch-list auto-add candidates of my clicks (decision 10).
        foreach (var click in await repository.GetAllAsync<AffiliateClickEntity>(AffiliateClickEntity.GetPk(tenantId), ct))
        {
            if (click.WatchAutoAddDueAt is { } dueAt)
                keys.Add((WatchAutoAddCandidateEntity.GetPk(dueAt), WatchAutoAddCandidateEntity.GetSk(tenantId, click.ClickId)));
        }

        await AnonymiseRevenueAsync(tenantId, ct);

        if (keys.Count > 0)
            await repository.BatchDeleteKeysAsync(keys.Distinct().ToList(), ct);
        logger.LogInformation("Cross-tenant cleanup for tenant {TenantId}: {Count} foreign keys removed", tenantId, keys.Count);
    }

    private async Task RemoveGivenRatingAsync(string raterTenantId, RatingGivenEntity given, CancellationToken ct)
    {
        var ratingPk = RatingEntity.GetPk(given.OwnerTenantId);
        var ratingSk = RatingEntity.GetSk(given.LookId, raterTenantId);
        for (var attempt = 0; attempt < SummaryRetries; attempt++)
        {
            var rating = await repository.GetAsync<RatingEntity>(ratingPk, ratingSk, ct);
            if (rating is null)
                return; // already removed (retry of a failed deletion)

            var summaryPk = LookRatingSummaryEntity.GetPk(given.OwnerTenantId);
            var summary = await repository.GetAsync<LookRatingSummaryEntity>(summaryPk, LookRatingSummaryEntity.GetSk(given.LookId), ct);
            var operations = new List<TransactWriteOperation> { TransactWriteOperation.DeleteExisting(ratingPk, ratingSk) };
            if (summary is not null)
            {
                summary.Sum = Math.Max(0, summary.Sum - rating.Score);
                summary.Count = Math.Max(0, summary.Count - 1);
                operations.Add(TransactWriteOperation.PutVersioned(summary));
            }
            if ((await repository.TransactWriteAsync(operations, ct)).Applied)
                return;
        }
        throw new InvalidOperationException("Rating summary could not be corrected after retries.");
    }

    private async Task CleanReportsAsync(string tenantId, List<(string Pk, string Sk)> keys, CancellationToken ct)
    {
        // Reports I filed stay for moderation, without the reporter.
        foreach (var filed in await repository.GetAllAsync<ReportFiledEntity>(ReportFiledEntity.GetPk(tenantId), ct))
        {
            foreach (var status in Enum.GetValues<ReportStatus>())
            {
                var report = await repository.GetAsync<ReportEntity>(ReportEntity.GetPk(status), ReportEntity.GetSk(filed.ReportId), ct);
                if (report is null || report.ReporterTenantId != tenantId)
                    continue;
                report.ReporterTenantId = null;
                await repository.SaveAsync(report, ct);
            }
        }

        // Reports about me: there is nothing left to moderate.
        foreach (var received in await repository.GetAllAsync<ReportReceivedEntity>(ReportReceivedEntity.GetPk(tenantId), ct))
        {
            foreach (var status in Enum.GetValues<ReportStatus>())
            {
                var report = await repository.GetAsync<ReportEntity>(ReportEntity.GetPk(status), ReportEntity.GetSk(received.ReportId), ct);
                if (report is null)
                    continue;
                if (report.ReporterTenantId is not null)
                    keys.Add((ReportFiledEntity.GetPk(report.ReporterTenantId), ReportFiledEntity.GetSk(report.Id)));
                keys.Add((report.Pk, report.Sk));
            }
        }
    }

    private async Task CleanInvitesAsync(string tenantId, List<(string Pk, string Sk)> keys, CancellationToken ct)
    {
        var own = await repository.GetAsync<InviteEntity>(InviteEntity.GetPk(tenantId), InviteEntity.GetSk(), ct);
        if (own?.Code is { Length: > 0 } code)
            keys.Add((InviteCodeEntity.GetPk(), InviteCodeEntity.GetSk(code)));
        if (own?.InvitedByTenantId is { } inviter)
            keys.Add((InviteeEntity.GetPk(inviter), InviteeEntity.GetSk(tenantId)));

        // People I invited keep their account; the pointer to me goes.
        foreach (var invitee in await repository.GetAllAsync<InviteeEntity>(InviteeEntity.GetPk(tenantId), ct))
        {
            var theirs = await repository.GetAsync<InviteEntity>(InviteEntity.GetPk(invitee.InviteeTenantId), InviteEntity.GetSk(), ct);
            if (theirs?.InvitedByTenantId != tenantId)
                continue;
            theirs.InvitedByTenantId = null;
            theirs.InvitedByCode = null;
            await repository.SaveAsync(theirs, ct);
        }
    }

    /// <summary>Clicks and conversions keep their money columns for the revenue report; the tenant id is removed.</summary>
    private async Task AnonymiseRevenueAsync(string tenantId, CancellationToken ct)
    {
        foreach (var click in await repository.GetAllAsync<AffiliateClickEntity>(AffiliateClickEntity.GetPk(tenantId), ct))
        {
            var index = await repository.GetAsync<AffiliateClickIndexEntity>(AffiliateClickIndexEntity.GetPk(click.ClickId), AffiliateClickIndexEntity.GetSk(), ct);
            if (index is null || index.TenantId is null)
                continue;
            index.TenantId = null;
            index.BrandId ??= click.BrandId;
            if (index.ProductIds.Count == 0)
                index.ProductIds = click.ProductIds.Count > 0 ? click.ProductIds : click.ProductId is null ? [] : [click.ProductId];
            await repository.SaveAsync(index, ct);
        }

        foreach (var conversion in await repository.GetAllAsync<AffiliateConversionEntity>(AffiliateConversionEntity.GetPk(tenantId), ct))
        {
            var pointer = await repository.GetAsync<AffiliateConversionIndexEntity>(
                AffiliateConversionIndexEntity.GetPk(conversion.Source, conversion.ExternalId), AffiliateConversionIndexEntity.GetSk(), ct);
            if (pointer is null)
                continue;
            var ledger = await repository.GetAsync<AffiliateConversionLedgerEntity>(
                AffiliateConversionLedgerEntity.GetPk(pointer.LedgerMonth), AffiliateConversionLedgerEntity.GetSk(conversion.Source, conversion.ExternalId), ct);
            if (ledger is null || ledger.TenantId is null)
                continue;
            ledger.TenantId = null;
            await repository.SaveAsync(ledger, ct);
        }
    }
}
