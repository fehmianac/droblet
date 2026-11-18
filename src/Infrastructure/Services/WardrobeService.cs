using Domain.Constant;
using Domain.Domain;
using Domain.Entity;
using Domain.Enum;
using Domain.Events;
using Domain.Extensions;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Domain.Services.Ai;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Infrastructure.Services;

/// <summary>
/// E2 wardrobe: items, photo uploads, AI drafts and their confirmation, ready library, add-from-product.
/// A draft becomes an Item only here, on the user's confirmation and with the user's values (ItemDraftRules);
/// workers never write items. Image keys and URLs are never logged.
/// </summary>
public sealed class WardrobeService(
    IRepository repository,
    IObjectStorage storage,
    IEventManager events,
    IEntitlementService entitlements,
    ILibraryCatalog library,
    IOptionsMonitor<PhotoOptions> photoOptions,
    IOptionsMonitor<WardrobeOptions> wardrobeOptions,
    TimeProvider timeProvider,
    ILogger<WardrobeService> logger) : IWardrobeService
{
    private static readonly IReadOnlyList<Season> AllSeasons = Enum.GetValues<Season>();

    private DateTime Now => timeProvider.GetUtcNow().UtcDateTime;

    // ── Items ─────────────────────────────────────────────────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<ItemDto>> GetItemsAsync(string tenantId, CancellationToken ct)
    {
        var items = await repository.GetAllAsync<ItemEntity>(ItemEntity.GetPk(tenantId), ct);
        var result = new List<ItemDto>(items.Count);
        foreach (var item in items.OrderByDescending(i => i.CreatedAt).ThenByDescending(i => i.Id, StringComparer.Ordinal))
            result.Add(await ToDtoAsync(item, ct));
        return result;
    }

    public async Task<ItemDetailDto?> GetItemAsync(string tenantId, string id, CancellationToken ct)
    {
        var items = await repository.GetAllAsync<ItemEntity>(ItemEntity.GetPk(tenantId), ct);
        var item = items.FirstOrDefault(i => i.Id == id);
        if (item is null)
            return null;

        var ids = items.Select(i => i.Id).ToHashSet(StringComparer.Ordinal);
        var looks = await repository.GetAllAsync<LookEntity>(LookEntity.GetPk(tenantId), ct);
        return new ItemDetailDto(
            await ToDtoAsync(item, ct),
            looks.Where(l => l.Slots.Any(s => s.ItemId == id)).OrderByDescending(l => l.CreatedAt).Select(l => l.ToDto(ids)).ToList());
    }

    public async Task<ServiceResult<ItemDto>> UpdateItemAsync(string tenantId, string id, UpdateItemCommand command, CancellationToken ct)
    {
        var errors = ItemRules.Validate(new ItemFields(command.Name, command.Category, command.ColorIds, command.Fabric, command.Seasons, command.Size, command.Brand));
        if (errors.Count > 0)
            return ServiceResult.Invalid<ItemDto>(errors[0]);

        var item = await GetItemEntityAsync(tenantId, id, ct);
        if (item is null)
            return ServiceResult.NotFound<ItemDto>();
        if (item.Version != command.BaseVersion)
            return ServiceResult.Conflict(await ToDtoAsync(item, ct));

        item.Name = Clean(command.Name);
        item.Category = command.Category;
        item.ColorIds = command.ColorIds.ToList();
        item.Fabric = command.Fabric;
        item.Seasons = command.Seasons.Distinct().ToList();
        item.Size = Clean(command.Size);
        item.Brand = Clean(command.Brand);
        if (command.UseOriginalImage is { } useOriginal)
            item.UseOriginalImage = useOriginal && item.OriginalImageKey is not null;
        item.UpdatedAt = Now;

        if (await repository.SaveIfVersionAsync(item, command.BaseVersion, ct))
            return ServiceResult.Ok(await ToDtoAsync(item, ct));

        var current = await GetItemEntityAsync(tenantId, id, ct);
        return current is null ? ServiceResult.NotFound<ItemDto>() : ServiceResult.Conflict(await ToDtoAsync(current, ct));
    }

    public async Task<bool> DeleteItemAsync(string tenantId, string id, CancellationToken ct)
    {
        var item = await GetItemEntityAsync(tenantId, id, ct);
        if (item is null)
            return false;

        foreach (var key in new[] { item.ImageKey, item.OriginalImageKey })
        {
            if (key is not null && StorageKeys.BelongsToTenant(key, tenantId))
                await storage.DeleteAsync(key, ct);
        }
        // Looks keep the slot: it is returned as "unavailable" (silinmiş parça) until the user edits the look.
        await repository.DeleteAsync(item.Pk, item.Sk, ct);
        return true;
    }

    // ── Uploads and drafts ────────────────────────────────────────────────────────────────────────────────────────

    public async Task<ItemUploadsDto> CreateUploadsAsync(string tenantId, ItemUploadsCommand command, CancellationToken ct)
    {
        var settings = photoOptions.CurrentValue;
        var ttl = TimeSpan.FromSeconds(settings.UploadUrlTtlSeconds);
        var uploads = new List<ItemUploadDto>(command.Count);
        for (var i = 0; i < command.Count; i++)
        {
            var now = Now;
            var uploadId = Ulid.New(now);
            var key = StorageKeys.Upload(tenantId, uploadId);
            var upload = await storage.CreateUploadAsync(key, command.ContentType, settings.MaxUploadBytes, ttl, ct);
            await repository.SaveAsync(new ItemUploadEntity { UploadId = uploadId, TenantId = tenantId, ContentType = command.ContentType, S3Key = key, CreatedAt = now }, ct);
            uploads.Add(new ItemUploadDto(uploadId, upload.Url, upload.Fields, upload.ExpiresAt, settings.MaxUploadBytes));
        }
        return new ItemUploadsDto(uploads);
    }

    public async Task<ServiceResult<StartDraftsDto>> StartDraftsAsync(string tenantId, StartDraftsCommand command, string? requestLanguage, CancellationToken ct)
    {
        var decision = await entitlements.CheckAsync(tenantId, Capability.ItemProcessing, ct);
        if (!decision.Allowed)
            return ServiceResult.Forbidden<StartDraftsDto>(decision.Reason ?? ErrorCodes.PremiumRequired);

        var uploadIds = command.UploadIds.Distinct(StringComparer.Ordinal).ToList();
        var pending = new List<ItemUploadEntity>();
        var drafts = new List<ItemDraftEntity>();
        foreach (var uploadId in uploadIds)
        {
            // Replay of the same request: the draft already exists, nothing is queued twice.
            if (await GetDraftAsync(tenantId, uploadId, ct) is { } existing)
            {
                drafts.Add(existing);
                continue;
            }

            var upload = await repository.GetAsync<ItemUploadEntity>(ItemUploadEntity.GetPk(tenantId), ItemUploadEntity.GetSk(uploadId), ct);
            if (upload is null || !StorageKeys.BelongsToTenant(upload.S3Key, tenantId))
                return ServiceResult.NotFound<StartDraftsDto>(ErrorCodes.UploadNotFound);
            if (await storage.HeadAsync(upload.S3Key, ct) is null)
                return ServiceResult.Invalid<StartDraftsDto>(ErrorCodes.UploadMissing);
            pending.Add(upload);
        }

        var jobs = new List<JobEntity>();
        var kind = command.SplitOutfit ? JobKind.ItemSplit : JobKind.ItemProcess;
        var language = await LanguageAsync(tenantId, requestLanguage, ct);
        foreach (var upload in pending)
        {
            var now = Now;
            // A single-photo request keeps the client's requestId as the job id; bulk requests get one job per photo.
            var jobId = uploadIds.Count == 1 ? command.RequestId : Ulid.New(now);
            var job = new JobEntity { Id = jobId, TenantId = tenantId, Kind = kind, Status = JobStatus.Queued, CreatedAt = now, UpdatedAt = now };
            var draft = new ItemDraftEntity
            {
                Id = upload.UploadId,
                TenantId = tenantId,
                Kind = command.SplitOutfit ? ItemDraftKind.Outfit : ItemDraftKind.Single,
                Status = ItemDraftStatus.Uploaded,
                RequestId = command.RequestId,
                Language = language,
                JobId = jobId,
                CreatedAt = now,
                UpdatedAt = now,
            };

            var result = await repository.TransactWriteAsync([TransactWriteOperation.Create(draft), TransactWriteOperation.Put(job)], ct);
            if (!result.Applied)
            {
                drafts.Add(await GetDraftAsync(tenantId, upload.UploadId, ct) ?? draft);
                continue;
            }

            await events.PublishAsync(new ItemProcessRequestedEvent(tenantId, jobId, draft.Id, command.SplitOutfit), ct);
            drafts.Add(draft);
            jobs.Add(job);
        }

        logger.LogInformation("Queued {Count} item {Kind} jobs for tenant {TenantId}", jobs.Count, kind, tenantId);
        var dtos = new List<ItemDraftDto>();
        foreach (var draft in drafts)
            dtos.Add(await ToDtoAsync(draft, ct));
        return ServiceResult.Accepted(new StartDraftsDto(dtos, jobs.Select(j => j.ToDto()).ToList()));
    }

    public async Task<ItemDraftsDto> GetDraftsAsync(string tenantId, CancellationToken ct)
    {
        var drafts = await repository.GetAllAsync<ItemDraftEntity>(ItemDraftEntity.GetPk(tenantId), ct);
        var sources = drafts.Where(d => d.Kind != ItemDraftKind.Piece).ToList();
        var visible = drafts
            // A split outfit photo is only shown while it is being processed (or failed); afterwards its pieces are.
            .Where(d => d.Kind != ItemDraftKind.Outfit || d.Status != ItemDraftStatus.Ready)
            .OrderBy(d => d.CreatedAt).ThenBy(d => d.Id, StringComparer.Ordinal);

        var dtos = new List<ItemDraftDto>();
        foreach (var draft in visible)
            dtos.Add(await ToDtoAsync(draft, ct));
        return new ItemDraftsDto(dtos, sources.Count, sources.Count(d => d.Status is ItemDraftStatus.Ready or ItemDraftStatus.Failed));
    }

    public async Task<bool> DeleteDraftAsync(string tenantId, string draftId, CancellationToken ct)
    {
        var draft = await GetDraftAsync(tenantId, draftId, ct);
        if (draft is null)
            return false;

        foreach (var key in new[] { draft.OriginalKey, draft.ProcessedKey, StorageKeys.Upload(tenantId, draft.Id) })
        {
            if (key is not null && StorageKeys.BelongsToTenant(key, tenantId))
                await storage.DeleteAsync(key, ct);
        }
        await repository.DeleteAsync(draft.Pk, draft.Sk, ct);
        return true;
    }

    public async Task<ItemCreateResultsDto> ConfirmDraftsAsync(string tenantId, IReadOnlyList<ConfirmDraftCommand> items, CancellationToken ct)
    {
        var decision = await entitlements.CheckAsync(tenantId, Capability.WardrobeItem, ct);
        var results = new List<ItemCreateResultDto>(items.Count);
        foreach (var command in items)
        {
            results.Add(decision.Allowed
                ? await ConfirmDraftAsync(tenantId, command, ct)
                : Rejected(command.DraftId, decision.Reason ?? ErrorCodes.PremiumRequired));
        }
        return new ItemCreateResultsDto(results, results.Count(r => r.Outcome == ItemCreateOutcome.Created));
    }

    private async Task<ItemCreateResultDto> ConfirmDraftAsync(string tenantId, ConfirmDraftCommand command, CancellationToken ct)
    {
        var itemId = command.ItemId ?? command.ClientMutationId;
        if (await ReplayAsync(tenantId, command.ClientMutationId, itemId, command.DraftId, ct) is { } replay)
            return replay;

        var draft = await GetDraftAsync(tenantId, command.DraftId, ct);
        if (draft is null)
            return Rejected(command.DraftId, ErrorCodes.DraftNotFound);

        if (ItemDraftRules.CheckConfirm(draft.Status, draft.Kind, draft.NeedsReview, command.Reviewed) is { } code)
            return Rejected(command.DraftId, code);

        var errors = ItemRules.Validate(new ItemFields(command.Name, command.Category, command.ColorIds, command.Fabric, command.Seasons, command.Size, command.Brand));
        if (errors.Count > 0)
            return new ItemCreateResultDto(command.DraftId, ItemCreateOutcome.Rejected, ErrorCodes.ValidationFailed, errors, null);

        var now = Now;
        var item = new ItemEntity
        {
            Id = itemId,
            TenantId = tenantId,
            Name = Clean(command.Name),
            Category = command.Category!.Value,
            ColorIds = command.ColorIds!.ToList(),
            Fabric = command.Fabric,
            Seasons = command.Seasons!.Distinct().ToList(),
            Size = Clean(command.Size),
            Brand = Clean(command.Brand),
            Source = ItemSource.Photo,
            ImageKey = Owned(draft.ProcessedKey, tenantId),
            OriginalImageKey = Owned(draft.OriginalKey, tenantId),
            CreatedAt = now,
            UpdatedAt = now,
        };
        item.UseOriginalImage = item.OriginalImageKey is not null && (command.UseOriginalImage || item.ImageKey is null);

        return await CreateAsync(tenantId, command.ClientMutationId, command.DraftId, item,
            [TransactWriteOperation.Delete(draft.Pk, draft.Sk)], ct);
    }

    // ── Library and catalog product ───────────────────────────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<LibraryItemDto>> GetLibraryAsync(string tenantId, string? requestLanguage, CancellationToken ct)
    {
        var items = await library.GetAllAsync(ct);
        var language = await LanguageAsync(tenantId, requestLanguage, ct);
        return items
            .OrderBy(i => i.SortOrder).ThenBy(i => i.Id, StringComparer.Ordinal)
            .Select(i => new LibraryItemDto(i.Id, Localized.Resolve(i.Name, language), i.Category, i.ColorIds, i.Fabric, i.Seasons, PublicUrl(i.ImageKey)))
            .ToList();
    }

    public async Task<ItemCreateResultsDto> AddFromLibraryAsync(string tenantId, IReadOnlyList<AddLibraryItemCommand> items, string? requestLanguage, CancellationToken ct)
    {
        var decision = await entitlements.CheckAsync(tenantId, Capability.WardrobeItem, ct);
        var catalog = (await library.GetAllAsync(ct)).ToDictionary(i => i.Id, StringComparer.Ordinal);
        var tenant = await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(tenantId), ct);
        var results = new List<ItemCreateResultDto>(items.Count);

        foreach (var command in items)
        {
            if (!decision.Allowed)
            {
                results.Add(Rejected(command.LibraryItemId, decision.Reason ?? ErrorCodes.PremiumRequired));
                continue;
            }

            var itemId = command.ItemId ?? command.ClientMutationId;
            if (await ReplayAsync(tenantId, command.ClientMutationId, itemId, command.LibraryItemId, ct) is { } replay)
            {
                results.Add(replay);
                continue;
            }
            if (!catalog.TryGetValue(command.LibraryItemId, out var source))
            {
                results.Add(Rejected(command.LibraryItemId, ErrorCodes.LibraryItemNotFound));
                continue;
            }

            var now = Now;
            results.Add(await CreateAsync(tenantId, command.ClientMutationId, command.LibraryItemId, new ItemEntity
            {
                Id = itemId,
                TenantId = tenantId,
                Name = Localized.Resolve(source.Name, Localized.Language(tenant?.Language, requestLanguage)),
                Category = source.Category,
                ColorIds = source.ColorIds.Where(ColorCatalog.IsKnown).ToList(),
                Fabric = FabricCatalog.IsKnown(source.Fabric) ? source.Fabric : null,
                Seasons = source.Seasons.Count > 0 ? source.Seasons.ToList() : AllSeasons.ToList(),
                Size = Clean(command.Size),
                Source = ItemSource.Library,
                LibraryItemId = source.Id,
                GlobalImageKey = source.ImageKey,
                CreatedAt = now,
                UpdatedAt = now,
            }, [], ct));
        }

        return new ItemCreateResultsDto(results, results.Count(r => r.Outcome == ItemCreateOutcome.Created));
    }

    public async Task<ItemCreateResultDto> AddFromProductAsync(string tenantId, ProductSnapshot product, string clientMutationId, string? size, string? itemId, CancellationToken ct)
    {
        var decision = await entitlements.CheckAsync(tenantId, Capability.WardrobeItem, ct);
        if (!decision.Allowed)
            return Rejected(product.Id, decision.Reason ?? ErrorCodes.PremiumRequired);

        var id = itemId ?? clientMutationId;
        if (await ReplayAsync(tenantId, clientMutationId, id, product.Id, ct) is { } replay)
            return replay;

        var now = Now;
        return await CreateAsync(tenantId, clientMutationId, product.Id, new ItemEntity
        {
            Id = id,
            TenantId = tenantId,
            Name = Clean(product.Name) is { Length: <= ItemRules.MaxNameLength } name ? name : Clean(product.Name)?[..ItemRules.MaxNameLength],
            Category = product.Category,
            ColorIds = product.ColorIds.Where(ColorCatalog.IsKnown).Distinct().Take(ItemRules.MaxColors).ToList(),
            Fabric = FabricCatalog.IsKnown(product.Fabric) ? product.Fabric : null,
            Seasons = product.Seasons.Count > 0 ? product.Seasons.Distinct().ToList() : AllSeasons.ToList(),
            Size = Clean(size),
            Brand = Clean(product.BrandName),
            Source = ItemSource.Purchase,
            ProductId = product.Id,
            GlobalImageKey = product.ImageKey,
            CreatedAt = now,
            UpdatedAt = now,
        }, [], ct);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Receipt + item (+ extra writes) in one transaction: the same clientMutationId never creates a second item.</summary>
    private async Task<ItemCreateResultDto> CreateAsync(string tenantId, string clientMutationId, string refId, ItemEntity item,
        IReadOnlyList<TransactWriteOperation> extra, CancellationToken ct)
    {
        var operations = new List<TransactWriteOperation>
        {
            TransactWriteOperation.Create(new MutationReceiptEntity { TenantId = tenantId, ClientMutationId = clientMutationId, CreatedAt = item.CreatedAt }),
            TransactWriteOperation.Create(item),
        };
        operations.AddRange(extra);

        var result = await repository.TransactWriteAsync(operations, ct);
        if (result.Applied)
            return new ItemCreateResultDto(refId, ItemCreateOutcome.Created, null, null, await ToDtoAsync(item, ct));
        if (result.FailedIndex == 0)
            return await ReplayAsync(tenantId, clientMutationId, item.Id, refId, ct) ?? Rejected(refId, ErrorCodes.NotFound);
        return Rejected(refId, ErrorCodes.ItemIdTaken);
    }

    private async Task<ItemCreateResultDto?> ReplayAsync(string tenantId, string clientMutationId, string itemId, string refId, CancellationToken ct)
    {
        var receipt = await repository.GetAsync<MutationReceiptEntity>(MutationReceiptEntity.GetPk(tenantId), MutationReceiptEntity.GetSk(clientMutationId), ct);
        if (receipt is null)
            return null;

        var item = await GetItemEntityAsync(tenantId, itemId, ct);
        // Applied earlier; the item may have been deleted since (a deleted record never comes back).
        return new ItemCreateResultDto(refId, ItemCreateOutcome.AlreadyApplied, null, null, item is null ? null : await ToDtoAsync(item, ct));
    }

    private static ItemCreateResultDto Rejected(string refId, string code) => new(refId, ItemCreateOutcome.Rejected, code, null, null);

    private Task<ItemEntity?> GetItemEntityAsync(string tenantId, string id, CancellationToken ct) =>
        repository.GetAsync<ItemEntity>(ItemEntity.GetPk(tenantId), ItemEntity.GetSk(id), ct);

    private Task<ItemDraftEntity?> GetDraftAsync(string tenantId, string id, CancellationToken ct) =>
        repository.GetAsync<ItemDraftEntity>(ItemDraftEntity.GetPk(tenantId), ItemDraftEntity.GetSk(id), ct);

    public async Task<ItemDto> ToDtoAsync(ItemEntity item, CancellationToken ct)
    {
        var key = item is { UseOriginalImage: true, OriginalImageKey: not null } ? item.OriginalImageKey : item.ImageKey ?? item.OriginalImageKey;
        var (url, expires) = await ReadUrlAsync(key, item.TenantId, ct);
        url ??= PublicUrl(item.GlobalImageKey);

        return new ItemDto(item.Id, item.Name, item.Category, item.ColorIds, item.Fabric, item.Seasons, item.Size, item.Brand, item.Source,
            item.ProductId, item.LibraryItemId, url, expires, item.OriginalImageKey is not null, item.UseOriginalImage, item.WearCount,
            item.LastWornAt, item.ListingStatus, item.CreatedAt, item.UpdatedAt, item.Version);
    }

    private async Task<ItemDraftDto> ToDtoAsync(ItemDraftEntity draft, CancellationToken ct)
    {
        var (processedUrl, expires) = await ReadUrlAsync(draft.ProcessedKey, draft.TenantId, ct);
        var (originalUrl, originalExpires) = await ReadUrlAsync(draft.OriginalKey, draft.TenantId, ct);
        return new ItemDraftDto(draft.Id, draft.Kind, draft.Status, draft.JobId, draft.ParentDraftId, processedUrl ?? originalUrl, originalUrl,
            expires ?? originalExpires, draft.Name, draft.Category, draft.ColorIds, draft.Fabric, draft.Seasons, draft.FlaggedFields,
            draft.NeedsReview, draft.Language, draft.CreatedAt);
    }

    /// <summary>Presigned GET only after the key is proven to sit under the caller's own prefix (rule 14).</summary>
    private async Task<(string? Url, DateTime? ExpiresAt)> ReadUrlAsync(string? key, string tenantId, CancellationToken ct)
    {
        if (key is null || !StorageKeys.BelongsToTenant(key, tenantId))
            return (null, null);
        var ttl = TimeSpan.FromSeconds(photoOptions.CurrentValue.ReadUrlTtlSeconds);
        return (await storage.CreateReadUrlAsync(key, ttl, ct), Now.Add(ttl));
    }

    private string? PublicUrl(string? globalKey)
    {
        var baseUrl = wardrobeOptions.CurrentValue.PublicAssetBaseUrl;
        return string.IsNullOrWhiteSpace(globalKey) || string.IsNullOrWhiteSpace(baseUrl)
            ? null
            : $"{baseUrl.TrimEnd('/')}/{globalKey.TrimStart('/')}";
    }

    private async Task<string> LanguageAsync(string tenantId, string? requestLanguage, CancellationToken ct) =>
        Localized.Language((await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(tenantId), ct))?.Language, requestLanguage);

    private static string? Owned(string? key, string tenantId) =>
        key is not null && key.StartsWith(StorageKeys.TenantRoot(tenantId), StringComparison.Ordinal) ? key : null;

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
