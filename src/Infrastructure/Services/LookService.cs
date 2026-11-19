using Domain.Domain;
using Domain.Entity;
using Domain.Enum;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Microsoft.Extensions.Options;

namespace Infrastructure.Services;

/// <summary>E3 looks. Every write passes OutfitSlotRules; slot references are resolved only inside the caller's tenant (+ catalog).</summary>
public sealed class LookService(IRepository repository, ICatalogProductLookup products, IObjectStorage storage, IOptionsMonitor<PhotoOptions> photoOptions,
    TimeProvider timeProvider) : ILookService
{
    private DateTime Now => timeProvider.GetUtcNow().UtcDateTime;

    public async Task<IReadOnlyList<LookDto>> GetAllAsync(string tenantId, CancellationToken ct)
    {
        var looks = await repository.GetAllAsync<LookEntity>(LookEntity.GetPk(tenantId), ct);
        var itemIds = await ItemIdsAsync(repository, tenantId, ct);
        // One partition read for every look's rating summary (the owner always sees the ratings of their own looks).
        var ratings = (await repository.GetAllAsync<LookRatingSummaryEntity>(LookRatingSummaryEntity.GetPk(tenantId), ct))
            .ToDictionary(r => r.LookId, StringComparer.Ordinal);
        var result = new List<LookDto>(looks.Count);
        foreach (var look in looks.OrderByDescending(l => l.CreatedAt).ThenByDescending(l => l.Id, StringComparer.Ordinal))
            result.Add(await WithCoverAsync(look, look.ToDto(itemIds) with { Rating = ToRating(ratings.GetValueOrDefault(look.Id)) }, ct));
        return result;
    }

    public async Task<LookDto?> GetAsync(string tenantId, string id, CancellationToken ct)
    {
        var look = await GetEntityAsync(tenantId, id, ct);
        if (look is null)
            return null;
        var rating = await repository.GetAsync<LookRatingSummaryEntity>(LookRatingSummaryEntity.GetPk(tenantId), LookRatingSummaryEntity.GetSk(id), ct);
        return await WithCoverAsync(look, look.ToDto(await ItemIdsAsync(repository, tenantId, ct)) with { Rating = ToRating(rating) }, ct);
    }

    /// <summary>An imported look's cover photo as a presigned GET (only a key under the owner's prefix is ever signed).</summary>
    private async Task<LookDto> WithCoverAsync(LookEntity look, LookDto dto, CancellationToken ct)
    {
        if (look.CoverImageKey is not { } key || !StorageKeys.BelongsToTenant(key, look.TenantId))
            return dto;
        var ttl = TimeSpan.FromSeconds(photoOptions.CurrentValue.ReadUrlTtlSeconds);
        return dto with { CoverImageUrl = await storage.CreateReadUrlAsync(key, ttl, ct), CoverImageUrlExpiresAt = Now.Add(ttl) };
    }

    private static LookRatingSummaryDto? ToRating(LookRatingSummaryEntity? summary) =>
        summary is not null && LookRatingRules.Average(summary.Sum, summary.Count) is { } average ? new LookRatingSummaryDto(average, summary.Count) : null;

    public async Task<ServiceResult<LookDto>> CreateAsync(string tenantId, CreateLookCommand command, CancellationToken ct)
    {
        // Same id sent twice (offline retry) returns the stored look instead of failing.
        if (await GetEntityAsync(tenantId, command.Id, ct) is { } existing)
            return ServiceResult.Ok(existing.ToDto(await ItemIdsAsync(repository, tenantId, ct)));

        var slots = command.Slots.Select(s => new SlotRef(s.Slot, Blank(s.ItemId), Blank(s.ProductId))).ToList();
        var errors = await ValidateSlotsAsync(tenantId, slots, ct);
        if (errors.Count > 0)
            return ServiceResult.Invalid<LookDto>(errors[0]);

        var now = Now;
        var look = new LookEntity
        {
            Id = command.Id,
            TenantId = tenantId,
            Name = Blank(command.Name),
            Occasion = command.Occasion,
            Slots = slots.Select(s => s.ToValue()).ToList(),
            Favorite = command.Favorite,
            // "stylist" is only ever set by the accept endpoint.
            Source = command.Source == LookSource.Stylist ? LookSource.User : command.Source,
            CreatedAt = now,
            UpdatedAt = now,
        };

        if (!await repository.SaveIfVersionAsync(look, 0, ct))
            look = await GetEntityAsync(tenantId, command.Id, ct) ?? look;
        return ServiceResult.Created(look.ToDto(await ItemIdsAsync(repository, tenantId, ct)));
    }

    public async Task<ServiceResult<LookDto>> UpdateAsync(string tenantId, string id, UpdateLookCommand command, CancellationToken ct)
    {
        var look = await GetEntityAsync(tenantId, id, ct);
        if (look is null)
            return ServiceResult.NotFound<LookDto>();

        var itemIds = await ItemIdsAsync(repository, tenantId, ct);
        if (look.Version != command.BaseVersion)
            return ServiceResult.Conflict(look.ToDto(itemIds));

        var slots = command.Slots.Select(s => new SlotRef(s.Slot, Blank(s.ItemId), Blank(s.ProductId))).ToList();
        var errors = await ValidateSlotsAsync(tenantId, slots, ct);
        if (errors.Count > 0)
            return ServiceResult.Invalid<LookDto>(errors[0]);

        look.Name = Blank(command.Name);
        look.Occasion = command.Occasion;
        look.Slots = slots.Select(s => s.ToValue()).ToList();
        look.Favorite = command.Favorite;
        look.UpdatedAt = Now;

        if (await repository.SaveIfVersionAsync(look, command.BaseVersion, ct))
            return ServiceResult.Ok(look.ToDto(itemIds));

        var current = await GetEntityAsync(tenantId, id, ct);
        return current is null ? ServiceResult.NotFound<LookDto>() : ServiceResult.Conflict(current.ToDto(itemIds));
    }

    public async Task<bool> DeleteAsync(string tenantId, string id, CancellationToken ct)
    {
        var look = await GetEntityAsync(tenantId, id, ct);
        if (look is null)
            return false;
        await repository.DeleteAsync(look.Pk, look.Sk, ct);
        // An imported look's cover photo is its own (nothing else points to it).
        if (look.CoverImageKey is { } cover && StorageKeys.BelongsToTenant(cover, tenantId))
            await storage.DeleteAsync(cover, ct);
        // The look's rating summary goes with it (the raters' own rows are removed by their own account deletion / unsave).
        await repository.DeleteAsync(LookRatingSummaryEntity.GetPk(tenantId), LookRatingSummaryEntity.GetSk(id), ct);
        return true;
    }

    public async Task<IReadOnlyList<string>> ValidateSlotsAsync(string tenantId, IReadOnlyList<SlotRef> slots, CancellationToken ct)
    {
        var pieces = new List<SlotPiece>(slots.Count);
        foreach (var slot in slots)
        {
            ItemCategory? category = null;
            if (slot.ItemId is not null && slot.ProductId is null)
            {
                // Only the caller's own partition is ever read: another tenant's item id simply does not resolve.
                category = (await repository.GetAsync<ItemEntity>(ItemEntity.GetPk(tenantId), ItemEntity.GetSk(slot.ItemId), ct))?.Category;
            }
            else if (slot.ProductId is not null && slot.ItemId is null)
            {
                var product = await products.GetAsync(slot.ProductId, ct);
                category = product is { Retired: false } ? product.Category : null;
            }
            pieces.Add(new SlotPiece(slot.Slot, slot.ItemId, slot.ProductId, category));
        }
        return OutfitSlotRules.Validate(pieces);
    }

    private Task<LookEntity?> GetEntityAsync(string tenantId, string id, CancellationToken ct) =>
        repository.GetAsync<LookEntity>(LookEntity.GetPk(tenantId), LookEntity.GetSk(id), ct);

    internal static async Task<IReadOnlySet<string>> ItemIdsAsync(IRepository repository, string tenantId, CancellationToken ct) =>
        (await repository.GetKeysAsync(ItemEntity.GetPk(tenantId), ct)).Select(k => k.Sk).ToHashSet(StringComparer.Ordinal);

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
