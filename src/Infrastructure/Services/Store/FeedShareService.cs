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
/// Akış F2 (owner decision 21), the state of "Akışta paylaş": the owner's FeedShare row and its global twin
/// (FeedUserPostEntity), written and removed together. The look row itself is never written (its version is the app's edit
/// base). Removing a share — un-share, look deletion, account deletion — takes the post, its counters and every like / save
/// / hide / report pointer other people left on it (found through the post's reaction index). The moderation reports
/// themselves (ReportEntity) are the moderation record and keep their own retention: a look that is shared again is
/// counted against its still-open reports, so un-sharing is not a way around the auto-hide.
/// Owner decision 22: while a post is on the feed its AI cover has a public copy (public/{stage}/items/{tenantHash}/cover-…,
/// served by the CDN like the cleaned piece images). It is made on the first feed read, replaced when the cover changes,
/// and deleted on un-share, look / account deletion, auto-hide and admin removal.
/// Depends only on what every host has (the look service uses it from the workers too).
/// </summary>
public sealed class FeedShareService(
    IRepository repository,
    ILookCoverService covers,
    IObjectStorage storage,
    IItemImagePublisher publicImages,
    IRateLimiter rateLimiter,
    IOptionsMonitor<ContentFeedOptions> options,
    TimeProvider timeProvider,
    ILogger<FeedShareService> logger) : IFeedShareService
{
    private const int Retries = 5;

    private DateTime Now => timeProvider.GetUtcNow().UtcDateTime;

    public async Task<FeedShareOutcome> ShareAsync(string tenantId, string userId, string lookId, CancellationToken ct)
    {
        var look = string.IsNullOrWhiteSpace(lookId) ? null : await repository.GetAsync<LookEntity>(LookEntity.GetPk(tenantId), LookEntity.GetSk(lookId), ct);
        if (look is null)
            return FeedShareOutcome.NotFound;
        // Idempotent: a shared look stays shared, whatever changed since.
        if (await repository.GetAsync<FeedShareEntity>(FeedShareEntity.GetPk(tenantId), FeedShareEntity.GetSk(lookId), ct) is not null)
            return FeedShareOutcome.Ok;

        var tenant = await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(tenantId), ct);
        var user = await repository.GetAsync<UserEntity>(UserEntity.GetPk(), UserEntity.GetSk(userId), ct);
        if (tenant is null || user is null)
            return FeedShareOutcome.NotFound;
        // The route is closed to teens by TeenGuard (403 teen_restricted, feature social); this is the second lock.
        if (tenant.IsTeen)
            return FeedShareOutcome.Teen;
        if (!user.IsEmailVerified)
            return FeedShareOutcome.EmailNotVerified;
        if (string.IsNullOrEmpty(tenant.Handle))
            return FeedShareOutcome.HandleRequired;
        if (!FeedRules.IsShareable(look))
            return FeedShareOutcome.NotShareable;
        var limit = options.CurrentValue.MaxSharesPerDay;
        if (limit > 0 && !await rateLimiter.TryAcquireAsync("feed-share", tenantId, limit, TimeSpan.FromDays(1), ct))
            return FeedShareOutcome.RateLimited;

        var now = Now;
        var postId = FeedRules.UserPostId(tenantId, lookId);
        // Reports that are still open (an earlier share of the same look) count from the first moment.
        var reporters = FeedRules.DistinctReporters(await OpenReportsAsync(tenantId, lookId, ct));
        var post = new FeedUserPostEntity
        {
            Id = postId, OwnerTenantId = tenantId, LookId = lookId, SharedAt = now, ReportCount = reporters,
            HiddenAt = reporters >= Threshold ? now : null, UpdatedAt = now,
        };
        var write = await repository.TransactWriteAsync(
        [
            TransactWriteOperation.Create(new FeedShareEntity { TenantId = tenantId, LookId = lookId, PostId = postId, SharedAt = now }),
            TransactWriteOperation.Create(post),
        ], ct);
        if (!write.Applied)
            return FeedShareOutcome.Ok;   // a concurrent share of the same look got there first

        // The post is listed once the cover of its current pieces is ready: a look that never had one requested (saved
        // before covers existed) or whose cover failed asks now, by the same rule as a save (LookCoverRules.NeedsRequest).
        await covers.RequestAsync(look, ct);
        logger.LogInformation("Look {LookId} of tenant {TenantId} shared to the feed as {PostId}", lookId, tenantId, postId);
        return FeedShareOutcome.Ok;
    }

    public async Task UnshareAsync(string tenantId, string lookId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(lookId))
            return;
        var postId = FeedRules.UserPostId(tenantId, lookId);
        var publicCover = (await repository.GetAsync<FeedUserPostEntity>(FeedUserPostEntity.GetPk(), FeedUserPostEntity.GetSk(postId), ct))?.PublicCoverKey;
        var keys = new List<(string Pk, string Sk)>();
        // What other people left on the post: their own rows first, then the index that found them.
        foreach (var reaction in await repository.GetAllAsync<FeedPostReactionEntity>(FeedPostReactionEntity.GetPk(postId), ct))
        {
            keys.Add(reaction.Kind switch
            {
                FeedReactionKind.Like => (FeedLikeEntity.GetPk(reaction.TenantId), FeedLikeEntity.GetSk(postId)),
                FeedReactionKind.Save => (FeedSaveEntity.GetPk(reaction.TenantId), FeedSaveEntity.GetSk(postId)),
                FeedReactionKind.Hide => (FeedHideEntity.GetPk(reaction.TenantId), FeedHideEntity.GetSk(postId)),
                _ => (FeedReportEntity.GetPk(reaction.TenantId), FeedReportEntity.GetSk(postId)),
            });
            keys.Add((reaction.Pk, reaction.Sk));
        }
        keys.Add((FeedPostStatsEntity.GetPk(), FeedPostStatsEntity.GetSk(postId)));
        keys.Add((FeedUserPostEntity.GetPk(), FeedUserPostEntity.GetSk(postId)));
        keys.Add((FeedShareEntity.GetPk(tenantId), FeedShareEntity.GetSk(lookId)));
        await repository.BatchDeleteKeysAsync(keys, ct);
        // After the rows: nothing points at the copy any more. (A copy a concurrent feed read makes right now is never
        // referenced and has an unguessable key; account deletion removes the whole public folder.)
        await publicImages.UnpublishAsync(tenantId, [publicCover], ct);
    }

    public async Task<string?> PublicCoverAsync(FeedUserPostEntity post, string coverKey, CancellationToken ct)
    {
        if (post.HiddenAt is not null)
            return null;
        if (string.Equals(post.PublicCoverSource, coverKey, StringComparison.Ordinal) && post.PublicCoverKey is { } current
            && StorageKeys.IsPublicItemKeyOf(current, post.OwnerTenantId))
            return current;

        var key = StorageKeys.PublicLookCover(post.OwnerTenantId, post.LookId, Convert.ToHexStringLower(System.Security.Cryptography.RandomNumberGenerator.GetBytes(16)));
        try
        {
            if (!await storage.CopyAsync(coverKey, key, "image/webp", ItemImageRenditions.PublicCacheControl, ct))
                return null;
            var previous = post.PublicCoverKey;
            post.PublicCoverKey = key;
            post.PublicCoverSource = coverKey;
            if (await repository.SaveIfVersionAsync(post, post.Version, ct))
            {
                await publicImages.UnpublishAsync(post.OwnerTenantId, [previous], ct);
                return key;
            }
            // The row changed meanwhile (another reader published, a report, an un-share): this copy is not the post's.
            await publicImages.UnpublishAsync(post.OwnerTenantId, [key], ct);
            return null;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning("Cover of feed post {PostId} could not be published ({Error}); it is shown presigned", post.Id, ex.GetType().Name);
            await publicImages.UnpublishAsync(post.OwnerTenantId, [key], ct);
            return null;
        }
    }

    public async Task UnpublishCoverAsync(string postId, CancellationToken ct)
    {
        for (var attempt = 0; attempt < Retries; attempt++)
        {
            var post = await repository.GetAsync<FeedUserPostEntity>(FeedUserPostEntity.GetPk(), FeedUserPostEntity.GetSk(postId), ct);
            if (post?.PublicCoverKey is not { } key)
                return;
            post.PublicCoverKey = null;
            post.PublicCoverSource = null;
            if (await repository.SaveIfVersionAsync(post, post.Version, ct))
            {
                await publicImages.UnpublishAsync(post.OwnerTenantId, [key], ct);
                return;
            }
        }
        logger.LogWarning("Public cover of feed post {PostId} could not be taken away after retries", postId);
    }

    public async Task RemoveAllAsync(string tenantId, CancellationToken ct)
    {
        foreach (var share in await repository.GetAllAsync<FeedShareEntity>(FeedShareEntity.GetPk(tenantId), ct))
            await UnshareAsync(tenantId, share.LookId, ct);

        // The likes digest markers of the last days that name this owner.
        var today = DateOnly.FromDateTime(Now);
        var keys = new List<(string Pk, string Sk)>();
        for (var i = 0; i <= 3; i++)
        {
            var pk = FeedLikeDigestEntity.GetPk(WeeklyEditRules.Format(today.AddDays(-i)));
            keys.AddRange((await repository.GetAllAsync<FeedLikeDigestEntity>(pk, FeedLikeDigestEntity.GetSkPrefix(tenantId), SkOperator.BeginsWith, ct)).Select(r => (r.Pk, r.Sk)));
        }
        if (keys.Count > 0)
            await repository.BatchDeleteKeysAsync(keys, ct);
    }

    public async Task<IReadOnlyDictionary<string, FeedStatsDto>> GetSharedAsync(string tenantId, CancellationToken ct)
    {
        var shares = await repository.GetAllAsync<FeedShareEntity>(FeedShareEntity.GetPk(tenantId), ct);
        if (shares.Count == 0)
            return new Dictionary<string, FeedStatsDto>();
        var stats = (await repository.BatchGetAsync(shares.Select(s => new FeedPostStatsEntity { PostId = s.PostId }).ToList(), ct)).ToDictionary(s => s.PostId, StringComparer.Ordinal);
        return shares.ToDictionary(s => s.LookId, s => ToStats(stats.GetValueOrDefault(s.PostId)), StringComparer.Ordinal);
    }

    public async Task<FeedStatsDto?> GetSharedAsync(string tenantId, string lookId, CancellationToken ct)
    {
        var share = await repository.GetAsync<FeedShareEntity>(FeedShareEntity.GetPk(tenantId), FeedShareEntity.GetSk(lookId), ct);
        return share is null
            ? null
            : ToStats(await repository.GetAsync<FeedPostStatsEntity>(FeedPostStatsEntity.GetPk(), FeedPostStatsEntity.GetSk(share.PostId), ct));
    }

    private static FeedStatsDto ToStats(FeedPostStatsEntity? stats) => new(Math.Max(0, stats?.LikeCount ?? 0), Math.Max(0, stats?.SaveCount ?? 0));

    public async Task<IReadOnlyList<ReportEntity>> OpenReportsAsync(string ownerTenantId, string lookId, CancellationToken ct)
    {
        var received = await repository.GetAllAsync<ReportReceivedEntity>(ReportReceivedEntity.GetPk(ownerTenantId), ct);
        if (received.Count == 0)
            return [];
        var open = await repository.BatchGetAsync(received.Select(r => new ReportEntity { Id = r.ReportId, Status = ReportStatus.Open }).ToList(), ct);
        return open.Where(r => r.TargetKind == ReportTargetKind.Look && string.Equals(r.TargetId, lookId, StringComparison.Ordinal))
            .OrderBy(r => r.CreatedAt).ThenBy(r => r.Id, StringComparer.Ordinal).ToList();
    }

    public async Task<FeedUserPostEntity?> RefreshReportsAsync(string postId, CancellationToken ct)
    {
        for (var attempt = 0; attempt < Retries; attempt++)
        {
            var post = await repository.GetAsync<FeedUserPostEntity>(FeedUserPostEntity.GetPk(), FeedUserPostEntity.GetSk(postId), ct);
            if (post is null)
                return null;
            var reporters = FeedRules.DistinctReporters(await OpenReportsAsync(post.OwnerTenantId, post.LookId, ct));
            var hide = reporters >= Threshold && post.HiddenAt is null;
            if (post.ReportCount == reporters && !hide)
                return post;

            var now = Now;
            post.ReportCount = reporters;
            post.UpdatedAt = now;
            var publicCover = hide ? post.PublicCoverKey : null;
            if (hide)
            {
                post.HiddenAt = now;
                // Off the feed = off the public address too; an admin restore publishes it again on the next read.
                post.PublicCoverKey = null;
                post.PublicCoverSource = null;
            }
            if (await repository.SaveIfVersionAsync(post, post.Version, ct))
            {
                await publicImages.UnpublishAsync(post.OwnerTenantId, [publicCover], ct);
                if (hide)
                    logger.LogInformation("Feed post {PostId} of tenant {TenantId} left the feed after {Reporters} reporters", postId, post.OwnerTenantId, reporters);
                return post;
            }
        }
        throw new InvalidOperationException($"Report count of feed post {postId} could not be written after retries.");
    }

    private int Threshold => Math.Max(1, options.CurrentValue.ReportsToAutoHide);
}

