using Domain.Enum;

namespace Domain.Services;

/// <summary>The moderation state of a report's target, for the audit log (before / after).</summary>
public sealed record ModerationTargetSnapshot(
    ReportTargetKind Kind,
    string TenantId,
    string? TargetId,
    bool Exists,
    bool Hidden,
    DateTime? HiddenAt = null,
    string? ReportId = null);

public enum ContentModerationOutcome
{
    /// <summary>The target's flag changed (hidden, or visible again).</summary>
    Applied,
    /// <summary>Nothing to do: already in the wanted state, or this report already removed its content once.</summary>
    Unchanged,
    /// <summary>The look / item / account no longer exists: nothing to hide, the decision still stands.</summary>
    TargetMissing,
    ReportNotFound,
    ReportNotResolved,
    /// <summary>The report was resolved with another resolution than contentRemoved.</summary>
    NotContentRemoved,
}

public sealed record ContentModerationResult(ContentModerationOutcome Outcome, ModerationTargetSnapshot? Before = null, ModerationTargetSnapshot? After = null);

/// <summary>
/// Turns a contentRemoved decision into actual removal. Looks and items get a moderation flag that every cross-tenant read
/// drops (the owner keeps them, with a read-only <c>moderation</c> field); a profile keeps its handle but loses its public
/// name, avatar and style tags for others. The owner gets an inbox row (content_removed). Both calls are idempotent.
/// </summary>
public interface IContentModeration
{
    /// <summary>
    /// For a report resolved as contentRemoved: hides its target once. A repeated call (or a call after a restore) never
    /// hides it again. A missing target is not an error.
    /// </summary>
    Task<ContentModerationResult> RemoveAsync(string reportId, CancellationToken ct);

    /// <summary>Admin undo of a contentRemoved decision: the target becomes visible again and the report records who restored it.</summary>
    Task<ContentModerationResult> RestoreAsync(string reportId, string adminUserId, CancellationToken ct);
}
