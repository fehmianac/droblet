using Domain.Entity;
using Domain.Enum;

namespace Domain.Services;

/// <summary>What each consent-gated feature needs (docs/legal REVIEW §5 G1/G4). One list, used by the API guards and the docs.</summary>
public static class ConsentRules
{
    /// <summary>Body photo upload / activation and every try-on render: OpenAI (US) processes the photo.</summary>
    public static readonly IReadOnlyList<ConsentType> BodyPhoto = [ConsentType.BodyPhotoAi, ConsentType.CrossBorderTransfer];

    /// <summary>Face photo upload / activation and palette analysis: OpenAI (US) processes the photo.</summary>
    public static readonly IReadOnlyList<ConsentType> FacePhoto = [ConsentType.FacePhotoPalette, ConsentType.CrossBorderTransfer];

    public static readonly IReadOnlyList<ConsentType> Contacts = [ConsentType.Contacts];
    public static readonly IReadOnlyList<ConsentType> Weight = [ConsentType.Weight];

    /// <summary>The weekly edit and price-drop pushes (consent 5). Morning outfit and follow requests are service messages.</summary>
    public static readonly IReadOnlyList<ConsentType> Marketing = [ConsentType.MarketingNotifications];

    public static IReadOnlyList<ConsentType> ForPhoto(PhotoKind kind) => kind == PhotoKind.Body ? BodyPhoto : FacePhoto;

    /// <summary>A consent counts only when granted on the CURRENT text version — a new text re-prompts.</summary>
    public static bool IsValid(ConsentEntity? consent, string currentVersion) =>
        consent is { Granted: true } && string.Equals(consent.Version, currentVersion, StringComparison.Ordinal);

    public const int MaxSourceLength = 40;
}

public sealed record ConsentStateDto(
    ConsentType Type,
    bool Granted,
    string? Version,
    string CurrentVersion,
    bool Valid,
    DateTime? GrantedAt,
    DateTime? WithdrawnAt,
    string? Locale,
    string? Source);

public sealed record ConsentsDto(IReadOnlyList<ConsentStateDto> Consents);

public sealed record ConsentHistoryItemDto(ConsentType Type, bool Granted, string Version, DateTime At, string? Locale, string? Source);

public sealed record ConsentHistoryDto(IReadOnlyList<ConsentHistoryItemDto> Items);

public sealed record ConsentDecision(ConsentType Type, bool Granted, string Version);

public enum ConsentUpdateOutcome { Ok, VersionOutdated }

public interface IConsentService
{
    /// <summary>All six types, in enum order; never-decided types come back as not granted.</summary>
    Task<ConsentsDto> GetAsync(string tenantId, CancellationToken ct);

    Task<ConsentHistoryDto> GetHistoryAsync(string tenantId, CancellationToken ct);

    /// <summary>
    /// Records decisions: each one appends a history row and moves the current row. Granting needs the current text
    /// version (else VersionOutdated, nothing written). A decision equal to the current state (same granted + version) is a no-op.
    /// Side effects of a withdrawal: marketing → weekly edit and price-drop pushes off; weight → stored weight cleared.
    /// </summary>
    Task<(ConsentUpdateOutcome Outcome, ConsentsDto Consents)> SetAsync(
        string tenantId, string userId, IReadOnlyList<ConsentDecision> decisions, string? source, string? locale, CancellationToken ct);

    /// <summary>Records a withdrawal caused by another action (photo deleted). No-op when the consent is not granted.</summary>
    Task WithdrawAsync(string tenantId, string? userId, ConsentType type, string source, CancellationToken ct);

    /// <summary>The types among <paramref name="required"/> without a valid consent (empty = allowed).</summary>
    Task<IReadOnlyList<ConsentType>> MissingAsync(string tenantId, IReadOnlyList<ConsentType> required, CancellationToken ct);
}
