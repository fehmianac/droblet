using Domain.Domain;
using Domain.Entity;
using Domain.Enum;
using Domain.Manager;
using Domain.Services;
using Domain.Validation;

namespace Infrastructure.Services.Store;

/// <summary>
/// Weekly edit + data-driven content collections. Text is stored per language and resolved to the request language
/// (profile → Accept-Language → default); product rows resolve from the catalog on read.
/// </summary>
public sealed class ContentService(IRepository repository, ICatalogService catalog, IRequestLanguage requestLanguage, TimeProvider timeProvider) : IContentService
{
    private DateTime Now => timeProvider.GetUtcNow().UtcDateTime;

    private string? Text(IReadOnlyDictionary<string, string>? text, string language) => LocalizedText.Resolve(text, language, requestLanguage.Default);

    public async Task<EditDto?> GetCurrentEditAsync(Segment segment, CancellationToken ct)
    {
        var current = WeeklyEditRules.PickCurrent(await ListEditsAsync(ct), DateOnly.FromDateTime(Now), segment);
        return current is null ? null : await ToDtoAsync(current, ct);
    }

    public async Task<EditDto?> GetEditAsync(string editId, CancellationToken ct)
    {
        var edit = await repository.GetAsync<WeeklyEditEntity>(WeeklyEditEntity.GetPk(), WeeklyEditEntity.GetSk(editId), ct);
        return edit is { Published: true, Retired: false } ? await ToDtoAsync(edit, ct) : null;
    }

    public async Task<IReadOnlyList<ContentCollectionDto>> GetCollectionsAsync(ContentCollectionKind kind, CancellationToken ct)
    {
        var language = await requestLanguage.GetAsync(ct);
        var result = new List<ContentCollectionDto>();
        foreach (var c in (await ListCollectionsAsync(kind, ct)).Where(c => !c.Retired))
        {
            result.Add(new ContentCollectionDto(c.Id, c.Kind, Text(c.Title, language) ?? "", Text(c.Subtitle, language), c.ImageUrl,
                c.SponsorName is { Count: > 0 }, Text(c.SponsorName, language), await ExistingHandleAsync(c.Handle, ct)));
        }
        return result;
    }

    public async Task<IReadOnlyList<ContentLookDto>?> GetCollectionLooksAsync(ContentCollectionKind kind, string collectionId, CancellationToken ct)
    {
        var collection = await repository.GetAsync<ContentCollectionEntity>(ContentCollectionEntity.GetPk(kind), ContentCollectionEntity.GetSk(collectionId), ct);
        if (collection is null || collection.Retired)
            return null;

        var language = await requestLanguage.GetAsync(ct);
        var result = new List<ContentLookDto>();
        foreach (var look in (await ListCollectionLooksAsync(collectionId, ct)).Where(l => !l.Retired))
        {
            var products = await catalog.ToDtosAsync(look.ProductIds, ct);
            result.Add(new ContentLookDto(look.Id, look.CollectionId, Text(look.Title, language) ?? "", Text(look.Note, language), look.ImageUrl,
                products, StoreDtoMapper.Total(products), StoreDtoMapper.Currency));
        }
        return result;
    }

    private async Task<EditDto> ToDtoAsync(WeeklyEditEntity edit, CancellationToken ct)
    {
        var language = await requestLanguage.GetAsync(ct);
        var looks = new List<EditLookDto>();
        foreach (var look in edit.Looks.OrderBy(l => l.Day))
        {
            var variants = new List<EditVariantDto>();
            foreach (var variant in look.Variants.OrderBy(v => v.PriceBand))
            {
                var products = await catalog.ToDtosAsync(variant.ProductIds, ct);
                variants.Add(new EditVariantDto(variant.PriceBand, products, StoreDtoMapper.Total(products), StoreDtoMapper.Currency));
            }
            looks.Add(new EditLookDto(look.Id, look.Day, Text(look.Title, language) ?? "", Text(look.StyleNote, language), look.ImageUrl, variants));
        }

        var weekEnd = WeeklyEditRules.TryParseDay(edit.WeekStart, out var start) ? WeeklyEditRules.Format(start.AddDays(6)) : edit.WeekStart;
        return new EditDto(edit.Id, Text(edit.Title, language) ?? "", Text(edit.Subtitle, language), edit.CoverImageUrl, edit.WeekStart, weekEnd,
            edit.Segment, WeeklyEditRules.IsSponsored(edit), Text(edit.SponsorName, language), looks);
    }

