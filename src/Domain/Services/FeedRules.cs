using System.Globalization;
using Domain.Domain;
using Domain.Entity;
using Domain.Entity.Base;
using Domain.Enum;
using Domain.Validation;

namespace Domain.Services;

/// <summary>
/// Akış visibility, order, paging and "you already own something similar" (F1), and the shared looks of users (F2): ids,
/// the 1-in-3 mix and its cursor, similar products, the weekly-edit fallback — pure, shared by the services and tests.
/// </summary>
public static class FeedRules
{
    /// <summary>Published, not retired and its publish time has come.</summary>
    public static bool IsLive(FeedPostEntity post, DateTime nowUtc) => post is { Published: true, Retired: false } && post.PublishAt <= nowUtc;

    /// <summary>
    /// The post can be tried on as its photograph (owner decision 2026-11-23): it was split into pieces and has an image.
    /// Used only when the post has no available product — a post with products is always tried on as those products.
    /// </summary>
    public static bool HasOutfitPhoto(FeedPostEntity post) => post.Pieces.Count > 0 && !string.IsNullOrWhiteSpace(post.ImageUrls.FirstOrDefault());

    /// <summary>
    /// FeedPostDto.canTryOn of an editor post: an available product, or — without one — its photograph (pieces + an image).
    /// The photograph path is a photo try-on, which is never for teens (TeenRules.IsOutfitPhotoTarget).
    /// </summary>
    public static bool CanTryOn(FeedPostEntity post, bool hasAvailableProduct, bool viewerIsTeen) =>
        hasAvailableProduct || (!viewerIsTeen && HasOutfitPhoto(post));

    /// <summary>
    /// "Looklarıma ekle" (owner decision 2026-11-23). Which outfit slot each piece of a post takes when the post is saved
    /// "with its pieces" (index in the post's piece list → slot): the category's default slot, one piece per slot — the first
    /// piece keeps a contested slot, a dress takes the top and closes the bottom (the same rule as an outfit import). A piece
    /// without a slot is still added to the wardrobe.
    /// </summary>
    public static IReadOnlyDictionary<int, OutfitSlot> LookSlots(IReadOnlyList<ItemCategory> categories)
    {
        var pieces = categories
            .Select((category, index) => new OutfitImportOccurrence { Ref = index.ToString("D3", CultureInfo.InvariantCulture), Category = category })
            .ToList();
        OutfitImportRules.AssignSlots(pieces, p => p.Category);
        return pieces.Where(p => p.Slot is not null).ToDictionary(p => int.Parse(p.Ref, CultureInfo.InvariantCulture), p => p.Slot!.Value);
    }

    /// <summary>
    /// Whether an editor post can be saved into the member's own looks: as inspiration it needs pieces and a photograph;
    /// with its pieces it needs at least <see cref="OutfitSlotRules.MinPieces"/> pieces that take a slot (a look's minimum).
    /// </summary>
    public static bool CanSaveAsLook(FeedPostEntity post, FeedLookMode mode) => mode == FeedLookMode.Inspiration
        ? HasOutfitPhoto(post)
        : LookSlots(post.Pieces.Select(p => p.Category).ToList()).Count >= OutfitSlotRules.MinPieces;

    /// <summary>The look a member already made of this post in this mode (inspiration looks and piece looks are told apart by their source).</summary>
    public static bool IsLookOf(LookEntity look, string postId, FeedLookMode mode) =>
        string.Equals(look.FeedPostId, postId, StringComparison.Ordinal) && (look.Source == LookSource.Inspiration) == (mode == FeedLookMode.Inspiration);

    /// <summary>The pieces of a post belong to its first image: the same URL = the same photograph.</summary>
    public static bool SamePhoto(string? firstImageUrl, string? otherFirstImageUrl) =>
        !string.IsNullOrWhiteSpace(firstImageUrl) && string.Equals(firstImageUrl.Trim(), otherFirstImageUrl?.Trim(), StringComparison.Ordinal);

    /// <summary>Published, not retired, inside its window [publishAt, expiresAt).</summary>
    public static bool IsActive(FeedStoryEntity story, DateTime nowUtc) =>
        story is { Published: true, Retired: false } && story.PublishAt <= nowUtc && (story.ExpiresAt is null || story.ExpiresAt > nowUtc);

