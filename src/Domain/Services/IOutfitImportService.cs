using Domain.Domain;
using Domain.Enum;
using Domain.Services.Ai;

namespace Domain.Services;

// ── Commands ──────────────────────────────────────────────────────────────────────────────────────────────────────

/// <param name="RequestId">Client ULID; becomes the session id (a replay answers the same session with fresh upload slots).</param>
/// <param name="Count">Photos the user picked (1 … the plan's Entitlements:*:OutfitImportMaxPhotos).</param>
public sealed record CreateOutfitImportCommand(string RequestId, int Count);

/// <param name="Ref">The piece ref of the session ("{photoIndex}-{n}"). A piece left out of the list is kept.</param>
public sealed record OutfitImportCommitPiece(string Ref, bool Keep = true);

/// <param name="Keep">False = no look from this photo (its new pieces are still created when another kept look keeps them).</param>
/// <param name="Pieces">Per-piece choices; a piece left out is kept.</param>
public sealed record OutfitImportCommitLook(int PhotoIndex, bool Keep = true, IReadOnlyList<OutfitImportCommitPiece>? Pieces = null);

/// <param name="Looks">Per-photo choices; a ready photo left out is kept with all its pieces ("Tümünü onayla" = an empty list).</param>
public sealed record CommitOutfitImportCommand(IReadOnlyList<OutfitImportCommitLook>? Looks);

// ── DTOs ──────────────────────────────────────────────────────────────────────────────────────────────────────────

public record OutfitImportCountersDto(long Uploaded, long Detected, long Matched, long Ready, long Failed);

/// <summary>Presigned POST of one photo slot (fields first, the file last; image/jpeg, at most MaxBytes).</summary>
public record OutfitImportUploadDto(int Index, string Url, IReadOnlyDictionary<string, string> Fields, DateTime ExpiresAt, long MaxBytes);

/// <summary>match = "Gardırobunda var" (an existing wardrobe item) · new = "Yeni" (created on commit when kept).</summary>
public enum OutfitImportPieceKind { Match, New }

/// <param name="Ref">Commit reference of this piece in this photo.</param>
/// <param name="PieceId">New pieces: the session piece (the same id in every photo that shows it; the item id after commit).</param>
/// <param name="Slot">Look slot; null = an extra piece (saved as an item only, a look holds one piece per slot).</param>
/// <param name="ImageUrl">The crop from the photo (new) or the wardrobe item's image (match).</param>
/// <param name="AlsoIn">Other photos of the session showing the same new piece (de-duplicated: created once).</param>
public record OutfitImportPieceDto(
    string Ref,
    OutfitImportPieceKind Kind,
    string? ItemId,
    string? PieceId,
    string? Name,
    ItemCategory Category,
    string? Subcategory,
    IReadOnlyList<string> ColorIds,
    OutfitSlot? Slot,
    string? ImageUrl,
    double? MatchConfidence,
    IReadOnlyList<int> AlsoIn);

/// <param name="LookId">Id of the look a commit creates from this photo.</param>
public record OutfitImportPhotoDto(int Index, OutfitImportPhotoStatus Status, JobFailure? Failure, string? ImageUrl, string LookId, IReadOnlyList<OutfitImportPieceDto> Pieces);

public record OutfitImportLookResultDto(int PhotoIndex, string Outcome, string? Code, string? LookId);

public record OutfitImportItemResultDto(string PieceId, ItemCreateOutcome Outcome, string? Code, string? ItemId);

/// <param name="CleanupJobCount">Background removal jobs queued (one per new piece kept; matched pieces cost nothing).</param>
public record OutfitImportCommitResultDto(
    IReadOnlyList<OutfitImportLookResultDto> Looks,
    IReadOnlyList<OutfitImportItemResultDto> Items,
    int CreatedLookCount,
    int CreatedItemCount,
    int CleanupJobCount);

/// <param name="Status">uploading · processing · ready (review) · failed (no photo gave a look) · committed.</param>
/// <param name="Count">Photo slots of the session; <paramref name="Requested"/> = what the user picked.</param>
public record OutfitImportDto(
    string Id,
    OutfitImportPhase Status,
    int Count,
    int Requested,
    OutfitImportCountersDto Counters,
    IReadOnlyList<OutfitImportPhotoDto> Photos,
    int NewPieceCount,
    int MatchedPieceCount,
    DateTime CreatedAt,
    DateTime ExpiresAt,
    DateTime? ImageUrlExpiresAt,
    OutfitImportCommitResultDto? Result);

/// <param name="Uploads">One slot per photo not uploaded yet.</param>
/// <param name="Skipped">Picked photos beyond a non-member's remaining recognitions (no slot).</param>
/// <param name="MaxPhotos">The plan's photo limit (the app's picker follows it).</param>
public record OutfitImportCreatedDto(OutfitImportDto Session, IReadOnlyList<OutfitImportUploadDto> Uploads, int Skipped, int MaxPhotos, ItemRecognitionDto ItemRecognition);

/// <summary>"Kombinlerini içe aktar": sessions, uploads, review and commit (Api side). The photos are processed by the worker.</summary>
public interface IOutfitImportService
{
    Task<ServiceResult<OutfitImportCreatedDto>> CreateAsync(string tenantId, CreateOutfitImportCommand command, string? requestLanguage, CancellationToken ct);
    Task<IReadOnlyList<OutfitImportDto>> GetOpenAsync(string tenantId, CancellationToken ct);
    Task<OutfitImportDto?> GetAsync(string tenantId, string sessionId, CancellationToken ct);
    Task<ServiceResult<OutfitImportDto>> MarkUploadedAsync(string tenantId, string sessionId, int index, CancellationToken ct);
    Task<ServiceResult<OutfitImportCommitResultDto>> CommitAsync(string tenantId, string sessionId, CommitOutfitImportCommand command, CancellationToken ct);
    Task<bool> DiscardAsync(string tenantId, string sessionId, CancellationToken ct);
}

/// <summary>A new wardrobe piece created by an outfit import commit (WardrobeService: receipt + item, entitlement check).</summary>
public sealed record ImportedItemCommand(
    string ClientMutationId,
    string ItemId,
    string? Name,
    ItemCategory Category,
    string? Subcategory,
    IReadOnlyList<string> ColorIds,
    string? Fabric,
    IReadOnlyList<Season> Seasons,
    string OriginalImageKey);
