using System.Text.Json.Serialization;
using Domain.Entity.Base;
using Domain.Extensions;

namespace Domain.Entity;

// AI prompt overrides (admin "AI → Promptlar"). Each stage has its own table, so dev and prod never share an override.
// Lambdas read only the published rows (one Query of partition ai#prompt, cached ~60 s); drafts and history live in
// other partitions so that read stays small.

/// <summary>
/// The live version of one prompt key. Text null = the code default is live (never published, or rolled back to it).
/// Version (optimistic concurrency) is not the published version number: that is <see cref="PublishedVersion"/>.
/// </summary>
public class AiPromptEntity : IVersionedEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk();
    [JsonPropertyName("sk")] public string Sk => GetSk(Key);

    [JsonPropertyName("key")] public string Key { get; set; } = null!;
    /// <summary>Number of the history entry that is live (0 = nothing published yet).</summary>
    [JsonPropertyName("publishedVersion")] public int PublishedVersion { get; set; }
    /// <summary>The live template; null = the code default.</summary>
    [JsonPropertyName("text")] public string? Text { get; set; }
    [JsonPropertyName("publishedBy")] public string? PublishedBy { get; set; }
    [JsonPropertyName("publishedAt")] public DateTime? PublishedAt { get; set; }
    [JsonPropertyName("note")] public string? Note { get; set; }
    /// <summary>Set when the runtime safety switched this prompt back (cleared by the next publish or an acknowledge).</summary>
    [JsonPropertyName("fallback")] public AiPromptFallback? Fallback { get; set; }
    [JsonPropertyName("version")] public long Version { get; set; }

    public static string GetPk() => "ai#prompt";
    public static string GetSk(string key) => key;
}

/// <param name="FromVersion">The published version that failed.</param>
/// <param name="ToVersion">The new history entry that holds the restored text (previous version or the code default).</param>
public sealed record AiPromptFallback(
    [property: JsonPropertyName("at")] DateTime At,
    [property: JsonPropertyName("fromVersion")] int FromVersion,
    [property: JsonPropertyName("toVersion")] int ToVersion,
    [property: JsonPropertyName("failures")] long Failures,
    [property: JsonPropertyName("reason")] string Reason,
    [property: JsonPropertyName("acknowledged")] bool Acknowledged = false);

/// <summary>One history entry (immutable): publish, rollback, auto-fallback. Text null = the code default.</summary>
public class AiPromptVersionEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(Key);
    [JsonPropertyName("sk")] public string Sk => GetSk(Number);

    [JsonPropertyName("key")] public string Key { get; set; } = null!;
    [JsonPropertyName("number")] public int Number { get; set; }
    [JsonPropertyName("text")] public string? Text { get; set; }
    /// <summary>publish | rollback | auto_fallback</summary>
    [JsonPropertyName("action")] public string Action { get; set; } = "publish";
    /// <summary>Rollback / auto-fallback: the version whose text was restored (0 = code default).</summary>
    [JsonPropertyName("sourceVersion")] public int? SourceVersion { get; set; }
    [JsonPropertyName("author")] public string? Author { get; set; }
    [JsonPropertyName("at")] public DateTime At { get; set; }
    [JsonPropertyName("note")] public string? Note { get; set; }

    public static string GetPk(string key) => $"ai#prompt#{key}";
    public static string GetSk(int number) => $"v#{number:D6}";
}

/// <summary>The working copy of one key (one draft per key, shared by the admins).</summary>
public class AiPromptDraftEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk();
    [JsonPropertyName("sk")] public string Sk => GetSk(Key);

    [JsonPropertyName("key")] public string Key { get; set; } = null!;
    [JsonPropertyName("text")] public string Text { get; set; } = null!;
    /// <summary>The published version the draft was started from (publish warns when another publish happened since).</summary>
    [JsonPropertyName("baseVersion")] public int BaseVersion { get; set; }
    [JsonPropertyName("updatedBy")] public string? UpdatedBy { get; set; }
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }

    public static string GetPk() => "ai#promptdraft";
    public static string GetSk(string key) => key;
}

public enum AiTrialType { Prompt, Model, Models }

public enum AiTrialStatus { Queued, Running, Succeeded, Failed }

/// <summary>
/// One admin "Dene" / "Test" / model list refresh, run by the Stylist worker (it holds the provider key; the Api never
/// does). Kept 7 days. Output is cut to <see cref="MaxOutputLength"/> characters.
/// </summary>
public class AiTrialEntity : IEntity
{
    public const int MaxOutputLength = 20000;

    [JsonPropertyName("pk")] public string Pk => GetPk();
    [JsonPropertyName("sk")] public string Sk => GetSk(Id);

    [JsonPropertyName("id")] public string Id { get; set; } = null!;
    [JsonPropertyName("type")] public AiTrialType Type { get; set; }
    [JsonPropertyName("status")] public AiTrialStatus Status { get; set; }
    [JsonPropertyName("createdBy")] public string? CreatedBy { get; set; }
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }
    [JsonPropertyName("finishedAt")] public DateTime? FinishedAt { get; set; }

    // Prompt dry-run
    [JsonPropertyName("key")] public string? Key { get; set; }
    /// <summary>The template tried (the draft), used for this one call only.</summary>
    [JsonPropertyName("text")] public string? Text { get; set; }
    [JsonPropertyName("input")] public string? Input { get; set; }
    [JsonPropertyName("imageUrls")] public List<string> ImageUrls { get; set; } = [];

    // Model test
    [JsonPropertyName("model")] public string? Model { get; set; }
    [JsonPropertyName("modelKind")] public string? ModelKind { get; set; }
    [JsonPropertyName("effort")] public string? Effort { get; set; }
    [JsonPropertyName("serviceTier")] public string? ServiceTier { get; set; }

    // Result
    [JsonPropertyName("output")] public string? Output { get; set; }
    [JsonPropertyName("parsed")] public bool? Parsed { get; set; }
    [JsonPropertyName("parseError")] public string? ParseError { get; set; }
    [JsonPropertyName("error")] public string? Error { get; set; }
    [JsonPropertyName("latencyMs")] public long? LatencyMs { get; set; }
    [JsonPropertyName("usedModel")] public string? UsedModel { get; set; }
    [JsonPropertyName("inputTokens")] public long? InputTokens { get; set; }
    [JsonPropertyName("cachedTokens")] public long? CachedTokens { get; set; }
    [JsonPropertyName("outputTokens")] public long? OutputTokens { get; set; }
    [JsonPropertyName("systemPrompt")] public string? SystemPrompt { get; set; }
    [JsonPropertyName("userPrompt")] public string? UserPrompt { get; set; }

    [JsonPropertyName("ttl")] public long Ttl => CreatedAt.AddDays(7).ToUnixTimeSeconds();

    public static string GetPk() => "ai#trial";
    public static string GetSk(string id) => id;
}

/// <summary>The model ids the provider key can use (GET /v1/models), refreshed by a "models" trial. The model allow-list.</summary>
public class AiModelListEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk();
    [JsonPropertyName("sk")] public string Sk => GetSk();

    [JsonPropertyName("ids")] public List<string> Ids { get; set; } = [];
    [JsonPropertyName("fetchedAt")] public DateTime FetchedAt { get; set; }

    public static string GetPk() => "ai#models";
    public static string GetSk() => "openai";
}
