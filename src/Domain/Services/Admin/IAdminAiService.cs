using System.Text.Json;
using Domain.Entity;

namespace Domain.Services.Admin;

// ── AI prompts and models (admin "AI", permission ai.manage; docs/api/admin.md §5b) ──────────────────────────────

public sealed record AiPromptVariableDto(string Name, bool Required, string Description, string Sample);

public sealed record AiPromptFallbackDto(DateTime At, int FromVersion, int ToVersion, long Failures, string Reason, bool Acknowledged);

/// <param name="Kind">instructions | fragment | request | image | schema.</param>
/// <param name="Position">Where the text goes: system | system_suffix | user | image_prompt | response_format.</param>
/// <param name="PublishedVersion">History number of the live entry (0 = never published; the code default is live).</param>
/// <param name="Overridden">The live text is an override (false = the code default, also after a rollback to it).</param>
public sealed record AiPromptSummaryDto(
    string Key, string Feature, string Operation, string Kind, string Position, string Description, bool Editable,
    int PublishedVersion, bool Overridden, string? PublishedBy, DateTime? PublishedAt,
    bool HasDraft, string? DraftUpdatedBy, DateTime? DraftUpdatedAt, AiPromptFallbackDto? Fallback);

public sealed record AiPromptListDto(IReadOnlyList<AiPromptSummaryDto> Items);

/// <param name="Action">publish | rollback | auto_fallback.</param>
/// <param name="Text">null = the code default.</param>
public sealed record AiPromptVersionDto(int Version, string Action, string? Text, int? SourceVersion, string? Author, DateTime At, string? Note, bool Live);

/// <param name="DefaultText">The shipped template (code default).</param>
/// <param name="PublishedText">The live override; null = the code default is live.</param>
/// <param name="DefaultStaticPrefix">Characters before the first placeholder in the code default (prompt-cache prefix).</param>
/// <param name="TrialMode">chat = "Dene" makes one model call; preview = image prompt, rendered with the sample values only.</param>
/// <param name="Schema">The strict JSON schema of the operation's answer (view only).</param>
/// <param name="Warnings">Prompt-cache warnings of the draft (cache_prefix_shorter).</param>
public sealed record AiPromptDetailDto(
    AiPromptSummaryDto Summary, string DefaultText, string? PublishedText, string? DraftText, int? DraftBaseVersion,
    IReadOnlyList<AiPromptVariableDto> Variables, int? MaxLength, int DefaultStaticPrefix, string TrialMode, int ImagesRequired,
    string? SampleInput, string? Schema, IReadOnlyList<string> Warnings, IReadOnlyList<AiPromptVersionDto> History);

public enum AiPromptOutcome { Ok, NotFound, Invalid, NoDraft, Conflict, VersionNotFound, AlreadyLive }

public sealed record AiPromptResult(AiPromptOutcome Outcome, AiPromptDetailDto? Prompt = null, IReadOnlyDictionary<string, string[]>? Errors = null);

/// <param name="Type">prompt (dry-run of a draft) | model (one tiny call with a model) | models (refresh the model allow-list).</param>
/// <param name="Text">prompt: the template to try (default: the saved draft).</param>
/// <param name="Input">prompt, stylist keys: the user message JSON (default: the built-in sample).</param>
/// <param name="ImageUrls">prompt, vision keys: https URLs on the catalog image host (uploaded through v1/admin/image/upload-url).</param>
/// <param name="ModelKind">model: text (a chat call) | image (access check only).</param>
public sealed record AiTrialRequest(
    AiTrialType Type, string? Key = null, string? Text = null, string? Input = null, IReadOnlyList<string>? ImageUrls = null,
    string? Model = null, string? ModelKind = null, string? Effort = null, string? ServiceTier = null);

public sealed record AiTrialDto(
    string Id, AiTrialType Type, AiTrialStatus Status, DateTime CreatedAt, DateTime? FinishedAt, string? Key, string? Model, string? Effort,
    string? Output, bool? Parsed, string? ParseError, string? Error, long? LatencyMs, string? UsedModel,
    long? InputTokens, long? CachedTokens, long? OutputTokens, string? SystemPrompt, string? UserPrompt);

public enum AiTrialOutcome { Ok, Invalid, NotFound, RateLimited }

public sealed record AiTrialResult(AiTrialOutcome Outcome, AiTrialDto? Trial = null, IReadOnlyDictionary<string, string[]>? Errors = null);

/// <param name="Settings">The aiModels settings group (worker/Ai) as stored.</param>
/// <param name="AvailableModels">Model ids the provider key can use (allow-list), from the last refresh; empty = never fetched.</param>
/// <param name="ReloadSeconds">How long until a Lambda applies a change (SSM reload interval).</param>
public sealed record AiModelSettingsDto(SettingGroupDto Settings, IReadOnlyList<string> AvailableModels, DateTime? ModelsFetchedAt, int ReloadSeconds);

public interface IAdminAiService
{
    Task<AiPromptListDto> ListPromptsAsync(CancellationToken ct);
    Task<AiPromptDetailDto?> GetPromptAsync(string key, CancellationToken ct);
    Task<AiPromptResult> SaveDraftAsync(AdminUserEntity actor, string key, string? text, CancellationToken ct);
    Task<AiPromptResult> DiscardDraftAsync(AdminUserEntity actor, string key, CancellationToken ct);
    /// <param name="expectedVersion">The published version the admin saw; another publish since → Conflict.</param>
    Task<AiPromptResult> PublishAsync(AdminUserEntity actor, string key, string? note, int? expectedVersion, string? ip, CancellationToken ct);
    /// <param name="toVersion">A history entry, or 0 = the code default.</param>
    Task<AiPromptResult> RollbackAsync(AdminUserEntity actor, string key, int toVersion, string? note, string? ip, CancellationToken ct);
    Task<AiPromptResult> AcknowledgeFallbackAsync(AdminUserEntity actor, string key, CancellationToken ct);

    Task<AiTrialResult> StartTrialAsync(AdminUserEntity actor, AiTrialRequest request, string? ip, CancellationToken ct);
    Task<AiTrialDto?> GetTrialAsync(string id, CancellationToken ct);

    Task<AiModelSettingsDto> GetModelSettingsAsync(CancellationToken ct);
    Task<SettingWriteResult> UpdateModelSettingsAsync(AdminUserEntity actor, IReadOnlyDictionary<string, JsonElement> values, string? ip, CancellationToken ct);
}
