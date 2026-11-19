using Domain.Enum;

namespace Domain.Events;

/// <summary>Message body put on a worker queue. tenantId comes from the message; workers only touch that tenant.</summary>
public interface IJobRequestedEvent
{
    string TenantId { get; }
    string JobId { get; }
    JobKind Kind { get; }
}

/// <param name="Split">Legacy flag ("splitOutfit"): every photo now runs the same multi-item detection.</param>
/// <param name="Clean">Background removal of one piece the user selected from a draft group (no recognition is used).</param>
public sealed record ItemProcessRequestedEvent(string TenantId, string JobId, string DraftId, bool Split = false, bool Clean = false) : IJobRequestedEvent
{
    public JobKind Kind => Clean ? JobKind.ItemClean : Split ? JobKind.ItemSplit : JobKind.ItemProcess;
}

public sealed record StylistRequestedEvent(string TenantId, string JobId, JobKind Kind) : IJobRequestedEvent;

public sealed record TryOnTarget(TryOnTargetKind Kind, string Id, long Version);

/// <param name="BodyPhotoId">The cache subject: the body photo id, or on the face path the face subject key (TryOnRules.FaceSubjectKey).</param>
/// <param name="Source">Body = render on the body photo; Face = build the figure from FacePhotoId + BodyType + height / size.</param>
public sealed record TryOnRequestedEvent(
    string TenantId,
    string JobId,
    TryOnTarget Target,
    string BodyPhotoId,
    string CreditIdempotencyKey,
    TryOnSource Source = TryOnSource.Body,
    string? FacePhotoId = null,
    BodyType? BodyType = null,
    int? HeightCm = null,
    ClothingSize? Size = null) : IJobRequestedEvent
{
    public JobKind Kind => JobKind.TryOn;
}

public sealed record PaletteRequestedEvent(string TenantId, string JobId, string FacePhotoId) : IJobRequestedEvent
{
    public JobKind Kind => JobKind.Palette;
}
