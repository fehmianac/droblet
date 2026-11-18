using Domain.Constant;
using Domain.Domain;
using Domain.Entity;
using Domain.Enum;
using Domain.Events;
using Domain.Manager;
using Domain.Services;

namespace Infrastructure.Services;

/// <summary>
/// E7 colour palette (Api side). The analysis is permanent: it is not repeated until a new face photo is uploaded.
/// Wardrobe compatibility is computed on every read by PaletteCompatibilityRules — never stored, never AI.
/// </summary>
public sealed class PaletteService(
    IRepository repository,
    IEventManager events,
    IEntitlementService entitlements,
    IWardrobeService wardrobe,
    Microsoft.Extensions.Options.IOptionsMonitor<Domain.Options.PaletteOptions> paletteOptions,
    TimeProvider timeProvider) : IPaletteService
{
    public async Task<ServiceResult<PaletteStartDto>> StartAsync(string tenantId, StartPaletteCommand command, string? requestLanguage, CancellationToken ct)
    {
        var face = await ActiveFacePhotoAsync(tenantId, ct);
        if (face is null)
            return ServiceResult.Invalid<PaletteStartDto>(ErrorCodes.FacePhotoRequired);

        var current = await GetEntityAsync(tenantId, ct);
        if (current is not null && current.SourcePhotoId == face.Id)
            return ServiceResult.Ok(new PaletteStartDto(StartStatus.Cached, await ToDtoAsync(current, tenantId, face.Id, requestLanguage, ct), null));

        if (await JobStarter.ExistingAsync(repository, tenantId, command.RequestId, JobKind.Palette, ct) is { } existing)
        {
            return existing.Kind == ResultKind.Accepted
                ? ServiceResult.Accepted(new PaletteStartDto(StartStatus.Queued, null, existing.Value))
                : ServiceResult.Conflict<PaletteStartDto>(null, existing.Code);
        }

        var decision = await entitlements.CheckAsync(tenantId, Capability.PaletteAnalysis, ct);
        if (!decision.Allowed)
            return ServiceResult.Forbidden<PaletteStartDto>(decision.Reason ?? ErrorCodes.PremiumRequired);

        var job = JobStarter.New(tenantId, command.RequestId, JobKind.Palette, null, timeProvider.GetUtcNow().UtcDateTime);
        await repository.SaveAsync(job, ct);
        await events.PublishAsync(new PaletteRequestedEvent(tenantId, job.Id, face.Id), ct);
        return ServiceResult.Accepted(new PaletteStartDto(StartStatus.Queued, null, job.ToDto()));
    }

    public async Task<PaletteDto?> GetAsync(string tenantId, string? requestLanguage, CancellationToken ct)
    {
        var palette = await GetEntityAsync(tenantId, ct);
        return palette is null ? null : await ToDtoAsync(palette, tenantId, (await ActiveFacePhotoAsync(tenantId, ct))?.Id, requestLanguage, ct);
    }

    public async Task<PaletteMismatchDto?> GetMismatchAsync(string tenantId, CancellationToken ct)
    {
        var palette = await GetEntityAsync(tenantId, ct);
        if (palette is null)
            return null;

        var items = await repository.GetAllAsync<ItemEntity>(ItemEntity.GetPk(tenantId), ct);
        var incompatible = Evaluate(palette, items).IncompatibleItemIds.ToHashSet(StringComparer.Ordinal);
        var result = new List<ItemDto>();
        foreach (var item in items.Where(i => incompatible.Contains(i.Id)).OrderByDescending(i => i.CreatedAt))
            result.Add(await wardrobe.ToDtoAsync(item, ct));
        return new PaletteMismatchDto(result);
    }

    public async Task<(IReadOnlySet<string> Flattering, IReadOnlySet<string> Avoid)?> GetColorsAsync(string tenantId, CancellationToken ct)
    {
        var palette = await GetEntityAsync(tenantId, ct);
        if (palette is null)
            return null;
        return (palette.FlatteringColorIds.ToHashSet(StringComparer.Ordinal), palette.AvoidColorIds.ToHashSet(StringComparer.Ordinal));
    }

    public Task DeleteAsync(string tenantId, CancellationToken ct) =>
        repository.DeleteAsync(PaletteResultEntity.GetPk(tenantId), PaletteResultEntity.GetSk(), ct);

    private async Task<PaletteDto> ToDtoAsync(PaletteResultEntity palette, string tenantId, string? activeFacePhotoId, string? requestLanguage, CancellationToken ct)
    {
        var tenant = await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(tenantId), ct);
        var language = Localized.Language(tenant?.Language, requestLanguage);
        var items = await repository.GetAllAsync<ItemEntity>(ItemEntity.GetPk(tenantId), ct);
        var compatibility = Evaluate(palette, items);
        var season = SeasonTypeCatalog.Find(palette.SeasonTypeId);

        return new PaletteDto(
            palette.SeasonTypeId,
            season is null ? palette.SeasonTypeId : Localized.Resolve(season.Name, language),
            Colors(palette.FlatteringColorIds, language),
            Colors(palette.AvoidColorIds, language),
            palette.LowConfidence,
            palette.SourcePhotoId is not null && palette.SourcePhotoId == activeFacePhotoId,
            palette.AnalyzedAt,
            new PaletteCompatibilityDto(compatibility.Percent, compatibility.TotalCount, compatibility.CompatibleCount, compatibility.NeutralCount, compatibility.IncompatibleCount,
                compatibility.UnmatchedCount, paletteOptions.CurrentValue.NeutralsCountAsCompatible));
    }

    private PaletteCompatibility Evaluate(PaletteResultEntity palette, IEnumerable<ItemEntity> items) =>
        PaletteCompatibilityRules.Evaluate(items.Select(i => (i.Id, i.ColorIds.FirstOrDefault())), palette.FlatteringColorIds, palette.AvoidColorIds,
            PaletteRuleSettings.From(paletteOptions.CurrentValue));

    private static List<PaletteColorDto> Colors(IEnumerable<string> ids, string language) =>
        ids.Select(ColorCatalog.Find).Where(c => c is not null).Select(c => c!.ToDto(language)).ToList();

    private Task<PaletteResultEntity?> GetEntityAsync(string tenantId, CancellationToken ct) =>
        repository.GetAsync<PaletteResultEntity>(PaletteResultEntity.GetPk(tenantId), PaletteResultEntity.GetSk(), ct);

    private async Task<PhotoEntity?> ActiveFacePhotoAsync(string tenantId, CancellationToken ct) =>
        (await repository.GetAllAsync<PhotoEntity>(PhotoEntity.GetPk(tenantId), PhotoEntity.KindPrefix(PhotoKind.Face), SkOperator.BeginsWith, ct))
        .FirstOrDefault(p => p.Active && StorageKeys.BelongsToTenant(p.S3Key, tenantId));
}