/// <summary>
/// The reaction ↔ counter pairs of Akış posts, each written in one transaction: the tenant's row (created / deleted with a
/// condition) and the post's versioned stats row. A lost race retries with fresh reads, so concurrent likes never lose a
/// count and a repeated like / unlike never counts twice. A USER post (Akış F2) also gets its reaction-index row (so the
/// post's removal can find the like) and, for a like, the owner's digest marker of the day. Shared with account deletion
/// (ICrossTenantCleanup).
/// </summary>
public static class FeedLikeCounter
{
    /// <param name="userPost">The post when it is a shared look (its reaction index and the owner's digest marker are written too); null for an editor post.</param>
    public static async Task<long> LikeAsync(IRepository repository, string tenantId, string postId, DateTime now, int retries, CancellationToken ct,
        FeedUserPostEntity? userPost = null)
    {
        for (var attempt = 0; attempt < Math.Max(1, retries); attempt++)
        {
            var stats = await StatsAsync(repository, postId, ct);
            if (await repository.GetAsync<FeedLikeEntity>(FeedLikeEntity.GetPk(tenantId), FeedLikeEntity.GetSk(postId), ct) is not null)
                return Math.Max(0, stats.LikeCount);

            stats.LikeCount = Math.Max(0, stats.LikeCount) + 1;
            stats.UpdatedAt = now;
            var operations = new List<TransactWriteOperation>
            {
                TransactWriteOperation.PutVersioned(stats),
                TransactWriteOperation.Create(new FeedLikeEntity { TenantId = tenantId, PostId = postId, LikedAt = now }),
            };
            if (userPost is not null)
            {
                operations.Add(TransactWriteOperation.Put(new FeedPostReactionEntity { PostId = postId, Kind = FeedReactionKind.Like, TenantId = tenantId }));
                operations.Add(TransactWriteOperation.Put(new FeedLikeDigestEntity
                {
                    Day = DayOf(now), OwnerTenantId = userPost.OwnerTenantId, LikerTenantId = tenantId, CreatedAt = now,
                }));
            }
            if ((await repository.TransactWriteAsync(operations, ct)).Applied)
                return stats.LikeCount;
        }
        throw new InvalidOperationException("Feed like counter could not be updated after retries.");
    }