    /// <summary>A post / story without a segment goes to everyone; otherwise only to users of that segment.</summary>
    public static bool Shows(Segment? contentSegment, Segment userSegment) => contentSegment is null || contentSegment == userSegment;

    /// <summary>Feed order: publishAt desc, then sortOrder asc, then id (stable).</summary>
    public static IOrderedEnumerable<FeedPostEntity> Order(IEnumerable<FeedPostEntity> posts) =>
        posts.OrderByDescending(p => p.PublishAt).ThenBy(p => p.SortOrder).ThenBy(p => p.Id, StringComparer.Ordinal);

    /// <summary>Story strip order: sortOrder asc (editors pin), then publishAt desc, then id.</summary>
    public static IOrderedEnumerable<FeedStoryEntity> Order(IEnumerable<FeedStoryEntity> stories) =>
        stories.OrderBy(s => s.SortOrder).ThenByDescending(s => s.PublishAt).ThenBy(s => s.Id, StringComparer.Ordinal);

    /// <summary>Opaque cursor of the last post of a page: "{publishAt ticks}|{sortOrder}|{id}".</summary>
    public static string Cursor(FeedPostEntity post) =>
        CatalogRules.EncodeToken(string.Create(CultureInfo.InvariantCulture, $"{post.PublishAt.Ticks}|{post.SortOrder}|{post.Id}"));

    /// <summary>
    /// One page of an already ordered list after <paramref name="pageToken"/>. The cursor is a position, not an index, so a
    /// post retired or added meanwhile never shifts the next page. An unreadable token starts from the top.
    /// </summary>
    public static (IReadOnlyList<FeedPostEntity> Page, string? Next) Page(IReadOnlyList<FeedPostEntity> ordered, string? pageToken, int pageSize)
    {
        var start = 0;
        if (CatalogRules.DecodeToken(pageToken)?.Split('|', 3) is [var ticksText, var sortText, var id]
            && long.TryParse(ticksText, NumberStyles.None, CultureInfo.InvariantCulture, out var ticks)
            && int.TryParse(sortText, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var sort))
        {
            start = ordered.Count;
            for (var i = 0; i < ordered.Count; i++)
            {
                if (IsAfter(ordered[i], ticks, sort, id))
                {
                    start = i;
                    break;
                }
            }
        }

        var size = Math.Max(1, pageSize);
        var page = ordered.Skip(start).Take(size).ToList();
        var next = page.Count > 0 && start + page.Count < ordered.Count ? Cursor(page[^1]) : null;
        return (page, next);
    }

    private static bool IsAfter(FeedPostEntity post, long ticks, int sortOrder, string id)
    {
        if (post.PublishAt.Ticks != ticks)
            return post.PublishAt.Ticks < ticks;
        if (post.SortOrder != sortOrder)
            return post.SortOrder > sortOrder;
        return string.CompareOrdinal(post.Id, id) > 0;
    }

    /// <summary>
    /// "Benzeri gardırobunda var". There is no server-side wardrobe ↔ product similarity yet (the edit screen's "hide what I
    /// own" is client-side and exact: an item added from that product), so: the same product (item.productId), or a piece of
    /// the same wardrobe category whose main colour is one of the product's colours.
    /// </summary>
    public static bool OwnsSimilar(ProductDto product, IReadOnlyList<ItemEntity> wardrobe) => OwnedItem(product, wardrobe) is not null;

    /// <summary>
    /// The wardrobe item behind ownedSimilar ("Kendi parçalarımla kur"): the item added from that very product when there is
    /// one, else the category + main-colour match. Deterministic: the newest item first (createdAt desc, then id desc).
    /// </summary>
    public static ItemEntity? OwnedItem(ProductDto product, IReadOnlyList<ItemEntity> wardrobe)
    {
        var newestFirst = wardrobe.OrderByDescending(i => i.CreatedAt).ThenByDescending(i => i.Id, StringComparer.Ordinal).ToList();
        return newestFirst.FirstOrDefault(i => string.Equals(i.ProductId, product.Id, StringComparison.Ordinal))
               ?? newestFirst.FirstOrDefault(i => i.ColorIds.Count > 0 && IsSimilar(product.Category, product.Colors, i.Category, i.ColorIds[0]));
    }