    // ── Admin / seed ────────────────────────────────────────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<WeeklyEditEntity>> ListEditsAsync(CancellationToken ct) =>
        (await repository.GetAllAsync<WeeklyEditEntity>(WeeklyEditEntity.GetPk(), ct))
            .OrderByDescending(e => e.WeekStart, StringComparer.Ordinal).ToList();

    public async Task<(CatalogWriteOutcome Outcome, WeeklyEditEntity? Edit, IReadOnlyList<string> MissingProductIds)> UpsertEditAsync(WeeklyEditInput input, CancellationToken ct)
    {
        var looks = input.Looks ?? [];
        var missing = await MissingProductsAsync(looks.SelectMany(l => l.Variants ?? []).SelectMany(v => v.ProductIds ?? []), ct);
        if (missing.Count > 0)
            return (CatalogWriteOutcome.ProductNotFound, null, missing);

        var now = Now;
        var existing = await repository.GetAsync<WeeklyEditEntity>(WeeklyEditEntity.GetPk(), WeeklyEditEntity.GetSk(input.Id), ct);
        var edit = new WeeklyEditEntity
        {
            Id = input.Id,
            Segment = input.Segment,
            WeekStart = input.WeekStart,
            Title = LocalizedText.Normalize(input.Title),
            Subtitle = LocalizedText.NormalizeOptional(input.Subtitle),
            CoverImageUrl = NullIfEmpty(input.CoverImageUrl),
            SponsorBrandId = NullIfEmpty(input.SponsorBrandId),
            SponsorName = LocalizedText.NormalizeOptional(input.SponsorName),
            Published = input.Published,
            Retired = input.Retired,
            CreatedAt = existing?.CreatedAt ?? now,
            UpdatedAt = now,
            Looks = looks.Select(l => new EditLook
            {
                Id = string.IsNullOrEmpty(l.Id) ? $"{input.Id}-d{l.Day}" : l.Id,
                Day = l.Day,
                Title = LocalizedText.Normalize(l.Title),
                StyleNote = LocalizedText.NormalizeOptional(l.StyleNote),
                ImageUrl = NullIfEmpty(l.ImageUrl),
                Variants = (l.Variants ?? []).Select(v => new EditLookVariant { PriceBand = v.PriceBand, ProductIds = (v.ProductIds ?? []).ToList() }).ToList(),
            }).ToList(),
        };
        await repository.SaveAsync(edit, ct);
        return (existing is null ? CatalogWriteOutcome.Created : CatalogWriteOutcome.Updated, edit, []);
    }

    public async Task<bool> RetireEditAsync(string editId, CancellationToken ct)
    {
        var edit = await repository.GetAsync<WeeklyEditEntity>(WeeklyEditEntity.GetPk(), WeeklyEditEntity.GetSk(editId), ct);
        if (edit is null)
            return false;
        edit.Retired = true;
        edit.Published = false;
        edit.UpdatedAt = Now;
        await repository.SaveAsync(edit, ct);
        return true;
    }

    public async Task<IReadOnlyList<ContentCollectionEntity>> ListCollectionsAsync(ContentCollectionKind kind, CancellationToken ct) =>
        (await repository.GetAllAsync<ContentCollectionEntity>(ContentCollectionEntity.GetPk(kind), ct))
            .OrderBy(c => c.SortOrder).ThenBy(c => c.Id, StringComparer.Ordinal).ToList();

    /// <summary>The handle only while an account holds it (a released or never-claimed handle is not shown).</summary>
    private async Task<string?> ExistingHandleAsync(string? handle, CancellationToken ct) =>
        handle is null || await repository.GetAsync<HandleEntity>(HandleEntity.GetPk(), HandleEntity.GetSk(handle), ct) is null ? null : handle;