    public static async Task<long> UnlikeAsync(IRepository repository, string tenantId, string postId, DateTime now, int retries, CancellationToken ct,
        FeedUserPostEntity? userPost = null)
    {
        for (var attempt = 0; attempt < Math.Max(1, retries); attempt++)
        {
            var stats = await StatsAsync(repository, postId, ct);
            var like = await repository.GetAsync<FeedLikeEntity>(FeedLikeEntity.GetPk(tenantId), FeedLikeEntity.GetSk(postId), ct);
            if (like is null)
                return Math.Max(0, stats.LikeCount);

            stats.LikeCount = Math.Max(0, stats.LikeCount - 1);
            stats.UpdatedAt = now;
            var operations = new List<TransactWriteOperation>
            {
                TransactWriteOperation.PutVersioned(stats),
                TransactWriteOperation.DeleteExisting(FeedLikeEntity.GetPk(tenantId), FeedLikeEntity.GetSk(postId)),
            };
            if (FeedRules.IsUserPostId(postId))
                operations.Add(TransactWriteOperation.Delete(FeedPostReactionEntity.GetPk(postId), FeedPostReactionEntity.GetSk(FeedReactionKind.Like, tenantId)));
            // A like taken back the same day is no news for the digest (an older one was already told, or has expired).
            if (userPost is not null)
                operations.Add(TransactWriteOperation.Delete(FeedLikeDigestEntity.GetPk(DayOf(like.LikedAt)), FeedLikeDigestEntity.GetSk(userPost.OwnerTenantId, tenantId)));
            if ((await repository.TransactWriteAsync(operations, ct)).Applied)
                return stats.LikeCount;
        }
        throw new InvalidOperationException("Feed like counter could not be updated after retries.");
    }