    /// <summary>The one wardrobe ↔ catalog similarity of Akış: same wardrobe category and the piece's main colour among the product's colours.</summary>
    public static bool IsSimilar(ProductCategory productCategory, IEnumerable<string> productColors, ItemCategory pieceCategory, string? pieceMainColor) =>
        pieceMainColor is { Length: > 0 }
        && CatalogRules.ItemCategoryOf(productCategory) == pieceCategory
        && productColors.Any(c => CatalogRules.NormalizeColor(c) == CatalogRules.NormalizeColor(pieceMainColor));

    /// <summary>Available and not owned (the buy button counts these).</summary>
    public static int BuyableCount(IEnumerable<FeedProductDto> products) => products.Count(p => p is { Available: true, OwnedSimilar: false });

    /// <summary>
    /// The occasion filter of GET v1/content/feed: one or more comma-separated wire names of Occasion (the app's "Davet" tab
    /// sends "dinner,wedding", owner decision 2026-11-22). Empty = no filter (null). False = any part unparsable.
    /// </summary>
    public static bool TryParseOccasions(string? value, out IReadOnlySet<Occasion>? occasions)
    {
        occasions = null;
        if (string.IsNullOrWhiteSpace(value))
            return true;
        var set = new HashSet<Occasion>();
        foreach (var part in value.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
        {
            if (int.TryParse(part, out _) || !System.Enum.TryParse<Occasion>(part, ignoreCase: true, out var parsed) || !System.Enum.IsDefined(parsed))
                return false;
            set.Add(parsed);
        }
        if (set.Count == 0)
            return false;
        occasions = set;
        return true;
    }

    /// <summary>Stored times are UTC; an unspecified kind from a body is read as UTC.</summary>
    public static DateTime Utc(DateTime value) => value.Kind switch
    {
        DateTimeKind.Utc => value,
        DateTimeKind.Local => value.ToUniversalTime(),
        _ => DateTime.SpecifyKind(value, DateTimeKind.Utc),
    };

    // ── Akış F2: shared looks of users ──────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Ids of user posts and of the weekly-edit fallback carry a prefix with '_' — a character no editor post id (slug or
    /// ULID) may contain, so the three kinds can never collide and every endpoint tells them apart without a read.
    /// </summary>
    public const string UserPostPrefix = "u_";
    public const string EditPostPrefix = "e_";

    /// <summary>Opaque and stable for owner + look: "u_" + the first 13 bytes of SHA-256("{owner}|{look}") in lower-case hex.</summary>
    public static string UserPostId(string ownerTenantId, string lookId)
    {
        var hash = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes($"{ownerTenantId}|{lookId}"));
        return UserPostPrefix + Convert.ToHexStringLower(hash.AsSpan(0, 13));
    }

    public static bool IsUserPostId(string? id) =>
        id is { Length: 28 } && id.StartsWith(UserPostPrefix, StringComparison.Ordinal) && id.AsSpan(2).IndexOfAnyExcept("0123456789abcdef") < 0;

    public static string EditPostId(string editLookId) => EditPostPrefix + editLookId;

    /// <summary>The edit look id of a fallback post id ("e_{editLookId}"); null for every other id.</summary>
    public static string? EditLookIdOf(string? id) =>
        id is { Length: > 2 and <= 66 } && id.StartsWith(EditPostPrefix, StringComparison.Ordinal) && StoreInputRules.IsId(id[2..]) ? id[2..] : null;

    /// <summary>The variant a fallback post shows and try-on dresses: the first by price band (the same one EditLookLookup picks).</summary>
    public static EditLookVariant? FallbackVariant(EditLook look) => look.Variants.OrderBy(v => v.PriceBand).FirstOrDefault();

