using Domain.Domain;
using Domain.Entity;
using Domain.Enum;
using Domain.Events;
using Domain.Extensions;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Domain.Services.Styling;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Infrastructure.Services;

/// <summary>
/// AI flat-lay cover of saved looks, Api side (canvas 21c, owner decision 2026-11-22). A save queues one LookCover job
/// (TryOn worker) when the look's pieces never had a cover requested; the job's state lives in LookCoverEntity, never on
/// the look itself, so the look's version (the app's edit base) is untouched by the background work. No credit, every user.
/// </summary>
public sealed class LookCoverService(
    IRepository repository,
    IEventManager events,
    IObjectStorage storage,
    IOptionsMonitor<PhotoOptions> photoOptions,
    TimeProvider timeProvider,
    ILogger<LookCoverService> logger) : ILookCoverService
{
    private const int MaxVersionRetries = 3;

    private DateTime Now => timeProvider.GetUtcNow().UtcDateTime;

    public async Task<LookCoverEntity?> RequestAsync(LookEntity look, CancellationToken ct)
    {
        if (!LookCoverRules.IsEligible(look))
            return null;
        var hash = LookCoverRules.SlotsHash(look.Slots);
        try
        {
            for (var attempt = 0; attempt < MaxVersionRetries; attempt++)
            {
                var cover = await GetAsync(look.TenantId, look.Id, ct);
                if (!LookCoverRules.NeedsRequest(cover, hash))
                    return cover;   // pending, ready, or failed with its retry used: not again for these pieces

                var now = Now;
                cover ??= new LookCoverEntity { TenantId = look.TenantId, LookId = look.Id };
                // The one retry of a failed cover (same pieces) counts on; new pieces start over.
                cover.Attempts = cover.SlotsHash == hash ? Math.Max(1, cover.Attempts) + 1 : 1;
                cover.SlotsHash = hash;
                cover.RequestedAt = now;
                cover.UpdatedAt = now;
                if (LookCoverRules.ReadyImageKey(cover, hash) is not null)
                {
                    // Back to pieces whose image is still kept (e.g. a change undone before the new cover was ready): no AI call.
                    cover.Status = LookCoverStatus.Ready;
                    if (await repository.SaveIfVersionAsync(cover, cover.Version, ct))
                        return cover;
                    continue;
                }

                var job = new JobEntity
                {
                    Id = Ulid.New(now), TenantId = look.TenantId, Kind = JobKind.LookCover, Status = JobStatus.Queued,
                    Input = StylingJson.Serialize(new { lookId = look.Id, slotsHash = hash }), CreatedAt = now, UpdatedAt = now,
                };
                cover.Status = LookCoverStatus.Pending;
                cover.JobId = job.Id;
                var write = await repository.TransactWriteAsync([TransactWriteOperation.PutVersioned(cover), TransactWriteOperation.Put(job)], ct);
                if (!write.Applied)
                    continue;   // another save of the same look got there first: re-read and decide again

                try
                {
                    await events.PublishAsync(new LookCoverRequestedEvent(look.TenantId, job.Id, look.Id, hash), ct);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    // Never queued: the app must not wait for a cover that will not come.
                    logger.LogWarning(ex, "Look cover job {JobId} of look {LookId} (tenant {TenantId}) could not be queued", job.Id, look.Id, look.TenantId);
                    cover.Status = LookCoverStatus.Failed;
                    cover.UpdatedAt = Now;
                    await repository.SaveIfVersionAsync(cover, cover.Version, ct);
                }
                return cover;
            }
            logger.LogWarning("Look cover of look {LookId} (tenant {TenantId}) not requested: concurrent saves", look.Id, look.TenantId);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // The look is saved; a missing cover only means the app keeps its drawn one.
            logger.LogWarning(ex, "Look cover of look {LookId} (tenant {TenantId}) not requested", look.Id, look.TenantId);
        }
        return null;
    }

    public Task<LookCoverEntity?> GetAsync(string tenantId, string lookId, CancellationToken ct) =>
        repository.GetAsync<LookCoverEntity>(LookCoverEntity.GetPk(tenantId), LookCoverEntity.GetSk(lookId), ct);

    public async Task<IReadOnlyDictionary<string, LookCoverEntity>> GetAllAsync(string tenantId, CancellationToken ct) =>
        (await repository.GetAllAsync<LookCoverEntity>(LookCoverEntity.GetPk(tenantId), ct)).ToDictionary(c => c.LookId, StringComparer.Ordinal);

    public async Task<LookDto> WithCoverAsync(LookEntity look, LookDto dto, LookCoverEntity? cover, CancellationToken ct)
    {
        // An imported look's own photo always wins (it never gets an AI cover).
        if (look.CoverImageKey is { } importKey)
            return StorageKeys.BelongsToTenant(importKey, look.TenantId) ? await SignedAsync(dto, importKey, ct) : dto;
        if (!LookCoverRules.IsEligible(look))
            return dto;

        var hash = LookCoverRules.SlotsHash(look.Slots);
        if (LookCoverRules.ReadyImageKey(cover, hash) is { } key && StorageKeys.BelongsToTenant(key, look.TenantId))
            return await SignedAsync(dto, key, ct);
        return LookCoverRules.IsPending(cover, hash, Now) ? dto with { CoverPending = true } : dto;
    }

    public async Task DeleteAsync(string tenantId, string lookId, CancellationToken ct)
    {
        var cover = await GetAsync(tenantId, lookId, ct);
        if (cover is null)
            return;
        await repository.DeleteAsync(cover.Pk, cover.Sk, ct);
        if (cover.ImageKey is { } key && StorageKeys.BelongsToTenant(key, tenantId))
            await storage.DeleteAsync(key, ct);
    }

    /// <summary>Presigned GET (only a key under the owner's prefix is ever signed).</summary>
    private async Task<LookDto> SignedAsync(LookDto dto, string key, CancellationToken ct)
    {
        var ttl = TimeSpan.FromSeconds(photoOptions.CurrentValue.ReadUrlTtlSeconds);
        return dto with { CoverImageUrl = await storage.CreateReadUrlAsync(key, ttl, ct), CoverImageUrlExpiresAt = Now.Add(ttl), CoverPending = false };
    }
}