    /// <summary>"Kaydet" on a USER post: counted (the owner's feedStats.saveCount). Saving again keeps the first savedAt.</summary>
    public static async Task SaveAsync(IRepository repository, string tenantId, string postId, DateTime now, int retries, CancellationToken ct)
    {
        for (var attempt = 0; attempt < Math.Max(1, retries); attempt++)
        {
            if (await repository.GetAsync<FeedSaveEntity>(FeedSaveEntity.GetPk(tenantId), FeedSaveEntity.GetSk(postId), ct) is not null)
                return;
            var stats = await StatsAsync(repository, postId, ct);
            stats.SaveCount = Math.Max(0, stats.SaveCount) + 1;
            stats.UpdatedAt = now;
            var result = await repository.TransactWriteAsync(
            [
                TransactWriteOperation.PutVersioned(stats),
                TransactWriteOperation.Create(new FeedSaveEntity { TenantId = tenantId, PostId = postId, SavedAt = now }),
                TransactWriteOperation.Put(new FeedPostReactionEntity { PostId = postId, Kind = FeedReactionKind.Save, TenantId = tenantId }),
            ], ct);
            if (result.Applied)
                return;
        }
        throw new InvalidOperationException("Feed save counter could not be updated after retries.");
    }

    public static async Task UnsaveAsync(IRepository repository, string tenantId, string postId, DateTime now, int retries, CancellationToken ct)
    {
        for (var attempt = 0; attempt < Math.Max(1, retries); attempt++)
        {
            if (await repository.GetAsync<FeedSaveEntity>(FeedSaveEntity.GetPk(tenantId), FeedSaveEntity.GetSk(postId), ct) is null)
                return;
            var stats = await StatsAsync(repository, postId, ct);
            stats.SaveCount = Math.Max(0, stats.SaveCount - 1);
            stats.UpdatedAt = now;
            var result = await repository.TransactWriteAsync(
            [
                TransactWriteOperation.PutVersioned(stats),
                TransactWriteOperation.DeleteExisting(FeedSaveEntity.GetPk(tenantId), FeedSaveEntity.GetSk(postId)),
                TransactWriteOperation.Delete(FeedPostReactionEntity.GetPk(postId), FeedPostReactionEntity.GetSk(FeedReactionKind.Save, tenantId)),
            ], ct);
            if (result.Applied)
                return;
        }
        throw new InvalidOperationException("Feed save counter could not be updated after retries.");
    }

    public static string DayOf(DateTime utc) => WeeklyEditRules.Format(DateOnly.FromDateTime(utc));

    private static async Task<FeedPostStatsEntity> StatsAsync(IRepository repository, string postId, CancellationToken ct) =>
        await repository.GetAsync<FeedPostStatsEntity>(FeedPostStatsEntity.GetPk(), FeedPostStatsEntity.GetSk(postId), ct)
        ?? new FeedPostStatsEntity { PostId = postId };
}