    /// <summary>
    /// The weekly edit as editor posts, for a feed that has no live editor post (owner's ask 2026-11-22): one post per look
    /// that has an image, Monday first. Author Droblet Edit, image = the look image, products = <see cref="FallbackVariant"/>.
    /// Synthesized on read, never stored; the occasion is unknown (the service returns it as null).
    /// </summary>
    public static IReadOnlyList<FeedPostEntity> FallbackPosts(WeeklyEditEntity edit)
    {
        var publishAt = WeeklyEditRules.TryParseDay(edit.WeekStart, out var monday)
            ? monday.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc)
            : Utc(edit.CreatedAt);
        return edit.Looks
            .Where(l => !string.IsNullOrWhiteSpace(l.ImageUrl) && StoreInputRules.IsId(l.Id))
            .Select(l => new FeedPostEntity
            {
                Id = EditPostId(l.Id),
                Segment = edit.Segment,
                Author = new FeedAuthor { Kind = FeedAuthorKind.Edit, Name = new Dictionary<string, string> { ["tr"] = EditAuthorName, ["en"] = EditAuthorName } },
                Title = l.Title,
                Note = l.StyleNote,
                ImageUrls = [l.ImageUrl!],
                ProductIds = FallbackVariant(l)?.ProductIds.ToList() ?? [],
                PublishAt = publishAt,
                SortOrder = l.Day,
                Published = true,
                CreatedAt = edit.CreatedAt,
                UpdatedAt = edit.UpdatedAt,
            })
            .ToList();
    }

    public const string EditAuthorName = "Droblet Edit";

    /// <summary>Whether a shared look may be listed: an AI-cover look (never an imported one), not removed by a moderator.</summary>
    public static bool IsShareable(LookEntity look) => LookCoverRules.IsEligible(look) && !look.IsModerationHidden();

    /// <summary>User looks: first those of people the viewer follows, then by style match, newest share first (id = stable tie-break).</summary>
    public static IOrderedEnumerable<FeedUserCandidate> Order(IEnumerable<FeedUserCandidate> candidates) =>
        candidates.OrderByDescending(c => c.Followed).ThenByDescending(c => c.Match).ThenByDescending(c => c.SharedAt).ThenBy(c => c.PostId, StringComparer.Ordinal);

    /// <summary>
    /// One page of the mixed feed (owner decision 21): at most one of every <paramref name="userEvery"/> items is a user
    /// look — <c>userEvery - 1</c> editor posts, then one user look, in both lists' own order. A user look never appears
    /// without the editor posts before it, so user looks beyond what the editor posts carry are not shown; editor posts go
    /// on when the user looks run out. The cursor holds a position in each list plus the place inside the pattern, so pages
    /// never repeat or skip an item when posts come and go. An unreadable token starts from the top; an F1 token (editor
    /// position only) continues the editor list.
    /// </summary>
    public static (IReadOnlyList<FeedMixItem> Page, string? Next) MixPage(
        IReadOnlyList<FeedPostEntity> editors, IReadOnlyList<FeedUserCandidate> users, string? pageToken, int pageSize, int userEvery)
    {
        var gap = Math.Max(2, userEvery) - 1;
        var cursor = MixCursor.Parse(CatalogRules.DecodeToken(pageToken));
        var e = cursor.Editor is { } ec ? IndexAfter(editors, p => IsAfter(p, ec.Ticks, ec.SortOrder, ec.Id)) : 0;
        var u = cursor.User is { } uc ? IndexAfter(users, c => IsAfter(c, uc)) : 0;
        var phase = Math.Clamp(cursor.Phase, 0, gap);

        var size = Math.Max(1, pageSize);
        var page = new List<FeedMixItem>(size);
        while (page.Count < size)
        {
            if (phase >= gap && u < users.Count)
            {
                var user = users[u++];
                page.Add(new FeedMixItem(null, user));
                cursor = cursor with { User = user };
                phase = 0;
            }
            else if (e < editors.Count)
            {
                var editor = editors[e++];
                page.Add(new FeedMixItem(editor, null));
                cursor = cursor with { Editor = (editor.PublishAt.Ticks, editor.SortOrder, editor.Id) };
                phase = Math.Min(gap, phase + 1);
            }
            else
            {
                break;
            }
        }

        var more = e < editors.Count || (phase >= gap && u < users.Count);
        return (page, page.Count > 0 && more ? CatalogRules.EncodeToken((cursor with { Phase = phase }).Format()) : null);
    }

    private static int IndexAfter<T>(IReadOnlyList<T> ordered, Func<T, bool> isAfter)
    {
        for (var i = 0; i < ordered.Count; i++)
        {
            if (isAfter(ordered[i]))
                return i;
        }
        return ordered.Count;
    }

    private static bool IsAfter(FeedUserCandidate candidate, FeedUserCandidate cursor)
    {
        if (candidate.Followed != cursor.Followed)
            return cursor.Followed;
        if (candidate.Match != cursor.Match)
            return candidate.Match < cursor.Match;
        if (candidate.SharedAt.Ticks != cursor.SharedAt.Ticks)
            return candidate.SharedAt.Ticks < cursor.SharedAt.Ticks;
        return string.CompareOrdinal(candidate.PostId, cursor.PostId) > 0;
    }

    /// <summary>"m|{editor ticks}|{sortOrder}|{id}|{followed 0/1}|{match}|{shared ticks}|{post id}|{phase}" — empty parts = no position yet.</summary>
    private sealed record MixCursor((long Ticks, int SortOrder, string Id)? Editor, FeedUserCandidate? User, int Phase)
    {
        public static MixCursor Parse(string? text)
        {
            var parts = text?.Split('|') ?? [];
            if (parts is [var ticksText, var sortText, var id] && TryEditor(ticksText, sortText, id, out var legacy))
                return new MixCursor(legacy, null, 0);   // an Akış F1 token
            if (parts is not ["m", var eTicks, var eSort, var eId, var followed, var match, var uTicks, var uId, var phaseText])
                return new MixCursor(null, null, 0);

            (long, int, string)? editor = TryEditor(eTicks, eSort, eId, out var parsed) ? parsed : null;
            FeedUserCandidate? user = followed is "0" or "1"
                                      && int.TryParse(match, NumberStyles.None, CultureInfo.InvariantCulture, out var m)
                                      && long.TryParse(uTicks, NumberStyles.None, CultureInfo.InvariantCulture, out var t)
                                      && uId.Length > 0
                ? new FeedUserCandidate(uId, followed == "1", m, new DateTime(Math.Clamp(t, DateTime.MinValue.Ticks, DateTime.MaxValue.Ticks), DateTimeKind.Utc))
                : null;
            return new MixCursor(editor, user, int.TryParse(phaseText, NumberStyles.None, CultureInfo.InvariantCulture, out var phase) ? phase : 0);
        }

        private static bool TryEditor(string ticksText, string sortText, string id, out (long, int, string) editor)
        {
            editor = default;
            if (id.Length == 0
                || !long.TryParse(ticksText, NumberStyles.None, CultureInfo.InvariantCulture, out var ticks)
                || !int.TryParse(sortText, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var sort))
                return false;
            editor = (ticks, sort, id);
            return true;
        }

        public string Format() => string.Create(CultureInfo.InvariantCulture,
            $"m|{Editor?.Ticks}|{Editor?.SortOrder}|{Editor?.Id}|{(User is null ? "" : User.Followed ? "1" : "0")}|{User?.Match}|{User?.SharedAt.Ticks}|{User?.PostId}|{Phase}");
    }

    /// <summary>
    /// "Benzerlerini gör" of a shared look: catalog products similar to its pieces (<see cref="IsSimilar"/>: category + main
    /// colour — the rule behind ownedSimilar), not retired, one piece after the other (round-robin, so every piece is
    /// represented), each piece's products newest first; at most <paramref name="max"/>, no product twice.
    /// </summary>
    public static IReadOnlyList<CatalogProductEntity> Similar(IReadOnlyList<FeedPieceRef> pieces, IEnumerable<CatalogProductEntity> products, int max)
    {
        var available = products.Where(p => !p.Retired)
            .OrderByDescending(p => p.CreatedAt).ThenBy(p => p.Id, StringComparer.Ordinal).ToList();
        var perPiece = pieces
            .Select(piece => available.Where(p => p.Id == piece.ProductId || IsSimilar(p.Category, p.Colors, piece.Category, piece.MainColor))
                .OrderByDescending(p => p.Id == piece.ProductId).ToList())
            .Where(list => list.Count > 0)
            .ToList();

        var result = new List<CatalogProductEntity>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        for (var round = 0; result.Count < max && perPiece.Any(list => round < list.Count); round++)
        {
            foreach (var list in perPiece)
            {
                if (round < list.Count && result.Count < max && seen.Add(list[round].Id))
                    result.Add(list[round]);
            }
        }
        return result;
    }

    /// <summary>The distinct reporters of a set of reports (a report whose reporter deleted their account still counts as one).</summary>
    public static int DistinctReporters(IEnumerable<ReportEntity> reports)
    {
        var list = reports.ToList();
        return list.Where(r => r.ReporterTenantId is not null).Select(r => r.ReporterTenantId).Distinct(StringComparer.Ordinal).Count()
               + list.Count(r => r.ReporterTenantId is null);
    }
}

