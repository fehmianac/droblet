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
            // PaletteOutputGuard: one face, season type from the fixed table; the model's own colour lists are never stored.
            var verdict = PaletteOutputGuard.Evaluate(analysis, aiOptions.CurrentValue.PaletteConfidenceThreshold);
            if (verdict.Outcome is PaletteGuardOutcome.NoFace or PaletteGuardOutcome.PhotoUnsuitable)
            {
                await jobs.FailAsync(job, JobFailure.NoFaceDetected, ct);
                return;
            }
            if (verdict.Outcome != PaletteGuardOutcome.Accepted || verdict.SeasonType is not { } season)
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
                SeasonTypeId = season.Id,
                FlatteringColorIds = season.FlatteringColorIds.ToList(),
                AvoidColorIds = season.AvoidColorIds.ToList(),
                LowConfidence = verdict.LowConfidence,
                SourcePhotoId = message.FacePhotoId,
                ModelVersion = aiOptions.CurrentValue.TextModel,
                AnalyzedAt = timeProvider.GetUtcNow().UtcDateTime,
            }, ct);
            await jobs.CompleteAsync(job, $$"""{"seasonTypeId":"{{season.Id}}","lowConfidence":{{(verdict.LowConfidence ? "true" : "false")}}}""", ct);
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
