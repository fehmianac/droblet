using System.Globalization;
using Domain.Domain;
using Domain.Entity;
using Domain.Enum;
using Domain.Extensions;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Infrastructure.Services.Social;

/// <summary>
/// E9. Every read of another tenant goes through <see cref="PersonContext.CanView"/> (= VisibilityPolicy) with the
/// follow and block records read on that request — nothing is cached, so visibility changes, unfollow and block apply
/// immediately. A refused read is indistinguishable from "does not exist" (callers answer 404).
/// Looks, items and trips come from <see cref="IClosetReader"/> (wardrobe slice).
/// </summary>
public sealed class SocialService(
    IRepository repository,
    IClosetReader closet,
    ICatalogService catalog,
    IRateLimiter rateLimiter,
    IOptionsMonitor<SocialOptions> options,
    TimeProvider timeProvider,
    ILogger<SocialService> logger) : ISocialService
{
    private const int RatingRetries = 5;
    private const int FeedParallelism = 10;

    private DateTime Now => timeProvider.GetUtcNow().UtcDateTime;

    // ── Resolution ──────────────────────────────────────────────────────────────────────────────────────────────

    private async Task<TenantEntity?> TenantByHandleAsync(string handle, CancellationToken ct)
    {
        var normalized = HandleRules.Normalize(handle ?? "");
        if (!HandleRules.IsValidFormat(normalized))
            return null;
        var entry = await repository.GetAsync<HandleEntity>(HandleEntity.GetPk(), HandleEntity.GetSk(normalized), ct);
        if (entry is null)
            return null;
        var tenant = await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(entry.TenantId), ct);
        // A stale directory row must never resolve to somebody else.
        return tenant is not null && tenant.Handle == normalized ? tenant : null;
    }

    private async Task<bool> ExistsAsync(string pk, string sk, CancellationToken ct) =>
        await repository.GetAsync<KeyProbe>(pk, sk, ct) is not null;

    private async Task<bool> IsBlockedEitherWayAsync(string a, string b, CancellationToken ct) =>
        await ExistsAsync(BlockEntity.GetPk(a), BlockEntity.GetSk(b), ct)
        || await ExistsAsync(BlockEntity.GetPk(b), BlockEntity.GetSk(a), ct);

    private Task<bool> FollowsAsync(string follower, string followee, CancellationToken ct) =>
        ExistsAsync(FollowingEntity.GetPk(follower), FollowingEntity.GetSk(followee), ct);

    public async Task<PersonContext?> ResolveAsync(string viewerTenantId, string handle, CancellationToken ct)
    {
        var owner = await TenantByHandleAsync(handle, ct);
        if (owner is null)
            return null;
        if (owner.Id == viewerTenantId)
            return new PersonContext(viewerTenantId, owner, false, false, false);
        if (await IsBlockedEitherWayAsync(viewerTenantId, owner.Id, ct))
            return null;

        var context = new PersonContext(viewerTenantId, owner,
            await FollowsAsync(viewerTenantId, owner.Id, ct),
            await FollowsAsync(owner.Id, viewerTenantId, ct),
            Blocked: false);
        return context.CanView(VisibleResource.ProfileCard) ? context : null;
    }

    /// <summary>The viewer's relations, loaded once for list endpoints.</summary>
    private sealed record Relations(HashSet<string> Following, HashSet<string> Followers, HashSet<string> Blocked);

    private async Task<Relations> RelationsAsync(string viewerTenantId, CancellationToken ct)
    {
        async Task<HashSet<string>> Sks(string pk) =>
            (await repository.GetKeysAsync(pk, ct)).Select(k => k.Sk).ToHashSet(StringComparer.Ordinal);

        var blocked = await Sks(BlockEntity.GetPk(viewerTenantId));
        blocked.UnionWith(await Sks(BlockedByEntity.GetPk(viewerTenantId)));
        return new Relations(await Sks(FollowingEntity.GetPk(viewerTenantId)), await Sks(FollowerEntity.GetPk(viewerTenantId)), blocked);
    }

    private static PersonContext ContextOf(string viewerTenantId, TenantEntity owner, Relations relations) =>
        new(viewerTenantId, owner, relations.Following.Contains(owner.Id), relations.Followers.Contains(owner.Id), relations.Blocked.Contains(owner.Id));

    private async Task<IReadOnlyList<StyleTag>> StyleTagsAsync(string tenantId, CancellationToken ct) =>
        (await repository.GetAsync<StyleProfileEntity>(StyleProfileEntity.GetPk(tenantId), StyleProfileEntity.GetSk(), ct))?.StyleTags ?? [];

    /// <summary>Cards for the given tenants, in the given order, dropping anyone the viewer may not see.</summary>
    private async Task<List<PersonCardDto>> CardsAsync(string viewerTenantId, IReadOnlyList<string> tenantIds, Relations relations, CancellationToken ct)
    {
        var ids = tenantIds.Where(id => id != viewerTenantId).Distinct().ToList();
        if (ids.Count == 0)
            return [];

        var tenants = (await repository.BatchGetAsync(ids.Select(id => new TenantEntity { Id = id }).ToList(), ct)).ToDictionary(t => t.Id);
        var styles = (await repository.BatchGetAsync(ids.Select(id => new StyleProfileEntity { TenantId = id }).ToList(), ct)).ToDictionary(s => s.TenantId);
        var myTags = await StyleTagsAsync(viewerTenantId, ct);

        var cards = new List<PersonCardDto>();
        foreach (var id in ids)
        {
            if (!tenants.TryGetValue(id, out var tenant) || string.IsNullOrEmpty(tenant.Handle))
                continue;
            var context = ContextOf(viewerTenantId, tenant, relations);
            if (!context.CanView(VisibleResource.ProfileCard))
                continue;
            var tags = styles.GetValueOrDefault(id)?.StyleTags ?? [];
            cards.Add(new PersonCardDto(tenant.Handle, tenant.DisplayName, tags, StyleMatchRules.Percent(myTags, tags), context.ViewerFollowsOwner, context.OwnerFollowsViewer));
        }
        return cards;
    }

    // ── Discovery ───────────────────────────────────────────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<PersonCardDto>> SearchAsync(string viewerTenantId, string query, CancellationToken ct)
    {
        var prefix = HandleRules.Normalize(query ?? "");
        if (prefix.Length < 2 || prefix.Length > HandleRules.MaxLength)
            return [];

        var (handles, _, _) = await repository.GetPagedAsync<HandleEntity>(HandleEntity.GetPk(), SkOperator.BeginsWith, prefix, null, 100, ct);
        var ordered = handles.OrderBy(h => h.Handle.Length).ThenBy(h => h.Handle, StringComparer.Ordinal).Select(h => h.TenantId).ToList();
        var cards = await CardsAsync(viewerTenantId, ordered, await RelationsAsync(viewerTenantId, ct), ct);
        return cards.Take(options.CurrentValue.SearchPageSize).ToList();
    }

    public async Task<IReadOnlyList<PersonCardDto>> SuggestedAsync(string viewerTenantId, CancellationToken ct)
    {
        var viewer = await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(viewerTenantId), ct);
        var segment = viewer?.Segment ?? Segment.Women;
        var limits = options.CurrentValue;

        // Only PublicProfileIndex accounts are candidates: a private or followers-only closet never becomes a match signal.
        var (candidates, _, _) = await repository.GetPagedAsync<PublicProfileIndexEntity>(
            PublicProfileIndexEntity.GetPk(segment), null, Math.Clamp(limits.SuggestedCandidateLimit, 1, 100), ct);
        var relations = await RelationsAsync(viewerTenantId, ct);
        var ids = candidates.Select(c => c.PublicTenantId).Where(id => !relations.Following.Contains(id)).ToList();

        var cards = await CardsAsync(viewerTenantId, ids, relations, ct);
        return cards
            .OrderByDescending(c => c.StyleMatchPercent).ThenBy(c => c.Handle, StringComparer.Ordinal)
            .Take(limits.SuggestedPageSize)
            .ToList();
    }

    public async Task<PersonProfileDto?> GetProfileAsync(string viewerTenantId, string handle, CancellationToken ct)
    {
        var context = await ResolveAsync(viewerTenantId, handle, ct);
        if (context is null)
            return null;

        var owner = context.Owner;
        var tags = await StyleTagsAsync(owner.Id, ct);
        var match = context.IsSelf ? 100 : StyleMatchRules.Percent(await StyleTagsAsync(viewerTenantId, ct), tags);
        var canItems = context.CanView(VisibleResource.Item);
        var canLooks = context.CanView(VisibleResource.Look);

        return new PersonProfileDto(
            owner.Handle!, owner.DisplayName, tags, match, context.IsSelf, context.ViewerFollowsOwner, context.OwnerFollowsViewer,
            owner.ClosetVisibility,
            ClosetLocked: !canItems || !canLooks,
            ItemCount: canItems ? (await closet.GetItemsAsync(owner.Id, ct)).Count : null,
            LookCount: canLooks ? (await closet.GetLooksAsync(owner.Id, ct)).Count : null,
            FollowerCount: (await repository.GetKeysAsync(FollowerEntity.GetPk(owner.Id), ct)).Count,
            FollowingCount: (await repository.GetKeysAsync(FollowingEntity.GetPk(owner.Id), ct)).Count);
    }

    public async Task<IReadOnlyList<SocialLookDto>?> GetLooksAsync(string viewerTenantId, string handle, CancellationToken ct)
    {
        var context = await ResolveAsync(viewerTenantId, handle, ct);
        if (context is null || !context.CanView(VisibleResource.Look))
            return null;
        return await MapLooksAsync(viewerTenantId, context.Owner, await closet.GetLooksAsync(context.Owner.Id, ct), context.CanView(VisibleResource.LookRating), ct);
    }

    public async Task<IReadOnlyList<ClosetItemDto>?> GetItemsAsync(string viewerTenantId, string handle, CancellationToken ct)
    {
        var context = await ResolveAsync(viewerTenantId, handle, ct);
        if (context is null || !context.CanView(VisibleResource.Item))
            return null;
        return (await closet.GetItemsAsync(context.Owner.Id, ct)).Select(i => i.ToDto()).ToList();
    }

    public async Task<IReadOnlyList<SocialTripDto>?> GetTripsAsync(string viewerTenantId, string handle, CancellationToken ct)
    {
        var context = await ResolveAsync(viewerTenantId, handle, ct);
        // PastTrip is never shared until the owner decides (A-6): only the owner gets this tab.
        if (context is null || !context.CanView(VisibleResource.PastTrip))
            return null;
        return (await closet.GetCompletedTripsAsync(context.Owner.Id, ct)).Select(t => new SocialTripDto(t.Id, t.City, t.Month)).ToList();
    }

    private async Task<List<SocialLookDto>> MapLooksAsync(string viewerTenantId, TenantEntity owner, IReadOnlyList<ClosetLook> looks, bool ratingsVisible, CancellationToken ct)
    {
        if (looks.Count == 0)
            return [];

        var summaries = ratingsVisible
            ? (await repository.BatchGetAsync(looks.Select(l => new LookRatingSummaryEntity { TenantId = owner.Id, LookId = l.Id }).ToList(), ct)).ToDictionary(s => s.LookId)
            : [];
        var mine = owner.Id == viewerTenantId
            ? []
            : (await repository.BatchGetAsync(looks.Select(l => new RatingGivenEntity { TenantId = viewerTenantId, OwnerTenantId = owner.Id, LookId = l.Id }).ToList(), ct)).ToDictionary(r => r.LookId);
        var saved = (await repository.BatchGetAsync(looks.Select(l => new SavedLookEntity { TenantId = viewerTenantId, OwnerTenantId = owner.Id, LookId = l.Id }).ToList(), ct))
            .Select(s => s.LookId).ToHashSet(StringComparer.Ordinal);

        var result = new List<SocialLookDto>(looks.Count);
        foreach (var look in looks)
        {
            var pieces = new List<SocialLookPieceDto>(look.Pieces.Count);
            foreach (var piece in look.Pieces)
            {
                var product = piece.ProductId is null ? null : (await catalog.ToDtosAsync([piece.ProductId], ct)).FirstOrDefault();
                pieces.Add(new SocialLookPieceDto(piece.Slot, piece.ItemId, piece.ProductId, piece.Name ?? product?.Name, piece.ImageUrl ?? product?.Images.FirstOrDefault(), product));
            }

            var summary = summaries.GetValueOrDefault(look.Id);
            result.Add(new SocialLookDto(look.Id, owner.Handle ?? "", owner.DisplayName, look.Name, look.Occasion, look.CreatedAt, pieces,
                new LookRatingDto(Average(summary), summary?.Count ?? 0, mine.GetValueOrDefault(look.Id)?.Score),
                saved.Contains(look.Id)));
        }
        return result;
    }

    private static double? Average(LookRatingSummaryEntity? summary) =>
        summary is null || summary.Count <= 0 ? null : Math.Round((double)summary.Sum / summary.Count, 1, MidpointRounding.AwayFromZero);

    // ── Feed ────────────────────────────────────────────────────────────────────────────────────────────────────

    public async Task<PagedDto<SocialLookDto>> GetFeedAsync(string viewerTenantId, string? pageToken, CancellationToken ct)
    {
        var limits = options.CurrentValue;
        var relations = await RelationsAsync(viewerTenantId, ct);
        var followees = relations.Following.Where(id => !relations.Blocked.Contains(id)).Take(limits.MaxFollowing).ToList();
        if (followees.Count == 0)
            return new PagedDto<SocialLookDto>([], null);

        var tenants = await repository.BatchGetAsync(followees.Select(id => new TenantEntity { Id = id }).ToList(), ct);
        var visible = tenants
            .Where(t => !string.IsNullOrEmpty(t.Handle) && ContextOf(viewerTenantId, t, relations).CanView(VisibleResource.Look))
            .ToList();

        // Read-time merge of the followees' looks (phase 1 scale). A fan-out-on-write feed can replace this behind the same endpoint.
        var entries = new List<(TenantEntity Owner, ClosetLook Look)>();
        foreach (var chunk in visible.Chunk(FeedParallelism))
        {
            var batches = await Task.WhenAll(chunk.Select(async owner => (owner, looks: await closet.GetLooksAsync(owner.Id, ct))));
            entries.AddRange(batches.SelectMany(b => b.looks.Select(l => (b.owner, l))));
        }

        var ordered = entries
            .OrderByDescending(e => e.Look.CreatedAt).ThenByDescending(e => e.Look.Id, StringComparer.Ordinal).ThenBy(e => e.Owner.Id, StringComparer.Ordinal)
            .ToList();

        var start = 0;
        if (CatalogRules.DecodeToken(pageToken) is { } cursor)
        {
            var index = ordered.FindIndex(e => FeedCursor(e.Owner.Id, e.Look) == cursor);
            if (index >= 0)
            {
                start = index + 1;
            }
            else if (long.TryParse(cursor.Split('|')[0], NumberStyles.None, CultureInfo.InvariantCulture, out var ticks))
            {
                // The cursor's look was deleted or hidden: continue with everything older than it.
                start = ordered.FindIndex(e => e.Look.CreatedAt.Ticks < ticks);
                if (start < 0) start = ordered.Count;
            }
        }

        var page = ordered.Skip(start).Take(limits.FeedPageSize).ToList();
        var items = new List<SocialLookDto>(page.Count);
        foreach (var group in page.GroupBy(e => e.Owner.Id))
        {
            var owner = group.First().Owner;
            items.AddRange(await MapLooksAsync(viewerTenantId, owner, group.Select(e => e.Look).ToList(), ratingsVisible: true, ct));
        }
        items = items.OrderByDescending(i => i.CreatedAt).ThenByDescending(i => i.Id, StringComparer.Ordinal).ToList();

        var next = start + page.Count < ordered.Count && page.Count > 0
            ? CatalogRules.EncodeToken(FeedCursor(page[^1].Owner.Id, page[^1].Look))
            : null;
        return new PagedDto<SocialLookDto>(items, next);
    }

    private static string FeedCursor(string ownerTenantId, ClosetLook look) =>
        $"{look.CreatedAt.Ticks.ToString(CultureInfo.InvariantCulture)}|{look.Id}|{ownerTenantId}";

    // ── Follow ──────────────────────────────────────────────────────────────────────────────────────────────────

    public async Task<SocialOutcome> FollowAsync(string viewerTenantId, string handle, CancellationToken ct)
    {
        var context = await ResolveAsync(viewerTenantId, handle, ct);
        if (context is null)
            return SocialOutcome.NotFound;
        if (context.IsSelf)
            return SocialOutcome.Self;
        if (context.ViewerFollowsOwner)
            return SocialOutcome.Ok;
        if ((await repository.GetKeysAsync(FollowingEntity.GetPk(viewerTenantId), ct)).Count >= options.CurrentValue.MaxFollowing)
            return SocialOutcome.LimitReached;

        var now = Now;
        await repository.TransactWriteAsync(
        [
            TransactWriteOperation.Put(new FollowingEntity { TenantId = viewerTenantId, FolloweeTenantId = context.Owner.Id, CreatedAt = now }),
            TransactWriteOperation.Put(new FollowerEntity { TenantId = context.Owner.Id, FollowerTenantId = viewerTenantId, CreatedAt = now }),
        ], ct);
        return SocialOutcome.Ok;
    }

    public async Task<SocialOutcome> UnfollowAsync(string viewerTenantId, string handle, CancellationToken ct)
    {
        // No visibility gate: you can always stop following, even after the other side went private.
        var owner = await TenantByHandleAsync(handle, ct);
        if (owner is null)
            return SocialOutcome.NotFound;
        await repository.TransactWriteAsync(FollowEdgeDeletes(viewerTenantId, owner.Id), ct);
        return SocialOutcome.Ok;
    }

    private static List<TransactWriteOperation> FollowEdgeDeletes(string follower, string followee) =>
    [
        TransactWriteOperation.Delete(FollowingEntity.GetPk(follower), FollowingEntity.GetSk(followee)),
        TransactWriteOperation.Delete(FollowerEntity.GetPk(followee), FollowerEntity.GetSk(follower)),
    ];

    public async Task<IReadOnlyList<PersonCardDto>> GetFollowersAsync(string viewerTenantId, CancellationToken ct)
    {
        var relations = await RelationsAsync(viewerTenantId, ct);
        return await CardsAsync(viewerTenantId, relations.Followers.Order(StringComparer.Ordinal).ToList(), relations, ct);
    }

    public async Task<IReadOnlyList<PersonCardDto>> GetFollowingAsync(string viewerTenantId, CancellationToken ct)
    {
        var relations = await RelationsAsync(viewerTenantId, ct);
        return await CardsAsync(viewerTenantId, relations.Following.Order(StringComparer.Ordinal).ToList(), relations, ct);
    }

    // ── Rating / save ───────────────────────────────────────────────────────────────────────────────────────────

    private async Task<(SocialOutcome Outcome, PersonContext? Context)> VisibleLookAsync(string viewerTenantId, string handle, string lookId, CancellationToken ct)
    {
        var context = await ResolveAsync(viewerTenantId, handle, ct);
        if (context is null || !context.CanView(VisibleResource.Look))
            return (SocialOutcome.NotFound, null);
        if (await closet.GetLookAsync(context.Owner.Id, lookId, ct) is null)
            return (SocialOutcome.NotFound, null);
        return (SocialOutcome.Ok, context);
    }

    public async Task<(SocialOutcome Outcome, LookRatingDto? Rating)> RateAsync(string viewerTenantId, string handle, string lookId, int score, CancellationToken ct)
    {
        var (outcome, context) = await VisibleLookAsync(viewerTenantId, handle, lookId, ct);
        if (context is null)
            return (outcome, null);
        if (context.IsSelf)
            return (SocialOutcome.Self, null);

        var ownerId = context.Owner.Id;
        for (var attempt = 0; attempt < RatingRetries; attempt++)
        {
            var now = Now;
            var existing = await repository.GetAsync<RatingEntity>(RatingEntity.GetPk(ownerId), RatingEntity.GetSk(lookId, viewerTenantId), ct);
            var summary = await repository.GetAsync<LookRatingSummaryEntity>(LookRatingSummaryEntity.GetPk(ownerId), LookRatingSummaryEntity.GetSk(lookId), ct)
                          ?? new LookRatingSummaryEntity { TenantId = ownerId, LookId = lookId };

            if (existing?.Score == score)
                return (SocialOutcome.Ok, new LookRatingDto(Average(summary), summary.Count, score));

            // One rating per rater per look: a new score replaces the old one in the sum.
            summary.Sum += score - (existing?.Score ?? 0);
            summary.Count += existing is null ? 1 : 0;
            summary.UpdatedAt = now;

            var result = await repository.TransactWriteAsync(
            [
                TransactWriteOperation.PutVersioned(summary),
                TransactWriteOperation.Put(new RatingEntity { TenantId = ownerId, LookId = lookId, RaterTenantId = viewerTenantId, Score = score, UpdatedAt = now }),
                TransactWriteOperation.Put(new RatingGivenEntity { TenantId = viewerTenantId, OwnerTenantId = ownerId, LookId = lookId, Score = score, UpdatedAt = now }),
                TransactWriteOperation.Put(new RatingDigestEntity { Day = WeeklyEditRules.Format(DateOnly.FromDateTime(now)), OwnerTenantId = ownerId, CreatedAt = now }),
            ], ct);
            if (result.Applied)
                return (SocialOutcome.Ok, new LookRatingDto(Average(summary), summary.Count, score));
        }

        throw new InvalidOperationException("Rating summary could not be updated after retries.");
    }

    public async Task<SocialOutcome> SaveLookAsync(string viewerTenantId, string handle, string lookId, CancellationToken ct)
    {
        var (outcome, context) = await VisibleLookAsync(viewerTenantId, handle, lookId, ct);
        if (context is null)
            return outcome;
        if (context.IsSelf)
            return SocialOutcome.Self; // own looks live in the lookbook
        await repository.TransactWriteAsync(
        [
            TransactWriteOperation.Put(new SavedLookEntity { TenantId = viewerTenantId, OwnerTenantId = context.Owner.Id, LookId = lookId, SavedAt = Now }),
            TransactWriteOperation.Put(new SavedByEntity { TenantId = context.Owner.Id, LookId = lookId, SaverTenantId = viewerTenantId }),
        ], ct);
        return SocialOutcome.Ok;
    }

    public async Task<SocialOutcome> UnsaveLookAsync(string viewerTenantId, string handle, string lookId, CancellationToken ct)
    {
        var owner = await TenantByHandleAsync(handle, ct);
        if (owner is null)
            return SocialOutcome.NotFound;
        await repository.TransactWriteAsync(
        [
            TransactWriteOperation.Delete(SavedLookEntity.GetPk(viewerTenantId), SavedLookEntity.GetSk(owner.Id, lookId)),
            TransactWriteOperation.Delete(SavedByEntity.GetPk(owner.Id), SavedByEntity.GetSk(lookId, viewerTenantId)),
        ], ct);
        return SocialOutcome.Ok;
    }

    public async Task<IReadOnlyList<SocialLookDto>> GetSavedLooksAsync(string viewerTenantId, CancellationToken ct)
    {
        var saved = await repository.GetAllAsync<SavedLookEntity>(SavedLookEntity.GetPk(viewerTenantId), ct);
        if (saved.Count == 0)
            return [];

        var relations = await RelationsAsync(viewerTenantId, ct);
        var result = new List<(DateTime SavedAt, SocialLookDto Look)>();
        foreach (var group in saved.GroupBy(s => s.OwnerTenantId))
        {
            var owner = await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(group.Key), ct);
            if (owner is null)
            {
                // Owner deleted their account: drop the dangling pointers.
                await repository.BatchDeleteKeysAsync(group.Select(s => (s.Pk, s.Sk)).ToList(), ct);
                continue;
            }
            var context = ContextOf(viewerTenantId, owner, relations);
            if (!context.CanView(VisibleResource.Look))
                continue; // hidden for now (private / unfollowed / blocked): keep the row, show nothing

            var looks = new List<ClosetLook>();
            foreach (var row in group)
            {
                if (await closet.GetLookAsync(owner.Id, row.LookId, ct) is { } look)
                    looks.Add(look);
                else
                    await repository.DeleteAsync(row.Pk, row.Sk, ct);
            }
            var savedAt = group.ToDictionary(s => s.LookId, s => s.SavedAt);
            result.AddRange((await MapLooksAsync(viewerTenantId, owner, looks, context.CanView(VisibleResource.LookRating), ct))
                .Select(dto => (savedAt.GetValueOrDefault(dto.Id), dto)));
        }
        return result.OrderByDescending(r => r.SavedAt).Select(r => r.Look).ToList();
    }

    // ── Block / report ──────────────────────────────────────────────────────────────────────────────────────────

    public async Task<SocialOutcome> BlockAsync(string viewerTenantId, string handle, CancellationToken ct)
    {
        var target = await TenantByHandleAsync(handle, ct);
        if (target is null)
            return SocialOutcome.NotFound;
        if (target.Id == viewerTenantId)
            return SocialOutcome.Self;

        var now = Now;
        var operations = new List<TransactWriteOperation>
        {
            TransactWriteOperation.Put(new BlockEntity { TenantId = viewerTenantId, BlockedTenantId = target.Id, CreatedAt = now }),
            TransactWriteOperation.Put(new BlockedByEntity { TenantId = target.Id, BlockerTenantId = viewerTenantId, CreatedAt = now }),
        };
        // A block ends the relationship in both directions.
        operations.AddRange(FollowEdgeDeletes(viewerTenantId, target.Id));
        operations.AddRange(FollowEdgeDeletes(target.Id, viewerTenantId));
        await repository.TransactWriteAsync(operations, ct);
        logger.LogInformation("Tenant {TenantId} blocked {TargetTenantId}", viewerTenantId, target.Id);
        return SocialOutcome.Ok;
    }

    public async Task<SocialOutcome> UnblockAsync(string viewerTenantId, string handle, CancellationToken ct)
    {
        var target = await TenantByHandleAsync(handle, ct);
        if (target is null)
            return SocialOutcome.NotFound;
        await repository.TransactWriteAsync(
        [
            TransactWriteOperation.Delete(BlockEntity.GetPk(viewerTenantId), BlockEntity.GetSk(target.Id)),
            TransactWriteOperation.Delete(BlockedByEntity.GetPk(target.Id), BlockedByEntity.GetSk(viewerTenantId)),
        ], ct);
        return SocialOutcome.Ok;
    }

    public async Task<IReadOnlyList<PersonCardDto>> GetBlockedAsync(string viewerTenantId, CancellationToken ct)
    {
        var blocks = await repository.GetAllAsync<BlockEntity>(BlockEntity.GetPk(viewerTenantId), ct);
        if (blocks.Count == 0)
            return [];
        var tenants = await repository.BatchGetAsync(blocks.Select(b => new TenantEntity { Id = b.BlockedTenantId }).ToList(), ct);
        // Only what is needed to recognise and unblock: handle + name.
        return tenants.Where(t => !string.IsNullOrEmpty(t.Handle))
            .OrderBy(t => t.Handle, StringComparer.Ordinal)
            .Select(t => new PersonCardDto(t.Handle!, t.DisplayName, [], 0, false, false))
            .ToList();
    }

    public async Task<(SocialOutcome Outcome, string? ReportId)> ReportAsync(
        string viewerTenantId, string handle, ReportTargetKind targetKind, string? targetId, ReportReason reason, string? note, CancellationToken ct)
    {
        var target = await TenantByHandleAsync(handle, ct);
        if (target is null || await ExistsAsync(BlockedByEntity.GetPk(viewerTenantId), BlockedByEntity.GetSk(target.Id), ct))
            return (SocialOutcome.NotFound, null);
        if (target.Id == viewerTenantId)
            return (SocialOutcome.Self, null);
        if (!await rateLimiter.TryAcquireAsync("report-tenant", viewerTenantId, options.CurrentValue.ReportsPerDay, TimeSpan.FromDays(1), ct))
            return (SocialOutcome.RateLimited, null);

        var now = Now;
        var report = new ReportEntity
        {
            Id = Ulid.New(now),
            Status = ReportStatus.Open,
            ReporterTenantId = viewerTenantId,
            TargetTenantId = target.Id,
            TargetKind = targetKind,
            TargetId = string.IsNullOrWhiteSpace(targetId) ? null : targetId,
            Reason = reason,
            Note = string.IsNullOrWhiteSpace(note) ? null : note.Trim(),
            CreatedAt = now,
        };
        await repository.TransactWriteAsync(
        [
            TransactWriteOperation.Put(report),
            TransactWriteOperation.Put(new ReportFiledEntity { TenantId = viewerTenantId, ReportId = report.Id, CreatedAt = now }),
            TransactWriteOperation.Put(new ReportReceivedEntity { TenantId = target.Id, ReportId = report.Id, CreatedAt = now }),
        ], ct);
        logger.LogInformation("Report {ReportId} filed by {TenantId} against {TargetTenantId} ({Reason})", report.Id, viewerTenantId, target.Id, reason);
        return (SocialOutcome.Ok, report.Id);
    }

    // ── Moderation ──────────────────────────────────────────────────────────────────────────────────────────────

    public async Task<PagedDto<ModerationReportDto>> ListReportsAsync(ReportStatus status, string? pageToken, int? limit, CancellationToken ct)
    {
        var (reports, next, _) = await repository.GetPagedAsync<ReportEntity>(ReportEntity.GetPk(status), pageToken, limit ?? 50, ct);
        var items = new List<ModerationReportDto>(reports.Count);
        foreach (var report in reports)
            items.Add(await ToDtoAsync(report, ct));
        return new PagedDto<ModerationReportDto>(items, next);
    }

    public async Task<ModerationReportDto?> ResolveReportAsync(string reportId, ReportResolution resolution, string? note, string adminUserId, CancellationToken ct)
    {
        var open = await repository.GetAsync<ReportEntity>(ReportEntity.GetPk(ReportStatus.Open), ReportEntity.GetSk(reportId), ct);
        if (open is null)
        {
            var resolved = await repository.GetAsync<ReportEntity>(ReportEntity.GetPk(ReportStatus.Resolved), ReportEntity.GetSk(reportId), ct);
            return resolved is null ? null : await ToDtoAsync(resolved, ct);
        }

        var openPk = open.Pk;
        open.Status = ReportStatus.Resolved;
        open.Resolution = resolution;
        open.ResolutionNote = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
        open.ResolvedByUserId = adminUserId;
        open.ResolvedAt = Now;
        await repository.TransactWriteAsync(
        [
            TransactWriteOperation.Delete(openPk, ReportEntity.GetSk(reportId)),
            TransactWriteOperation.Put(open),
        ], ct);
        logger.LogInformation("Report {ReportId} resolved as {Resolution} by admin {UserId}", reportId, resolution, adminUserId);
        return await ToDtoAsync(open, ct);
    }

    private async Task<ModerationReportDto> ToDtoAsync(ReportEntity report, CancellationToken ct)
    {
        async Task<string?> HandleOf(string? tenantId) => tenantId is null
            ? null
            : (await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(tenantId), ct))?.Handle;

        return new ModerationReportDto(report.Id, report.Status, report.ReporterTenantId, await HandleOf(report.ReporterTenantId),
            report.TargetTenantId, await HandleOf(report.TargetTenantId), report.TargetKind, report.TargetId, report.Reason, report.Note,
            report.CreatedAt, report.Resolution, report.ResolutionNote, report.ResolvedByUserId, report.ResolvedAt);
    }
}

/// <summary>Projection used for existence checks.</summary>
internal sealed class KeyProbe
{
    [System.Text.Json.Serialization.JsonPropertyName("pk")] public string? Pk { get; set; }
}