/// <summary>A shared look as the mix ranks it (viewer-specific: Followed, Match).</summary>
public sealed record FeedUserCandidate(string PostId, bool Followed, int Match, DateTime SharedAt);

/// <summary>One slot of a mixed page: exactly one of the two is set.</summary>
public sealed record FeedMixItem(FeedPostEntity? Editor, FeedUserCandidate? User);

/// <summary>What "similar products" needs of a piece: its wardrobe category and main colour (ProductId = the piece is that catalog product).</summary>
public sealed record FeedPieceRef(ItemCategory Category, string? MainColor, string? ProductId = null);

public enum FeedWriteOutcome { Ok, NotFound }

/// <summary>SetPostPiecesAsync: ImageChanged = the post's first image is no longer the one the pieces were cut from (nothing written).</summary>
public enum FeedPiecesOutcome { Written, NotFound, ImageChanged }

public enum FeedShareOutcome { Ok, NotFound, Teen, EmailNotVerified, HandleRequired, NotShareable, RateLimited }

/// <summary>"Looklarıma ekle": RequestId = the new look's id (client ULID; a retry of the same request never creates twice).</summary>
public sealed record SaveFeedPostAsLookCommand(FeedLookMode Mode, string RequestId);

/// <summary>
/// "Looklarıma ekle" on an Akış editor post with pieces (owner decision 2026-11-23): the post becomes a look of the member —
/// as inspiration (the photograph is the cover, no pieces) or with its pieces (they become wardrobe items, the look is made
/// of them). No AI call here; a look of pieces gets its AI cover by the same rule as any saved look.
/// </summary>
public interface IFeedLookService
{
    /// <summary>
    /// Created = a new look; Ok = the look this member already made of this post in this mode. NotFound not_found (unknown,
    /// not live, a user post), Invalid look_not_savable, Forbidden (the wardrobe-item entitlement), Conflict look_id_taken.
    /// </summary>
    Task<ServiceResult<LookDto>> SaveAsLookAsync(string tenantId, string postId, SaveFeedPostAsLookCommand command, CancellationToken ct);
}