    public async Task<(CatalogWriteOutcome Outcome, ContentCollectionEntity Collection)> UpsertCollectionAsync(ContentCollectionInput input, CancellationToken ct)
    {
        var now = Now;
        var existing = await repository.GetAsync<ContentCollectionEntity>(ContentCollectionEntity.GetPk(input.Kind), ContentCollectionEntity.GetSk(input.Id), ct);
        var collection = new ContentCollectionEntity
        {
            Id = input.Id,
            Kind = input.Kind,
            Title = LocalizedText.Normalize(input.Title),
            Subtitle = LocalizedText.NormalizeOptional(input.Subtitle),
            ImageUrl = NullIfEmpty(input.ImageUrl),
            SortOrder = input.SortOrder,
            SponsorName = LocalizedText.NormalizeOptional(input.SponsorName),
            Handle = string.IsNullOrWhiteSpace(input.Handle) ? null : HandleRules.Normalize(input.Handle),
            Retired = input.Retired,
            CreatedAt = existing?.CreatedAt ?? now,
            UpdatedAt = now,
        };
        await repository.SaveAsync(collection, ct);
        return (existing is null ? CatalogWriteOutcome.Created : CatalogWriteOutcome.Updated, collection);
    }

    public async Task<bool> RetireCollectionAsync(ContentCollectionKind kind, string collectionId, CancellationToken ct)
    {
        var collection = await repository.GetAsync<ContentCollectionEntity>(ContentCollectionEntity.GetPk(kind), ContentCollectionEntity.GetSk(collectionId), ct);
        if (collection is null)
            return false;
        collection.Retired = true;
        collection.UpdatedAt = Now;
        await repository.SaveAsync(collection, ct);
        return true;
    }

    public async Task<IReadOnlyList<ContentLookEntity>> ListCollectionLooksAsync(string collectionId, CancellationToken ct) =>
        (await repository.GetAllAsync<ContentLookEntity>(ContentLookEntity.GetPk(collectionId), ct))
            .OrderBy(l => l.SortOrder).ThenBy(l => l.Id, StringComparer.Ordinal).ToList();

    public async Task<(CatalogWriteOutcome Outcome, ContentLookEntity? Look, IReadOnlyList<string> MissingProductIds)> UpsertCollectionLookAsync(
        ContentCollectionKind kind, string collectionId, ContentLookInput input, CancellationToken ct)
    {
        var collection = await repository.GetAsync<ContentCollectionEntity>(ContentCollectionEntity.GetPk(kind), ContentCollectionEntity.GetSk(collectionId), ct);
        if (collection is null)
            return (CatalogWriteOutcome.NotFound, null, []);

        var missing = await MissingProductsAsync(input.ProductIds ?? [], ct);
        if (missing.Count > 0)
            return (CatalogWriteOutcome.ProductNotFound, null, missing);

        var now = Now;
        var existing = await repository.GetAsync<ContentLookEntity>(ContentLookEntity.GetPk(collectionId), ContentLookEntity.GetSk(input.Id), ct);
        var look = new ContentLookEntity
        {
            Id = input.Id,
            CollectionId = collectionId,
            Title = LocalizedText.Normalize(input.Title),
            Note = LocalizedText.NormalizeOptional(input.Note),
            ImageUrl = NullIfEmpty(input.ImageUrl),
            ProductIds = (input.ProductIds ?? []).ToList(),
            SortOrder = input.SortOrder,
            Retired = input.Retired,
            CreatedAt = existing?.CreatedAt ?? now,
            UpdatedAt = now,
        };
        await repository.SaveAsync(look, ct);
        return (existing is null ? CatalogWriteOutcome.Created : CatalogWriteOutcome.Updated, look, []);
    }

    public async Task<bool> RetireCollectionLookAsync(string collectionId, string lookId, CancellationToken ct)
    {
        var look = await repository.GetAsync<ContentLookEntity>(ContentLookEntity.GetPk(collectionId), ContentLookEntity.GetSk(lookId), ct);
        if (look is null)
            return false;
        look.Retired = true;
        look.UpdatedAt = Now;
        await repository.SaveAsync(look, ct);
        return true;
    }

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
