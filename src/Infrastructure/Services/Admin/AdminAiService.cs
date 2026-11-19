using System.Text.Json;
using System.Text.Json.Nodes;
using Domain.Entity;
using Domain.Events;
using Domain.Extensions;
using Domain.Manager;
using Domain.Options;
using Domain.Services.Admin;
using Domain.Services.Ai;
using Infrastructure.Ai;
using Microsoft.Extensions.Options;

namespace Infrastructure.Services.Admin;

/// <summary>
/// Admin "AI": prompt drafts / publish / rollback over <see cref="PromptCatalog"/>, dry-runs and model tests (run by
/// the Stylist worker, which holds the provider key — the Api never sees it), and the AI model settings
/// (<see cref="SettingsCatalog.AiModels"/> in SSM worker/Ai, model ids checked against the provider's model list).
/// Every publish, rollback, model change and trial is audited; publish / rollback / model changes with before / after.
/// </summary>
public sealed class AdminAiService(
    IRepository repository,
    IEventManager events,
    ISettingsStore settingsStore,
    IAuditLog audit,
    IOptionsMonitor<CatalogImageOptions> catalogImages,
    TimeProvider time,
    string stage) : IAdminAiService
{
    /// <summary>Trials (each may cost one AI call) per admin per hour.</summary>
    public const int TrialsPerHour = 30;
    public const int MaxInputLength = 20000;
    public const int MaxImages = 6;
    public const int MaxNoteLength = 500;
    /// <summary>The SSM reload interval of every Lambda (SsmConfigurationExtensions.ReloadAfter).</summary>
    public const int ReloadSeconds = 60;

    // ── Prompts ────────────────────────────────────────────────────────────────────────────────────────────────────

    public async Task<AiPromptListDto> ListPromptsAsync(CancellationToken ct)
    {
        var heads = (await repository.GetAllAsync<AiPromptEntity>(AiPromptEntity.GetPk(), ct)).ToDictionary(h => h.Key, StringComparer.Ordinal);
        var drafts = (await repository.GetAllAsync<AiPromptDraftEntity>(AiPromptDraftEntity.GetPk(), ct)).ToDictionary(d => d.Key, StringComparer.Ordinal);
        return new AiPromptListDto(PromptCatalog.All.Select(d => Summary(d, heads.GetValueOrDefault(d.Key), drafts.GetValueOrDefault(d.Key))).ToList());
    }

    public async Task<AiPromptDetailDto?> GetPromptAsync(string key, CancellationToken ct)
    {
        var definition = PromptCatalog.Find(key);
        return definition is null ? null : await DetailAsync(definition, ct);
    }

    public async Task<AiPromptResult> SaveDraftAsync(AdminUserEntity actor, string key, string? text, CancellationToken ct)
    {
        var definition = PromptCatalog.Find(key);
        if (definition is null)
            return new AiPromptResult(AiPromptOutcome.NotFound);
        var errors = PromptCatalog.Validate(definition, text);
        if (errors.Count > 0)
            return new AiPromptResult(AiPromptOutcome.Invalid, Errors: errors);

        var head = await HeadAsync(key, ct);
        await repository.SaveAsync(new AiPromptDraftEntity
        {
            Key = key,
            Text = text!,
            BaseVersion = head?.PublishedVersion ?? 0,
            UpdatedBy = actor.Email,
            UpdatedAt = Now(),
        }, ct);
        return new AiPromptResult(AiPromptOutcome.Ok, await DetailAsync(definition, ct));
    }

    public async Task<AiPromptResult> DiscardDraftAsync(AdminUserEntity actor, string key, CancellationToken ct)
    {
        var definition = PromptCatalog.Find(key);
        if (definition is null)
            return new AiPromptResult(AiPromptOutcome.NotFound);
        await repository.DeleteAsync(AiPromptDraftEntity.GetPk(), AiPromptDraftEntity.GetSk(key), ct);
        return new AiPromptResult(AiPromptOutcome.Ok, await DetailAsync(definition, ct));
    }

    public async Task<AiPromptResult> PublishAsync(AdminUserEntity actor, string key, string? note, int? expectedVersion, string? ip, CancellationToken ct)
    {
        var definition = PromptCatalog.Find(key);
        if (definition is null)
            return new AiPromptResult(AiPromptOutcome.NotFound);
        if (!definition.Editable)
            return new AiPromptResult(AiPromptOutcome.Invalid, Errors: new Dictionary<string, string[]> { ["text"] = ["read_only"] });
        if (NoteError(note) is { } noteErrors)
            return noteErrors;
        var draft = await repository.GetAsync<AiPromptDraftEntity>(AiPromptDraftEntity.GetPk(), AiPromptDraftEntity.GetSk(key), ct);
        if (draft is null)
            return new AiPromptResult(AiPromptOutcome.NoDraft);
        var errors = PromptCatalog.Validate(definition, draft.Text);
        if (errors.Count > 0)
            return new AiPromptResult(AiPromptOutcome.Invalid, Errors: errors);

        var head = await HeadAsync(key, ct) ?? new AiPromptEntity { Key = key };
        if (expectedVersion is { } expected && expected != head.PublishedVersion)
            return new AiPromptResult(AiPromptOutcome.Conflict);
        if (head.Text == draft.Text)
            return new AiPromptResult(AiPromptOutcome.AlreadyLive);

        return await WriteLiveAsync(definition, head, draft.Text, "publish", null, actor, note, ip, deleteDraft: true, ct);
    }

    public async Task<AiPromptResult> RollbackAsync(AdminUserEntity actor, string key, int toVersion, string? note, string? ip, CancellationToken ct)
    {
        var definition = PromptCatalog.Find(key);
        if (definition is null || !definition.Editable)
            return new AiPromptResult(AiPromptOutcome.NotFound);
        if (NoteError(note) is { } noteErrors)
            return noteErrors;
        var head = await HeadAsync(key, ct) ?? new AiPromptEntity { Key = key };
        string? text = null;
        if (toVersion != 0)
        {
            var target = await repository.GetAsync<AiPromptVersionEntity>(AiPromptVersionEntity.GetPk(key), AiPromptVersionEntity.GetSk(toVersion), ct);
            if (target is null)
                return new AiPromptResult(AiPromptOutcome.VersionNotFound);
            text = target.Text;
        }
        if (head.Text == text)
            return new AiPromptResult(AiPromptOutcome.AlreadyLive);
        return await WriteLiveAsync(definition, head, text, "rollback", toVersion, actor, note, ip, deleteDraft: false, ct);
    }

    public async Task<AiPromptResult> AcknowledgeFallbackAsync(AdminUserEntity actor, string key, CancellationToken ct)
    {
        var definition = PromptCatalog.Find(key);
        var head = definition is null ? null : await HeadAsync(key, ct);
        if (definition is null || head?.Fallback is null)
            return new AiPromptResult(AiPromptOutcome.NotFound);
        head.Fallback = head.Fallback with { Acknowledged = true };
        if (!await repository.SaveIfVersionAsync(head, head.Version, ct))
            return new AiPromptResult(AiPromptOutcome.Conflict);
        return new AiPromptResult(AiPromptOutcome.Ok, await DetailAsync(definition, ct));
    }

    /// <summary>A new history entry with <paramref name="text"/> (null = code default) becomes live; the head moves in the same transaction.</summary>
    private async Task<AiPromptResult> WriteLiveAsync(PromptDefinition definition, AiPromptEntity head, string? text, string action, int? sourceVersion,
        AdminUserEntity actor, string? note, string? ip, bool deleteDraft, CancellationToken ct)
    {
        var now = Now();
        var before = new { version = head.PublishedVersion, text = head.Text ?? "(code default)" };
        var entry = new AiPromptVersionEntity
        {
            Key = definition.Key,
            Number = head.PublishedVersion + 1,
            Text = text,
            Action = action,
            SourceVersion = sourceVersion,
            Author = actor.Email,
            At = now,
            Note = string.IsNullOrWhiteSpace(note) ? null : note.Trim(),
        };
        head.PublishedVersion = entry.Number;
        head.Text = text;
        head.PublishedBy = actor.Email;
        head.PublishedAt = now;
        head.Note = entry.Note;
        head.Fallback = null;

        List<TransactWriteOperation> operations = [TransactWriteOperation.PutVersioned(head), TransactWriteOperation.Create(entry)];
        if (deleteDraft)
            operations.Add(TransactWriteOperation.Delete(AiPromptDraftEntity.GetPk(), AiPromptDraftEntity.GetSk(definition.Key)));
        var result = await repository.TransactWriteAsync(operations, ct);
        if (!result.Applied)
            return new AiPromptResult(AiPromptOutcome.Conflict);

        await audit.WriteAsync(actor, $"ai.prompt.{action}", "ai_prompt", definition.Key, before,
            new { version = entry.Number, sourceVersion, text = text ?? "(code default)", note = entry.Note }, ip, ct);
        return new AiPromptResult(AiPromptOutcome.Ok, await DetailAsync(definition, ct));
    }

    private static AiPromptResult? NoteError(string? note) =>
        note is { Length: > MaxNoteLength }
            ? new AiPromptResult(AiPromptOutcome.Invalid, Errors: new Dictionary<string, string[]> { ["note"] = ["too_long"] })
            : null;

    private Task<AiPromptEntity?> HeadAsync(string key, CancellationToken ct) =>
        repository.GetAsync<AiPromptEntity>(AiPromptEntity.GetPk(), AiPromptEntity.GetSk(key), ct);

    private async Task<AiPromptDetailDto> DetailAsync(PromptDefinition definition, CancellationToken ct)
    {
        var head = await HeadAsync(definition.Key, ct);
        var draft = await repository.GetAsync<AiPromptDraftEntity>(AiPromptDraftEntity.GetPk(), AiPromptDraftEntity.GetSk(definition.Key), ct);
        var history = definition.Editable
            ? (await repository.GetAllAsync<AiPromptVersionEntity>(AiPromptVersionEntity.GetPk(definition.Key), ct)).OrderByDescending(v => v.Number).ToList()
            : [];
        var defaultText = definition.Default();
        var schema = definition.Kind == PromptKind.Schema
            ? null
            : PromptCatalog.All.FirstOrDefault(d => d.Kind == PromptKind.Schema && d.Operation == definition.Operation)?.Default();
        return new AiPromptDetailDto(
            Summary(definition, head, draft),
            defaultText,
            head?.Text,
            draft?.Text,
            draft?.BaseVersion,
            definition.Variables.Select(v => new AiPromptVariableDto(v.Name, v.Required, v.Description, v.Sample)).ToList(),
            definition.Editable ? definition.MaxLength : null,
            PromptTemplate.StaticPrefixLength(defaultText),
            !definition.Editable ? "none" : definition.Trial == PromptTrialTarget.None ? "preview" : "chat",
            definition.ImagesRequired,
            PromptCatalog.StylistKind(definition.Trial) is null ? null : PromptCatalog.SampleInput(definition.Trial),
            schema,
            draft is null ? [] : PromptCatalog.CacheWarnings(definition, draft.Text),
            history.Select(v => new AiPromptVersionDto(v.Number, v.Action, v.Text, v.SourceVersion, v.Author, v.At, v.Note, v.Number == head?.PublishedVersion)).ToList());
    }

    private static AiPromptSummaryDto Summary(PromptDefinition definition, AiPromptEntity? head, AiPromptDraftEntity? draft) => new(
        definition.Key, definition.Feature, definition.Operation, KindName(definition.Kind), definition.Position, definition.Description, definition.Editable,
        head?.PublishedVersion ?? 0, head?.Text is not null, head?.PublishedBy, head?.PublishedAt,
        draft is not null, draft?.UpdatedBy, draft?.UpdatedAt,
        head?.Fallback is { } f ? new AiPromptFallbackDto(f.At, f.FromVersion, f.ToVersion, f.Failures, f.Reason, f.Acknowledged) : null);

    private static string KindName(PromptKind kind) => kind switch
    {
        PromptKind.Instructions => "instructions",
        PromptKind.Fragment => "fragment",
        PromptKind.Request => "request",
        PromptKind.Image => "image",
        _ => "schema",
    };

    // ── Trials ─────────────────────────────────────────────────────────────────────────────────────────────────────

    public async Task<AiTrialResult> StartTrialAsync(AdminUserEntity actor, AiTrialRequest request, string? ip, CancellationToken ct)
    {
        var now = Now();
        var trial = new AiTrialEntity
        {
            Id = Ulid.NewMonotonic(now),
            Type = request.Type,
            Status = AiTrialStatus.Queued,
            CreatedBy = actor.Email,
            CreatedAt = now,
        };
        var errors = new Dictionary<string, string[]>(StringComparer.Ordinal);
        var preview = false;
        switch (request.Type)
        {
            case AiTrialType.Prompt:
                var definition = request.Key is null ? null : PromptCatalog.Find(request.Key);
                if (definition is null || !definition.Editable)
                    return new AiTrialResult(AiTrialOutcome.NotFound);
                var text = request.Text;
                if (text is null)
                {
                    var draft = await repository.GetAsync<AiPromptDraftEntity>(AiPromptDraftEntity.GetPk(), AiPromptDraftEntity.GetSk(definition.Key), ct);
                    text = draft?.Text ?? (await HeadAsync(definition.Key, ct))?.Text ?? definition.Default();
                }
                foreach (var (field, codes) in PromptCatalog.Validate(definition, text))
                    errors[field] = codes;
                trial.Key = definition.Key;
                trial.Text = text;
                preview = definition.Trial == PromptTrialTarget.None;
                if (PromptCatalog.StylistKind(definition.Trial) is not null)
                {
                    var input = request.Input ?? PromptCatalog.SampleInput(definition.Trial);
                    if (input.Length > MaxInputLength || !IsJsonObject(input))
                        errors["input"] = ["invalid_json"];
                    trial.Input = input;
                }
                if (!preview && definition.ImagesRequired > 0)
                {
                    var urls = request.ImageUrls ?? [];
                    if (urls.Count < definition.ImagesRequired || urls.Count > MaxImages)
                        errors["imageUrls"] = ["count"];
                    else if (urls.Any(u => !IsCatalogImageUrl(u)))
                        errors["imageUrls"] = ["invalid_url"];
                    trial.ImageUrls = [.. urls];
                }
                break;
            case AiTrialType.Model:
                if (request.Model is null || !SettingsCatalog.ModelIdPattern().IsMatch(request.Model))
                    errors["model"] = ["invalid"];
                if (request.ModelKind is not ("text" or "image"))
                    errors["modelKind"] = ["invalid"];
                if (request.Effort is not null && !SettingsCatalog.ReasoningEfforts.Contains(request.Effort))
                    errors["effort"] = ["invalid"];
                if (request.ServiceTier is not null && !SettingsCatalog.ServiceTiers.Contains(request.ServiceTier))
                    errors["serviceTier"] = ["invalid"];
                trial.Model = request.Model;
                trial.ModelKind = request.ModelKind;
                trial.Effort = request.Effort;
                trial.ServiceTier = request.ServiceTier;
                break;
        }
        if (errors.Count > 0)
            return new AiTrialResult(AiTrialOutcome.Invalid, Errors: errors);

        if (preview)
        {
            // Image prompts: rendered with the sample values only — an image call costs far more than a text call and its
            // output would need storage; the published prompt is exercised by a real try-on / cleanup on dev.
            var definition = PromptCatalog.Find(trial.Key!)!;
            trial.Status = AiTrialStatus.Succeeded;
            trial.FinishedAt = now;
            trial.Output = PromptTemplate.Render(trial.Text!, PromptCatalog.SampleValues(definition));
            trial.UserPrompt = trial.Output;
            await repository.SaveAsync(trial, ct);
            return new AiTrialResult(AiTrialOutcome.Ok, ToDto(trial));
        }

        var hour = now.ToUnixTimeSeconds() / 3600;
        var count = await repository.IncrementCounterAsync("ai#trialrate", $"{actor.Id}#{hour}", "count", (hour + 2) * 3600, ct);
        if (count > TrialsPerHour)
            return new AiTrialResult(AiTrialOutcome.RateLimited);

        await repository.SaveAsync(trial, ct);
        await events.PublishAsync(new AiTrialRequestedEvent(trial.Id), ct);
        await audit.WriteAsync(actor, "ai.trial", "ai_trial", trial.Id, null,
            new { type = trial.Type, key = trial.Key, model = trial.Model, modelKind = trial.ModelKind, effort = trial.Effort, images = trial.ImageUrls.Count }, ip, ct);
        return new AiTrialResult(AiTrialOutcome.Ok, ToDto(trial));
    }

    public async Task<AiTrialDto?> GetTrialAsync(string id, CancellationToken ct) =>
        await repository.GetAsync<AiTrialEntity>(AiTrialEntity.GetPk(), AiTrialEntity.GetSk(id), ct) is { } trial ? ToDto(trial) : null;

    private static AiTrialDto ToDto(AiTrialEntity t) => new(
        t.Id, t.Type, t.Status, t.CreatedAt, t.FinishedAt, t.Key, t.Model, t.Effort, t.Output, t.Parsed, t.ParseError, t.Error, t.LatencyMs, t.UsedModel,
        t.InputTokens, t.CachedTokens, t.OutputTokens, t.SystemPrompt, t.UserPrompt);

    private static bool IsJsonObject(string text)
    {
        try
        {
            return JsonNode.Parse(text) is JsonObject;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    /// <summary>Only images on our own catalog image host (uploaded through the panel) — the worker never fetches arbitrary URLs.</summary>
    private bool IsCatalogImageUrl(string url) =>
        catalogImages.CurrentValue.PublicHost is { } host
        && Uri.TryCreate(url, UriKind.Absolute, out var uri)
        && uri.Scheme == Uri.UriSchemeHttps
        && string.Equals(uri.Host, host, StringComparison.OrdinalIgnoreCase);

    // ── Models ─────────────────────────────────────────────────────────────────────────────────────────────────────

    private string AiParameter => SettingsCatalog.AiModels.Parameters[0].Name(stage);

    public async Task<AiModelSettingsDto> GetModelSettingsAsync(CancellationToken ct)
    {
        var json = await settingsStore.GetAsync(AiParameter, ct);
        var models = await repository.GetAsync<AiModelListEntity>(AiModelListEntity.GetPk(), AiModelListEntity.GetSk(), ct);
        return new AiModelSettingsDto(SettingsCatalog.Read(SettingsCatalog.AiModels, stage, json), models?.Ids ?? [], models?.FetchedAt, ReloadSeconds);
    }

    public async Task<SettingWriteResult> UpdateModelSettingsAsync(AdminUserEntity actor, IReadOnlyDictionary<string, JsonElement> values, string? ip, CancellationToken ct)
    {
        var group = SettingsCatalog.AiModels;
        var errors = SettingsCatalog.Validate(group, values);
        var modelValues = values
            .Where(v => !errors.ContainsKey(v.Key) && v.Value.ValueKind == JsonValueKind.String
                        && group.Fields.FirstOrDefault(f => f.Key == v.Key)?.Type == Domain.Services.Admin.SettingFieldType.Model)
            .ToList();
        if (modelValues.Count > 0)
        {
            // Allow-list: the ids the provider key can use (GET /v1/models, refreshed from the panel by a "models" trial).
            var list = await repository.GetAsync<AiModelListEntity>(AiModelListEntity.GetPk(), AiModelListEntity.GetSk(), ct);
            foreach (var (key, value) in modelValues)
            {
                if (list is null || list.Ids.Count == 0)
                    errors[key] = ["models_unknown"];
                else if (!list.Ids.Contains(value.GetString()!, StringComparer.Ordinal))
                    errors[key] = ["not_available"];
            }
        }
        if (errors.Count > 0)
            return new SettingWriteResult(SettingWriteOutcome.Invalid, Errors: errors);

        var name = AiParameter;
        var current = await settingsStore.GetAsync(name, ct);
        var before = SettingsCatalog.Read(group, stage, current);
        var next = SettingsCatalog.Apply(current, values);
        await settingsStore.PutAsync(name, next, ct);
        var after = SettingsCatalog.Read(group, stage, next);

        var changed = values.Keys.ToHashSet(StringComparer.Ordinal);
        await audit.WriteAsync(actor, "ai.models.update", "setting", group.Name,
            before.Fields.Where(f => changed.Contains(f.Key)).ToDictionary(f => f.Key, f => f.Value),
            after.Fields.Where(f => changed.Contains(f.Key)).ToDictionary(f => f.Key, f => f.Value), ip, ct);
        return new SettingWriteResult(SettingWriteOutcome.Ok, after);
    }

    private DateTime Now() => time.GetUtcNow().UtcDateTime;
}