/// <summary>Akış: editor posts and stories, the shared looks of users mixed in (F2), likes, saves, hides, reports and the admin CRUD of editor content.</summary>
public interface IFeedService
{
    Task<PagedDto<FeedPostDto>> GetFeedAsync(string tenantId, IReadOnlySet<Occasion>? occasions, string? pageToken, CancellationToken ct);
    Task<IReadOnlyList<FeedStoryDto>> GetStoriesAsync(string tenantId, CancellationToken ct);
    /// <summary>Null = no such live post for this viewer (unknown, draft, scheduled, retired; a user post: own, blocked, hidden, removed).</summary>
    Task<FeedLikeDto?> LikeAsync(string tenantId, string postId, CancellationToken ct);
    Task<FeedLikeDto?> UnlikeAsync(string tenantId, string postId, CancellationToken ct);
    Task<FeedWriteOutcome> SaveAsync(string tenantId, string postId, CancellationToken ct);
    Task UnsaveAsync(string tenantId, string postId, CancellationToken ct);
    Task<IReadOnlyList<FeedPostDto>> GetSavedAsync(string tenantId, CancellationToken ct);
    /// <summary>One post as the caller sees it on Akış (the detail screen opened without the feed loaded). Null = not there for this viewer.</summary>
    Task<FeedPostDto?> GetVisiblePostAsync(string tenantId, string postId, CancellationToken ct);
    /// <summary>"Benzerlerini gör" of a user post; null = not a user post this viewer may see.</summary>
    Task<IReadOnlyList<ProductDto>?> GetSimilarAsync(string tenantId, string postId, CancellationToken ct);
    /// <summary>"Bunu gösterme": the post is never returned to this tenant again. Idempotent.</summary>
    Task<FeedWriteOutcome> HideAsync(string tenantId, string postId, CancellationToken ct);
    /// <summary>One report per user per user post: a repeat returns the first report's id with Created false.</summary>
    Task<(SocialOutcome Outcome, string? ReportId, bool Created)> ReportAsync(string tenantId, string postId, ReportReason reason, string? note, CancellationToken ct);

