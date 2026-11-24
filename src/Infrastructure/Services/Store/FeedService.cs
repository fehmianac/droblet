using Domain.Domain;
using Domain.Entity;
using Domain.Entity.Base;
using Domain.Enum;
using Domain.Extensions;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Domain.Validation;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Infrastructure.Services.Store;

/// <summary>
/// Akış. F1 (decisions 16–19): editor posts and stories, likes and saves. The post / story partitions are small and
/// admin-managed, so they are read whole and filtered in memory (same as the weekly edits); product rows resolve from the
/// cached catalog on read. No comments, no follows on the card — by decision, not by omission.
/// F2 (decision 21): the looks users shared, mixed in at most one in every ContentFeed:UserPostEvery items. A shared look is
/// a pointer (FeedUserPostEntity); everything shown is read from the owner's partition on the request, through
/// VisibilityPolicy (FeedSharedLook) with the viewer's block rows — nothing is cached, so un-share, block, moderation and a
/// changed look apply at once. Read-time ranking over the newest ContentFeed:UserCandidateLimit shares (phase-1 scale, like
/// the friends' feed); a fan-out-on-write feed can replace it behind the same endpoint.
/// When the viewer's segment has no live editor post at all, the current weekly edit stands in (FeedRules.FallbackPosts).
/// </summary>
public sealed class FeedService(
    IRepository repository,
    ICatalogService catalog,
    IContentService content,
    IFeedShareService shares,
    IItemImageUrls itemImages,
    IAvatarService avatars,
    IObjectStorage storage,
    IRateLimiter rateLimiter,
    IRequestLanguage requestLanguage,
    IOptionsMonitor<ContentFeedOptions> options,
    IOptionsMonitor<SocialOptions> socialOptions,
    IOptionsMonitor<PhotoOptions> photoOptions,
    TimeProvider timeProvider,
    ILogger<FeedService> logger) : IFeedService
{
    private DateTime Now => timeProvider.GetUtcNow().UtcDateTime;

    /// <summary>A shared look this viewer may see, with what its card needs. CoverKey null = the cover of its current pieces is not ready (not listed).</summary>
    private sealed record UserPost(FeedUserPostEntity Post, TenantEntity Owner, LookEntity Look, string? CoverKey);

    /// <summary>One feed slot before mapping: exactly one of the two is set.</summary>
    private sealed record Slot(FeedPostEntity? Editor, UserPost? User)
    {
        public string Id => Editor?.Id ?? User!.Post.Id;
    }

    // ── App ─────────────────────────────────────────────────────────────────────────────────────────────────────

    public async Task<PagedDto<FeedPostDto>> GetFeedAsync(string tenantId, IReadOnlySet<Occasion>? occasions, string? pageToken, CancellationToken ct)
    {
        var now = Now;
        var viewer = await TenantAsync(tenantId, ct);
        var segment = viewer?.Segment ?? Segment.Women;
        // "Bunu gösterme" and every post I reported (a report hides the post for the reporter from then on).
        var hidden = await KeysAsync(FeedHideEntity.GetPk(tenantId), ct);
        hidden.UnionWith(await KeysAsync(FeedReportEntity.GetPk(tenantId), ct));

        var editors = FeedRules.Order((await AllPostsAsync(ct)).Where(p => FeedRules.IsLive(p, now) && FeedRules.Shows(p.Segment, segment))).ToList();
        if (editors.Count > 0)
        {
            editors = editors.Where(p => occasions is null || occasions.Contains(p.Occasion)).ToList();
        }
        else if (occasions is null)
        {
            // No live editor post for this segment: the current weekly edit stands in (its looks carry no occasion, so an
            // occasion tab stays empty).
            var edit = WeeklyEditRules.PickCurrent(await content.ListEditsAsync(ct), DateOnly.FromDateTime(now), segment);
            editors = edit is null ? [] : FeedRules.Order(FeedRules.FallbackPosts(edit)).ToList();
        }
        editors = editors.Where(p => !hidden.Contains(p.Id)).ToList();

        // Teens get editor content only (decision 17).
        var users = viewer is null || viewer.IsTeen ? [] : await CandidatesAsync(viewer, occasions, hidden, ct);
        var byId = users.ToDictionary(u => u.Post.Post.Id, u => u.Post, StringComparer.Ordinal);
        var (page, next) = FeedRules.MixPage(editors, FeedRules.Order(users.Select(u => u.Rank)).ToList(), pageToken,
            options.CurrentValue.PageSize, options.CurrentValue.UserPostEvery);

        var slots = page.Select(i => new Slot(i.Editor, i.User is null ? null : byId[i.User.PostId])).ToList();
        return new PagedDto<FeedPostDto>(await ToDtosAsync(tenantId, viewer, slots, ct), next);
    }

    public async Task<IReadOnlyList<FeedStoryDto>> GetStoriesAsync(string tenantId, CancellationToken ct)
    {
        var now = Now;
        var segment = (await TenantAsync(tenantId, ct))?.Segment ?? Segment.Women;
        var stories = FeedRules.Order((await repository.GetAllAsync<FeedStoryEntity>(FeedStoryEntity.GetPk(), ct))
                .Where(s => FeedRules.IsActive(s, now) && FeedRules.Shows(s.Segment, segment)))
            .Take(Math.Max(1, options.CurrentValue.MaxStories))
            .ToList();

        var language = await requestLanguage.GetAsync(ct);
        var products = (await catalog.ToDtosAsync(stories.Select(s => s.ProductId).OfType<string>().Distinct(), ct)).ToDictionary(p => p.Id);
        return stories.Select(s => new FeedStoryDto(
            s.Id,
            new FeedStoryAuthorDto(Text(s.Author.Name, language) ?? "", s.Author.ImageUrl),
            s.ImageUrl,
            Text(s.Headline, language) ?? "",
            s.ProductId is not null && products.TryGetValue(s.ProductId, out var product) ? product : null,
            s.PublishAt)).ToList();
    }

    public async Task<FeedLikeDto?> LikeAsync(string tenantId, string postId, CancellationToken ct)
    {
        if (await ResolveAsync(tenantId, postId, ct) is not { } slot)
            return null;
        var count = await FeedLikeCounter.LikeAsync(repository, tenantId, postId, Now, options.CurrentValue.LikeRetries, ct, slot.User?.Post);
        return new FeedLikeDto(true, count);
    }

    public async Task<FeedLikeDto?> UnlikeAsync(string tenantId, string postId, CancellationToken ct)
    {
        if (await ResolveAsync(tenantId, postId, ct) is not { } slot)
            return null;
        var count = await FeedLikeCounter.UnlikeAsync(repository, tenantId, postId, Now, options.CurrentValue.LikeRetries, ct, slot.User?.Post);
        return new FeedLikeDto(false, count);
    }

    public async Task<FeedWriteOutcome> SaveAsync(string tenantId, string postId, CancellationToken ct)
    {
        if (await ResolveAsync(tenantId, postId, ct) is not { } slot)
            return FeedWriteOutcome.NotFound;
        if (slot.User is not null)
        {
            await FeedLikeCounter.SaveAsync(repository, tenantId, postId, Now, options.CurrentValue.LikeRetries, ct);
            return FeedWriteOutcome.Ok;
        }
        // Idempotent: saving again keeps the first savedAt (the list order does not jump).
        if (await repository.GetAsync<FeedSaveEntity>(FeedSaveEntity.GetPk(tenantId), FeedSaveEntity.GetSk(postId), ct) is null)
            await repository.SaveAsync(new FeedSaveEntity { TenantId = tenantId, PostId = postId, SavedAt = Now }, ct);
        return FeedWriteOutcome.Ok;
    }

    public Task UnsaveAsync(string tenantId, string postId, CancellationToken ct) =>
        FeedRules.IsUserPostId(postId)
            ? FeedLikeCounter.UnsaveAsync(repository, tenantId, postId, Now, options.CurrentValue.LikeRetries, ct)
            : repository.DeleteAsync(FeedSaveEntity.GetPk(tenantId), FeedSaveEntity.GetSk(postId), ct);

    public async Task<IReadOnlyList<FeedPostDto>> GetSavedAsync(string tenantId, CancellationToken ct)
    {
        var now = Now;
        var saves = (await repository.GetAllAsync<FeedSaveEntity>(FeedSaveEntity.GetPk(tenantId), ct))
            .OrderByDescending(s => s.SavedAt).ThenByDescending(s => s.PostId, StringComparer.Ordinal).ToList();
        if (saves.Count == 0)
            return [];
        var viewer = await TenantAsync(tenantId, ct);
        var posts = (await AllPostsAsync(ct)).ToDictionary(p => p.Id, StringComparer.Ordinal);
        var slots = new List<Slot>(saves.Count);
        foreach (var save in saves)
        {
            if (FeedRules.IsUserPostId(save.PostId))
            {
                // Hidden, removed, blocked or not ready right now: the save stays, nothing is shown.
                if (viewer is not null && await VisibleUserPostAsync(viewer, save.PostId, ct) is { CoverKey: not null } user)
                    slots.Add(new Slot(null, user));
            }
            else if (posts.GetValueOrDefault(save.PostId) is { } post ? FeedRules.IsLive(post, now) : (post = await FallbackPostAsync(save.PostId, ct)) is not null)
            {
                slots.Add(new Slot(post, null));
            }
        }
        return await ToDtosAsync(tenantId, viewer, slots, ct);
    }

    public async Task<FeedPostDto?> GetVisiblePostAsync(string tenantId, string postId, CancellationToken ct)
    {
        // The same resolution as a like or a save; a shared look still waiting for its cover is not shown, as on the feed.
        if (await ResolveAsync(tenantId, postId, ct) is not { } slot || slot.User is { CoverKey: null })
            return null;
        return (await ToDtosAsync(tenantId, await TenantAsync(tenantId, ct), [slot], ct)).FirstOrDefault();
    }

    public async Task<IReadOnlyList<ProductDto>?> GetSimilarAsync(string tenantId, string postId, CancellationToken ct)
    {
        var viewer = await TenantAsync(tenantId, ct);
        if (viewer is null || await VisibleUserPostAsync(viewer, postId, ct) is not { } post)
            return null;
        var (_, refs) = await PiecesAsync(post, ct);
        var similar = FeedRules.Similar(refs, await SegmentProductsAsync(viewer, ct), Math.Max(1, options.CurrentValue.MaxSimilarProducts));
        var result = new List<ProductDto>(similar.Count);
        foreach (var product in similar)
            result.Add(await catalog.ToDtoAsync(product, ct));
        return result;
    }

    public async Task<FeedWriteOutcome> HideAsync(string tenantId, string postId, CancellationToken ct)
    {
        if (await ResolveAsync(tenantId, postId, ct) is not { } slot)
            return FeedWriteOutcome.NotFound;
        if (await repository.GetAsync<FeedHideEntity>(FeedHideEntity.GetPk(tenantId), FeedHideEntity.GetSk(postId), ct) is not null)
            return FeedWriteOutcome.Ok;
        var operations = new List<TransactWriteOperation> { TransactWriteOperation.Put(new FeedHideEntity { TenantId = tenantId, PostId = postId, HiddenAt = Now }) };
        if (slot.User is not null)
            operations.Add(TransactWriteOperation.Put(new FeedPostReactionEntity { PostId = postId, Kind = FeedReactionKind.Hide, TenantId = tenantId }));
        await repository.TransactWriteAsync(operations, ct);
        return FeedWriteOutcome.Ok;
    }

    public async Task<(SocialOutcome Outcome, string? ReportId, bool Created)> ReportAsync(
        string tenantId, string postId, ReportReason reason, string? note, CancellationToken ct)
    {
        if (!FeedRules.IsUserPostId(postId)
            || await repository.GetAsync<FeedUserPostEntity>(FeedUserPostEntity.GetPk(), FeedUserPostEntity.GetSk(postId), ct) is not { } row)
            return (SocialOutcome.NotFound, null, false);
        if (row.OwnerTenantId == tenantId)
            return (SocialOutcome.Self, null, false);
        // One report per user per post: the repeat answers with the first one (also after the post left the feed).
        if (await repository.GetAsync<FeedReportEntity>(FeedReportEntity.GetPk(tenantId), FeedReportEntity.GetSk(postId), ct) is { } existing)
            return (SocialOutcome.Ok, existing.ReportId, false);
        var viewer = await TenantAsync(tenantId, ct);
        if (viewer is null || await VisibleUserPostAsync(viewer, postId, ct) is not { } post)
            return (SocialOutcome.NotFound, null, false);
        // The same daily budget as the profile reports (Social:ReportsPerDay).
        if (!await rateLimiter.TryAcquireAsync("report-tenant", tenantId, socialOptions.CurrentValue.ReportsPerDay, TimeSpan.FromDays(1), ct))
            return (SocialOutcome.RateLimited, null, false);

        var now = Now;
        var report = new ReportEntity
        {
            Id = Ulid.New(now),
            Status = ReportStatus.Open,
            ReporterTenantId = tenantId,
            TargetTenantId = post.Owner.Id,
            TargetKind = ReportTargetKind.Look,
            TargetId = post.Look.Id,
            Reason = reason,
            Note = string.IsNullOrWhiteSpace(note) ? null : note.Trim(),
            CreatedAt = now,
        };
        var write = await repository.TransactWriteAsync(
        [
            TransactWriteOperation.Create(new FeedReportEntity { TenantId = tenantId, PostId = postId, ReportId = report.Id, CreatedAt = now }),
            TransactWriteOperation.Put(report),
            TransactWriteOperation.Put(new ReportFiledEntity { TenantId = tenantId, ReportId = report.Id, CreatedAt = now }),
            TransactWriteOperation.Put(new ReportReceivedEntity { TenantId = post.Owner.Id, ReportId = report.Id, CreatedAt = now }),
            TransactWriteOperation.Put(new FeedPostReactionEntity { PostId = postId, Kind = FeedReactionKind.Report, TenantId = tenantId }),
        ], ct);
        if (!write.Applied)
        {
            // The same user, twice at once: the other request's report.
            var first = await repository.GetAsync<FeedReportEntity>(FeedReportEntity.GetPk(tenantId), FeedReportEntity.GetSk(postId), ct);
            return first is null ? (SocialOutcome.NotFound, null, false) : (SocialOutcome.Ok, first.ReportId, false);
        }

        await shares.RefreshReportsAsync(postId, ct);
        logger.LogInformation("Report {ReportId} filed by {TenantId} against feed post {PostId} of {TargetTenantId} ({Reason})", report.Id, tenantId, postId, post.Owner.Id, reason);
        return (SocialOutcome.Ok, report.Id, true);
    }

    // ── Shared looks (F2) ───────────────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// The shared looks this viewer may get, with their rank: owners of the viewer's segment and owners the viewer follows
    /// (FeedRules.ShowsUserPost). Never the viewer's own, a blocked pair's, a hidden-for-me or
    /// auto-hidden one, a removed look, or one whose cover is not ready for its current pieces.
    /// </summary>
    private async Task<List<(UserPost Post, FeedUserCandidate Rank)>> CandidatesAsync(
        TenantEntity viewer, IReadOnlySet<Occasion>? occasions, HashSet<string> hidden, CancellationToken ct)
    {
        var all = (await repository.GetAllAsync<FeedUserPostEntity>(FeedUserPostEntity.GetPk(), ct))
            .Where(p => p.HiddenAt is null && p.OwnerTenantId != viewer.Id && !hidden.Contains(p.Id))
            .OrderByDescending(p => p.SharedAt).ThenBy(p => p.Id, StringComparer.Ordinal)
            .ToList();
        if (all.Count == 0)
            return [];

        var blocked = await KeysAsync(BlockEntity.GetPk(viewer.Id), ct);
        blocked.UnionWith(await KeysAsync(BlockedByEntity.GetPk(viewer.Id), ct));
        var following = await KeysAsync(FollowingEntity.GetPk(viewer.Id), ct);

        // Owners are filtered before the cap: capping first would let the other segment's newest shares crowd this
        // viewer's out of the window.
        var ownerIds = all.Select(r => r.OwnerTenantId).Distinct(StringComparer.Ordinal).ToList();
        var owners = (await repository.BatchGetAsync(ownerIds.Select(id => new TenantEntity { Id = id }).ToList(), ct))
            .Where(o => CanSee(viewer.Id, o, following.Contains(o.Id), blocked.Contains(o.Id))
                        && FeedRules.ShowsUserPost(o.Segment, viewer.Segment, following.Contains(o.Id)))
            .ToDictionary(o => o.Id, StringComparer.Ordinal);
        var rows = all.Where(r => owners.ContainsKey(r.OwnerTenantId))
            .Take(Math.Max(1, options.CurrentValue.UserCandidateLimit))
            .ToList();
        if (rows.Count == 0)
            return [];

        var looks = (await repository.BatchGetAsync(rows.Select(r => new LookEntity { TenantId = r.OwnerTenantId, Id = r.LookId }).ToList(), ct))
            .ToDictionary(l => (l.TenantId, l.Id));
        var coverRows = (await repository.BatchGetAsync(rows.Select(r => new LookCoverEntity { TenantId = r.OwnerTenantId, LookId = r.LookId }).ToList(), ct))
            .ToDictionary(c => (c.TenantId, c.LookId));
        var styles = (await repository.BatchGetAsync(owners.Keys.Select(id => new StyleProfileEntity { TenantId = id }).ToList(), ct))
            .ToDictionary(s => s.TenantId, StringComparer.Ordinal);
        var myTags = (await repository.GetAsync<StyleProfileEntity>(StyleProfileEntity.GetPk(viewer.Id), StyleProfileEntity.GetSk(), ct))?.StyleTags ?? [];

        var result = new List<(UserPost, FeedUserCandidate)>(rows.Count);
        foreach (var row in rows)
        {
            if (!looks.TryGetValue((row.OwnerTenantId, row.LookId), out var look) || !FeedRules.IsShareable(look))
                continue;
            if (occasions is not null && (look.Occasion is not { } occasion || !occasions.Contains(occasion)))
                continue;
            if (CoverKey(look, coverRows.GetValueOrDefault((row.OwnerTenantId, row.LookId))) is not { } coverKey)
                continue;   // decision 20: the post is its AI cover — not listed until that is ready
            var owner = owners[row.OwnerTenantId];
            var match = StyleMatchRules.Percent(myTags, styles.GetValueOrDefault(owner.Id)?.StyleTags ?? []);
            result.Add((new UserPost(row, owner, look, coverKey), new FeedUserCandidate(row.Id, following.Contains(owner.Id), match, row.SharedAt)));
        }
        return result;
    }

    /// <summary>
    /// One shared look for a write (like, save, hide, report, similar): the same gates as the list except "hidden for me"
    /// and the cover (CoverKey null when it is not ready).
    /// </summary>
    private async Task<UserPost?> VisibleUserPostAsync(TenantEntity viewer, string postId, CancellationToken ct)
    {
        if (viewer.IsTeen || !FeedRules.IsUserPostId(postId))
            return null;
        var row = await repository.GetAsync<FeedUserPostEntity>(FeedUserPostEntity.GetPk(), FeedUserPostEntity.GetSk(postId), ct);
        if (row is null || row.HiddenAt is not null || row.OwnerTenantId == viewer.Id)
            return null;
        var owner = await TenantAsync(row.OwnerTenantId, ct);
        var blocked = await ExistsAsync(BlockEntity.GetPk(viewer.Id), BlockEntity.GetSk(row.OwnerTenantId), ct)
                      || await ExistsAsync(BlockedByEntity.GetPk(viewer.Id), BlockedByEntity.GetSk(row.OwnerTenantId), ct);
        if (owner is null || !CanSee(viewer.Id, owner, await ExistsAsync(FollowingEntity.GetPk(viewer.Id), FollowingEntity.GetSk(owner.Id), ct), blocked))
            return null;
        var look = await repository.GetAsync<LookEntity>(LookEntity.GetPk(owner.Id), LookEntity.GetSk(row.LookId), ct);
        if (look is null || !FeedRules.IsShareable(look))
            return null;
        var cover = await repository.GetAsync<LookCoverEntity>(LookCoverEntity.GetPk(owner.Id), LookCoverEntity.GetSk(look.Id), ct);
        return new UserPost(row, owner, look, CoverKey(look, cover));
    }

    /// <summary>The one cross-tenant gate of shared looks: VisibilityPolicy (blocks, teen owners) and an owner who still has a handle.</summary>
    private static bool CanSee(string viewerTenantId, TenantEntity owner, bool viewerFollowsOwner, bool blockedEitherWay) =>
        !string.IsNullOrEmpty(owner.Handle)
        && VisibilityPolicy.CanView(new VisibilityRequest(viewerTenantId, owner.Id, owner.ClosetVisibility, viewerFollowsOwner, VisibleResource.FeedSharedLook,
            owner.IsTeen ? Segment.Teen : owner.Segment, OwnerBlockedViewer: blockedEitherWay));

    private static string? CoverKey(LookEntity look, LookCoverEntity? cover) =>
        LookCoverRules.ReadyImageKey(cover, LookCoverRules.SlotsHash(look.Slots)) is { } key && StorageKeys.BelongsToTenant(key, look.TenantId) ? key : null;

    /// <summary>
    /// The pieces as others see them — kind and cleaned image only, a removed or deleted piece dropped — and what "similar
    /// products" needs of each (category + main colour).
    /// </summary>
    private async Task<(List<FeedPieceDto> Pieces, List<FeedPieceRef> Refs)> PiecesAsync(UserPost post, CancellationToken ct)
    {
        var slots = post.Look.Slots.OrderBy(s => s.Slot).ToList();
        var itemIds = slots.Select(s => s.ItemId).OfType<string>().Distinct(StringComparer.Ordinal).ToList();
        var items = itemIds.Count == 0
            ? []
            : (await repository.BatchGetAsync(itemIds.Select(id => new ItemEntity { TenantId = post.Owner.Id, Id = id }).ToList(), ct)).ToDictionary(i => i.Id, StringComparer.Ordinal);

        var pieces = new List<FeedPieceDto>(slots.Count);
        var refs = new List<FeedPieceRef>(slots.Count);
        foreach (var slot in slots)
        {
            if (slot.ItemId is not null)
            {
                if (!items.TryGetValue(slot.ItemId, out var item) || item.IsModerationHidden())
                    continue;
                pieces.Add(new FeedPieceDto(item.Category, (await itemImages.GetForOthersAsync(item, ct)).MediumUrl, string.IsNullOrWhiteSpace(item.Subcategory) ? null : item.Subcategory));
                refs.Add(new FeedPieceRef(item.Category, item.ColorIds.FirstOrDefault()));
            }
            else if (slot.ProductId is not null && (await catalog.ToDtosAsync([slot.ProductId], ct)).FirstOrDefault() is { } product)
            {
                var category = CatalogRules.ItemCategoryOf(product.Category);
                pieces.Add(new FeedPieceDto(category, product.Images.FirstOrDefault()));
                refs.Add(new FeedPieceRef(category, product.Colors.FirstOrDefault(), product.Id));
            }
        }
        return (pieces, refs);
    }

    private async Task<IReadOnlyList<CatalogProductEntity>> SegmentProductsAsync(TenantEntity viewer, CancellationToken ct) =>
        CatalogRules.ForSegment(await catalog.GetProductsAsync(ct), viewer.Segment ?? Segment.Women).ToList();

    // ── Mapping ─────────────────────────────────────────────────────────────────────────────────────────────────

    private async Task<IReadOnlyList<FeedPostDto>> ToDtosAsync(string tenantId, TenantEntity? viewer, IReadOnlyList<Slot> slots, CancellationToken ct)
    {
        if (slots.Count == 0)
            return [];

        var language = await requestLanguage.GetAsync(ct);
        var ids = slots.Select(s => s.Id).ToList();
        var stats = (await repository.BatchGetAsync(ids.Select(id => new FeedPostStatsEntity { PostId = id }).ToList(), ct)).ToDictionary(s => s.PostId);
        var liked = (await repository.BatchGetAsync(ids.Select(id => new FeedLikeEntity { TenantId = tenantId, PostId = id }).ToList(), ct))
            .Select(l => l.PostId).ToHashSet(StringComparer.Ordinal);
        var saved = (await repository.BatchGetAsync(ids.Select(id => new FeedSaveEntity { TenantId = tenantId, PostId = id }).ToList(), ct))
            .Select(s => s.PostId).ToHashSet(StringComparer.Ordinal);
        var wardrobe = slots.Any(s => s.Editor is { ProductIds.Count: > 0 })
            ? await repository.GetAllAsync<ItemEntity>(ItemEntity.GetPk(tenantId), ct)
            : [];
        var segmentProducts = viewer is not null && slots.Any(s => s.User is not null) ? await SegmentProductsAsync(viewer, ct) : [];

        var result = new List<FeedPostDto>(slots.Count);
        foreach (var slot in slots)
        {
            var likeCount = stats.TryGetValue(slot.Id, out var s) ? Math.Max(0, s.LikeCount) : 0;
            if (slot.Editor is { } post)
            {
                var products = (await catalog.ToDtosAsync(post.ProductIds, ct))
                    .Select(p => FeedRules.OwnedItem(p, wardrobe) is { } owned ? FeedProductDto.From(p, true, owned.Id) : FeedProductDto.From(p, false))
                    .ToList();
                result.Add(new FeedPostDto(
                    FeedPostKind.Editor,
                    post.Id,
                    new FeedAuthorDto(post.Author.Kind, Text(post.Author.Name, language) ?? "", post.Author.Handle, post.Author.ImageUrl, Verified: post.Author.Kind == FeedAuthorKind.Edit),
                    FeedRules.EditLookIdOf(post.Id) is null ? post.Occasion : null,
                    post.PublishAt,
                    Text(post.Title, language) ?? "",
                    Text(post.Note, language),
                    post.ImageUrls,
                    products,
                    FeedRules.BuyableCount(products),
                    // The pieces the AI split found in the photograph (the strip under the post); empty for a post that was not split.
                    Pieces: post.Pieces.Select(p => new FeedPieceDto(p.Category, p.ImageUrl, string.IsNullOrWhiteSpace(p.Subcategory) ? null : p.Subcategory)).ToList(),
                    HasSimilar: false,
                    // "Üzerimde dene" dresses the post's available catalog products; a post without any is tried on as its
                    // photograph (photo try-on) once it has pieces — never for a teen (FeedRules.CanTryOn).
                    CanTryOn: FeedRules.CanTryOn(post, products.Any(p => p.Available), viewer?.IsTeen ?? false),
                    likeCount,
                    liked.Contains(post.Id),
                    saved.Contains(post.Id)));
            }
            else if (slot.User is { CoverKey: { } coverKey } user)
            {
                var (pieces, refs) = await PiecesAsync(user, ct);
                var (coverUrl, coverExpiresAt) = await CoverUrlAsync(user.Post, coverKey, ct);
                var handle = user.Owner.Handle!;
                // The avatar travels with the post the owner chose to share; a moderator-hidden profile shows the handle only.
                var avatar = user.Owner.IsModerationHidden() ? null : (await avatars.GetAsync(user.Owner.Id, ct))?.Url;
                result.Add(new FeedPostDto(
                    FeedPostKind.User,
                    user.Post.Id,
                    new FeedAuthorDto(FeedAuthorKind.User, "@" + handle, handle, avatar, Verified: false),
                    user.Look.Occasion,
                    user.Post.SharedAt,
                    user.Look.Name ?? "",
                    Note: null,
                    // The AI flat-lay cover only (decision 20), from its public address (decision 22); never a try-on image or a photo of the owner.
                    [coverUrl],
                    Products: [],
                    BuyableCount: 0,
                    pieces,
                    HasSimilar: FeedRules.Similar(refs, segmentProducts, 1).Count > 0,
                    CanTryOn: false,
                    likeCount,
                    liked.Contains(user.Post.Id),
                    saved.Contains(user.Post.Id),
                    ImagesExpireAt: coverExpiresAt));
            }
        }
        return result;
    }

    /// <summary>
    /// Owner decision 22: a shared look's cover is public while it is on the feed — a CDN URL that does not expire
    /// (Photos:PublicUrlsEnabled). Until the CDN is switched on, or when the copy could not be made, a presigned URL.
    /// </summary>
    private async Task<(string Url, DateTime? ExpiresAt)> CoverUrlAsync(FeedUserPostEntity post, string coverKey, CancellationToken ct)
    {
        var publicKey = await shares.PublicCoverAsync(post, coverKey, ct);
        if (publicKey is not null && photoOptions.CurrentValue.EffectivePublicBaseUrl is { } baseUrl)
            return ($"{baseUrl.TrimEnd('/')}/{publicKey}", null);
        var ttl = TimeSpan.FromSeconds(photoOptions.CurrentValue.ReadUrlTtlSeconds);
        return (await storage.CreateReadUrlAsync(publicKey ?? coverKey, ttl, ct), Now.Add(ttl));
    }

    // ── Resolution ──────────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>The post behind an id for this viewer: a live editor post, a look of a published weekly edit (fallback id) or a visible shared look.</summary>
    private async Task<Slot?> ResolveAsync(string tenantId, string postId, CancellationToken ct)
    {
        if (FeedRules.IsUserPostId(postId))
            return await TenantAsync(tenantId, ct) is { } viewer && await VisibleUserPostAsync(viewer, postId, ct) is { } user ? new Slot(null, user) : null;
        return await LivePostAsync(postId, ct) is { } post ? new Slot(post, null) : null;
    }

    private async Task<FeedPostEntity?> LivePostAsync(string postId, CancellationToken ct)
    {
        if (FeedRules.EditLookIdOf(postId) is not null)
            return await FallbackPostAsync(postId, ct);
        if (!FeedInputRules.IsId(postId))
            return null;
        var post = await repository.GetAsync<FeedPostEntity>(FeedPostEntity.GetPk(), FeedPostEntity.GetSk(postId), ct);
        return post is not null && FeedRules.IsLive(post, Now) ? post : null;
    }

    /// <summary>
    /// A fallback post by id: the look of any published, not retired weekly edit (not only the current one, so a like or a
    /// save made while the fallback was shown keeps working).
    /// </summary>
    private async Task<FeedPostEntity?> FallbackPostAsync(string postId, CancellationToken ct)
    {
        if (FeedRules.EditLookIdOf(postId) is null)
            return null;
        return (await content.ListEditsAsync(ct))
            .Where(e => e is { Published: true, Retired: false })
            .OrderByDescending(e => e.WeekStart, StringComparer.Ordinal)
            .SelectMany(FeedRules.FallbackPosts)
            .FirstOrDefault(p => p.Id == postId);
    }

    private Task<TenantEntity?> TenantAsync(string tenantId, CancellationToken ct) =>
        repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(tenantId), ct);

    private async Task<HashSet<string>> KeysAsync(string pk, CancellationToken ct) =>
        (await repository.GetKeysAsync(pk, ct)).Select(k => k.Sk).ToHashSet(StringComparer.Ordinal);

    private async Task<bool> ExistsAsync(string pk, string sk, CancellationToken ct) => await repository.GetAsync<FeedKeyProbe>(pk, sk, ct) is not null;

    private Task<List<FeedPostEntity>> AllPostsAsync(CancellationToken ct) => repository.GetAllAsync<FeedPostEntity>(FeedPostEntity.GetPk(), ct);

    private string? Text(IReadOnlyDictionary<string, string>? text, string language) => LocalizedText.Resolve(text, language, requestLanguage.Default);

    // ── Admin / seed ────────────────────────────────────────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<AdminFeedPostDto>> ListPostsAsync(CancellationToken ct)
    {
        var posts = FeedRules.Order(await AllPostsAsync(ct)).ToList();
        var stats = (await repository.GetAllAsync<FeedPostStatsEntity>(FeedPostStatsEntity.GetPk(), ct)).ToDictionary(s => s.PostId);
        return posts.Select(p => p.ToAdminDto(stats.TryGetValue(p.Id, out var s) ? Math.Max(0, s.LikeCount) : 0)).ToList();
    }

    public async Task<AdminFeedPostDto?> GetPostAsync(string postId, CancellationToken ct)
    {
        var post = await repository.GetAsync<FeedPostEntity>(FeedPostEntity.GetPk(), FeedPostEntity.GetSk(postId), ct);
        return post is null ? null : post.ToAdminDto(await LikeCountAsync(postId, ct));
    }

    public async Task<(CatalogWriteOutcome Outcome, AdminFeedPostDto? Post, IReadOnlyList<string> MissingProductIds)> UpsertPostAsync(FeedPostInput input, CancellationToken ct)
    {
        var productIds = (input.ProductIds ?? []).ToList();
        var missing = await MissingProductsAsync(productIds, ct);
        if (missing.Count > 0)
            return (CatalogWriteOutcome.ProductNotFound, null, missing);

        var now = Now;
        var existing = await repository.GetAsync<FeedPostEntity>(FeedPostEntity.GetPk(), FeedPostEntity.GetSk(input.Id), ct);
        var author = input.Author!;
        var post = new FeedPostEntity
        {
            Id = input.Id,
            Segment = input.Segment,
            Author = new FeedAuthor
            {
                Kind = author.Kind,
                Name = LocalizedText.Normalize(author.Name),
                Handle = string.IsNullOrWhiteSpace(author.Handle) ? null : HandleRules.Normalize(author.Handle),
                ImageUrl = NullIfEmpty(author.ImageUrl),
            },
            Occasion = input.Occasion,
            Title = LocalizedText.Normalize(input.Title),
            Note = LocalizedText.NormalizeOptional(input.Note),
            ImageUrls = (input.ImageUrls ?? []).Select(u => u.Trim()).ToList(),
            ProductIds = productIds,
            PublishAt = FeedRules.Utc(input.PublishAt),
            SortOrder = input.SortOrder,
            Published = input.Published && !input.Retired,
            Retired = input.Retired,
            CreatedAt = existing?.CreatedAt ?? now,
            UpdatedAt = now,
        };
        // The pieces belong to the first image (split-feed-posts), not to the panel's form: an edit keeps them, a new first
        // image drops them (they would show another photograph's pieces).
        if (existing is not null && FeedRules.SamePhoto(existing.ImageUrls.FirstOrDefault(), post.ImageUrls.FirstOrDefault()))
            post.Pieces = existing.Pieces;
        await repository.SaveAsync(post, ct);
        return (existing is null ? CatalogWriteOutcome.Created : CatalogWriteOutcome.Updated, post.ToAdminDto(await LikeCountAsync(post.Id, ct)), []);
    }

    public async Task<FeedPiecesOutcome> SetPostPiecesAsync(string postId, string imageUrl, IReadOnlyList<FeedPostPiece> pieces, CancellationToken ct)
    {
        // Re-read right before the write and change nothing but the pieces (an admin edit made meanwhile is kept; the like
        // counter lives in its own row). PutExisting: a post deleted meanwhile is not brought back.
        var post = await repository.GetAsync<FeedPostEntity>(FeedPostEntity.GetPk(), FeedPostEntity.GetSk(postId), ct);
        if (post is null)
            return FeedPiecesOutcome.NotFound;
        if (!FeedRules.SamePhoto(post.ImageUrls.FirstOrDefault(), imageUrl))
            return FeedPiecesOutcome.ImageChanged;
        post.Pieces = pieces.Select(p => new FeedPostPiece
        {
            Category = p.Category,
            Subcategory = string.IsNullOrWhiteSpace(p.Subcategory) ? null : p.Subcategory.Trim(),
            ImageUrl = p.ImageUrl.Trim(),
            ColorId = ColorCatalog.IsKnown(p.ColorId) ? p.ColorId : null,
        }).ToList();
        var write = await repository.TransactWriteAsync([TransactWriteOperation.PutExisting(post)], ct);
        return write.Applied ? FeedPiecesOutcome.Written : FeedPiecesOutcome.NotFound;
    }

    public async Task<bool> SetPostNoteAsync(string postId, IReadOnlyDictionary<string, string>? note, CancellationToken ct)
    {
        // Like the pieces: re-read right before the write, change the one field, never bring a deleted post back.
        var post = await repository.GetAsync<FeedPostEntity>(FeedPostEntity.GetPk(), FeedPostEntity.GetSk(postId), ct);
        if (post is null)
            return false;
        post.Note = LocalizedText.NormalizeOptional(note);
        return (await repository.TransactWriteAsync([TransactWriteOperation.PutExisting(post)], ct)).Applied;
    }

    public async Task<bool> RetirePostAsync(string postId, CancellationToken ct)
    {
        var post = await repository.GetAsync<FeedPostEntity>(FeedPostEntity.GetPk(), FeedPostEntity.GetSk(postId), ct);
        if (post is null)
            return false;
        post.Retired = true;
        post.Published = false;
        post.UpdatedAt = Now;
        await repository.SaveAsync(post, ct);
        return true;
    }

    public async Task<IReadOnlyList<AdminFeedStoryDto>> ListStoriesAsync(CancellationToken ct) =>
        (await repository.GetAllAsync<FeedStoryEntity>(FeedStoryEntity.GetPk(), ct))
            .OrderByDescending(s => s.PublishAt).ThenBy(s => s.SortOrder).ThenBy(s => s.Id, StringComparer.Ordinal)
            .Select(s => s.ToAdminDto()).ToList();

    public async Task<(CatalogWriteOutcome Outcome, AdminFeedStoryDto? Story, IReadOnlyList<string> MissingProductIds)> UpsertStoryAsync(FeedStoryInput input, CancellationToken ct)
    {
        var productId = NullIfEmpty(input.ProductId);
        var missing = await MissingProductsAsync(productId is null ? [] : [productId], ct);
        if (missing.Count > 0)
            return (CatalogWriteOutcome.ProductNotFound, null, missing);

        var now = Now;
        var existing = await repository.GetAsync<FeedStoryEntity>(FeedStoryEntity.GetPk(), FeedStoryEntity.GetSk(input.Id), ct);
        var story = new FeedStoryEntity
        {
            Id = input.Id,
            Segment = input.Segment,
            Author = new FeedStoryAuthor { Name = LocalizedText.Normalize(input.Author!.Name), ImageUrl = NullIfEmpty(input.Author.ImageUrl) },
            ImageUrl = input.ImageUrl!.Trim(),
            Headline = LocalizedText.Normalize(input.Headline),
            ProductId = productId,
            PublishAt = FeedRules.Utc(input.PublishAt),
            ExpiresAt = input.ExpiresAt is { } expires ? FeedRules.Utc(expires) : null,
            SortOrder = input.SortOrder,
            Published = input.Published && !input.Retired,
            Retired = input.Retired,
            CreatedAt = existing?.CreatedAt ?? now,
            UpdatedAt = now,
        };
        await repository.SaveAsync(story, ct);
        return (existing is null ? CatalogWriteOutcome.Created : CatalogWriteOutcome.Updated, story.ToAdminDto(), []);
    }

    public async Task<bool> RetireStoryAsync(string storyId, CancellationToken ct)
    {
        var story = await repository.GetAsync<FeedStoryEntity>(FeedStoryEntity.GetPk(), FeedStoryEntity.GetSk(storyId), ct);
        if (story is null)
            return false;
        story.Retired = true;
        story.Published = false;
        story.UpdatedAt = Now;
        await repository.SaveAsync(story, ct);
        return true;
    }

    private async Task<long> LikeCountAsync(string postId, CancellationToken ct) =>
        Math.Max(0, (await repository.GetAsync<FeedPostStatsEntity>(FeedPostStatsEntity.GetPk(), FeedPostStatsEntity.GetSk(postId), ct))?.LikeCount ?? 0);

    private async Task<List<string>> MissingProductsAsync(IEnumerable<string> productIds, CancellationToken ct)
    {
        var missing = new List<string>();
        foreach (var id in productIds.Distinct())
        {
            if (await catalog.GetProductAsync(id, ct) is null)
                missing.Add(id);
        }
        return missing;
    }

    private static string? NullIfEmpty(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}

/// <summary>Projection used for existence checks.</summary>
internal sealed class FeedKeyProbe
{
    [System.Text.Json.Serialization.JsonPropertyName("pk")] public string? Pk { get; set; }
}
