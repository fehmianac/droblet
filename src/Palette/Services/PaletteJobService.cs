using Domain.Entity;
using Domain.Enum;
using Domain.Events;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Domain.Services.Ai;
using Infrastructure.Workers;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Palette.Services;

public interface IPaletteJobService
{
    Task ProcessAsync(PaletteRequestedEvent message, bool isLastAttempt, CancellationToken ct);
}

/// <summary>Face photo -> season type and tones. Stores only ids/colours, never a copy or crop of the face.</summary>
public sealed class PaletteJobService(
    IJobLifecycle jobs,
    IRepository repository,
    IObjectStorage storage,
    IPaletteAnalyzer analyzer,
    IOptionsMonitor<AiOptions> aiOptions,
    TimeProvider timeProvider,
    ILogger<PaletteJobService> logger) : IPaletteJobService
{
    private const long MaxImageBytes = 15 * 1024 * 1024;

    public async Task ProcessAsync(PaletteRequestedEvent message, bool isLastAttempt, CancellationToken ct)
    {
        var job = await jobs.StartAsync(message.TenantId, message.JobId, ct);
        if (job is null)
            return;

        try
        {
            var face = await ActiveFacePhotoAsync(message.TenantId, message.FacePhotoId, ct);
            var bytes = face is null ? null : await storage.ReadAsync(face.S3Key, MaxImageBytes, ct);
            if (face is null || bytes is null)
            {
                await jobs.FailAsync(job, JobFailure.SourceDeleted, ct);
                return;
            }

            var analysis = await analyzer.AnalyzeAsync(new ImageInput(bytes, face.ContentType), ct);
            if (analysis.FacesDetected != 1)
            {
                await jobs.FailAsync(job, JobFailure.NoFaceDetected, ct);
                return;
            }
            if (string.IsNullOrWhiteSpace(analysis.SeasonTypeId) || analysis.FlatteringColorIds.Intersect(analysis.AvoidColorIds).Any())
            {
                await jobs.FailAsync(job, JobFailure.GuardRejected, ct);
                return;
            }

            if (await ActiveFacePhotoAsync(message.TenantId, message.FacePhotoId, ct) is null)
            {
                await jobs.FailAsync(job, JobFailure.SourceDeleted, ct);
                return;
            }

            await repository.SaveAsync(new PaletteResultEntity
            {
                TenantId = message.TenantId,
                SeasonTypeId = analysis.SeasonTypeId,
                FlatteringColorIds = analysis.FlatteringColorIds.ToList(),
                AvoidColorIds = analysis.AvoidColorIds.ToList(),
                SourcePhotoId = message.FacePhotoId,
                ModelVersion = aiOptions.CurrentValue.ImageModel,
                AnalyzedAt = timeProvider.GetUtcNow().UtcDateTime,
            }, ct);
            await jobs.CompleteAsync(job, $$"""{"seasonTypeId":"{{analysis.SeasonTypeId}}"}""", ct);
        }
        catch (Exception ex) when (!WorkerFailure.IsRetryable(ex, isLastAttempt))
        {
            logger.LogWarning(ex, "Palette job {JobId} failed for tenant {TenantId}", job.Id, job.TenantId);
            await jobs.FailAsync(job, JobFailure.ProviderError, ct);
        }
    }

    private async Task<PhotoEntity?> ActiveFacePhotoAsync(string tenantId, string photoId, CancellationToken ct)
    {
        var photo = await repository.GetAsync<PhotoEntity>(PhotoEntity.GetPk(tenantId), PhotoEntity.GetSk(PhotoKind.Face, photoId), ct);
        return photo is { Active: true } && StorageKeys.BelongsToTenant(photo.S3Key, tenantId) ? photo : null;
    }
}