    // Admin / seed
    Task<IReadOnlyList<AdminFeedPostDto>> ListPostsAsync(CancellationToken ct);
    Task<AdminFeedPostDto?> GetPostAsync(string postId, CancellationToken ct);
    Task<(CatalogWriteOutcome Outcome, AdminFeedPostDto? Post, IReadOnlyList<string> MissingProductIds)> UpsertPostAsync(FeedPostInput input, CancellationToken ct);
    Task<bool> RetirePostAsync(string postId, CancellationToken ct);
    /// <summary>
    /// Operator tool (split-feed-posts): writes the pieces of the post's first image and nothing else. The post is re-read
    /// right before the write; <paramref name="imageUrl"/> must still be its first image. An empty list clears them.
    /// </summary>
    Task<FeedPiecesOutcome> SetPostPiecesAsync(string postId, string imageUrl, IReadOnlyList<FeedPostPiece> pieces, CancellationToken ct);
    Task<IReadOnlyList<AdminFeedStoryDto>> ListStoriesAsync(CancellationToken ct);
    Task<(CatalogWriteOutcome Outcome, AdminFeedStoryDto? Story, IReadOnlyList<string> MissingProductIds)> UpsertStoryAsync(FeedStoryInput input, CancellationToken ct);
    Task<bool> RetireStoryAsync(string storyId, CancellationToken ct);
}

/// <summary>Akış F2: the state of "Akışta paylaş" on a look (share, un-share, the owner's numbers, the report count).</summary>
public interface IFeedShareService
{
    /// <summary>Idempotent. Guards in order: look exists, e-mail verified, handle, shareable look (not imported, not removed), daily limit.</summary>
    Task<FeedShareOutcome> ShareAsync(string tenantId, string userId, string lookId, CancellationToken ct);
    /// <summary>Removes the post with its likes, saves, hides and report pointers. Idempotent; also called when the look is deleted.</summary>
    Task UnshareAsync(string tenantId, string lookId, CancellationToken ct);
    /// <summary>Account deletion: every share of the tenant (ICrossTenantCleanup, before the partitions go).</summary>
    Task RemoveAllAsync(string tenantId, CancellationToken ct);
    /// <summary>The tenant's shared looks by look id, with their like / save numbers.</summary>
    Task<IReadOnlyDictionary<string, FeedStatsDto>> GetSharedAsync(string tenantId, CancellationToken ct);
    /// <summary>Null = the look is not shared.</summary>
    Task<FeedStatsDto?> GetSharedAsync(string tenantId, string lookId, CancellationToken ct);
    /// <summary>The open moderation reports about a look, oldest first.</summary>
    Task<IReadOnlyList<ReportEntity>> OpenReportsAsync(string ownerTenantId, string lookId, CancellationToken ct);
    /// <summary>Re-counts the distinct reporters of the post's open reports and hides it at ContentFeed:ReportsToAutoHide. Null = no such post.</summary>
    Task<FeedUserPostEntity?> RefreshReportsAsync(string postId, CancellationToken ct);
    /// <summary>
    /// Owner decision 22: the public copy of a listed post's cover (StorageKeys.PublicLookCover), made on the first read
    /// and again when the cover changed (new pieces). Returns its key; null when the copy could not be made or the post
    /// changed meanwhile — the caller then falls back to a presigned URL of the private cover. Never throws.
    /// </summary>
    Task<string?> PublicCoverAsync(FeedUserPostEntity post, string coverKey, CancellationToken ct);
    /// <summary>Takes the public copy away (auto-hide, admin removal); the post row stays. Never throws on storage errors.</summary>
    Task UnpublishCoverAsync(string postId, CancellationToken ct);
}

public enum FeedModerationOutcome { Ok, NotFound, NotReported }

/// <summary>Akış F2, admin side (moderation.manage): the reported / auto-hidden shared looks, restore and remove.</summary>
public interface IFeedModeration
{
    Task<IReadOnlyList<AdminFeedUserPostDto>> ListAsync(CancellationToken ct);
    Task<AdminFeedUserPostDto?> GetAsync(string postId, CancellationToken ct);
    /// <summary>Back in the feed: the open reports are resolved as dismissed, so the count starts again.</summary>
    Task<FeedModerationOutcome> RestoreAsync(string postId, string adminUserId, string? note, CancellationToken ct);
    /// <summary>
    /// Removed by the existing look moderation: the open reports are resolved as contentRemoved and the look is hidden from
    /// everyone but its owner (IContentModeration; the owner gets the content_removed inbox row). ReportId = the report the
    /// removal is recorded on (its POST …/restore undoes it).
    /// </summary>
    Task<(FeedModerationOutcome Outcome, string? ReportId, ContentModerationResult? Removal)> RemoveAsync(string postId, string adminUserId, string? note, CancellationToken ct);
}
