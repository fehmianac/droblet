using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Domain.Services.Styling;

namespace Domain.Services.Admin;

/// <summary>
/// Model = an AI model id (checked against the provider's model list by the AI settings); Choice = one of Options;
/// OperationList = comma-separated subset of Options.
/// </summary>
public enum SettingFieldType { Int, Bool, Time, WeekdayTime, TimeZone, Model, Choice, OperationList }

/// <param name="Nullable">null is accepted and removes the key (the code default applies again).</param>
public sealed record SettingField(string Key, SettingFieldType Type, int? Min = null, int? Max = null, IReadOnlyList<string>? Options = null, bool Nullable = false);

/// <summary>One SSM String parameter: /droblet/{stage}/{Scope}/{Section}, value = JSON.</summary>
public sealed record SettingParameter(string Scope, string Section)
{
    public string Name(string stage) => $"/droblet/{stage}/{Scope}/{Section}";
}

/// <summary>
/// A group of fields edited together; every parameter of the group receives the same field values.
/// Permission: the admin permission that reads and writes the group (settings.manage groups are the "Ayarlar" page;
/// the AI model group is edited on "AI → Modeller" with ai.manage).
/// </summary>
public sealed record SettingGroup(string Name, IReadOnlyList<SettingParameter> Parameters, IReadOnlyList<SettingField> Fields,
    string Permission = AdminPermissions.SettingsManage);

public sealed record SettingFieldValue(string Key, string Type, int? Min, int? Max, JsonNode? Value, IReadOnlyList<string>? Options = null, bool Nullable = false);

public sealed record SettingGroupDto(string Group, IReadOnlyList<string> Parameters, IReadOnlyList<SettingFieldValue> Fields);

/// <summary>
/// The owner-editable, non-secret Parameter Store values (README §13 decision 4 "uygulama ayarları"). Only these
/// parameters are writable from the panel — template.yaml grants ssm:PutParameter on exactly these ARNs. Secrets
/// (SecureString) are never part of a group. Writing replaces only the listed keys inside the JSON value; every other
/// key of the parameter is kept as is.
/// </summary>
public static partial class SettingsCatalog
{
    public const string AiModelsGroup = "aiModels";

    /// <summary>The chat operations (schema names) a per-operation AI setting can name (Ai:ReasoningEffort:{op}, Ai:FastTextOperations).</summary>
    public static readonly IReadOnlyList<string> AiTextOperations =
    [
        AiSchemas.Outfit, AiSchemas.WeekPlan, AiSchemas.Packing, AiSchemas.GarmentDraft, AiSchemas.ItemDetection, AiSchemas.ItemMatch,
        AiSchemas.PaletteSeason, AiSchemas.PhotoCheck,
    ];

    public static readonly IReadOnlyList<string> ReasoningEfforts = ["none", "minimal", "low", "medium", "high", "xhigh"];
    public static readonly IReadOnlyList<string> ServiceTiers = ["auto", "default", "flex", "priority"];
    public static readonly IReadOnlyList<string> ImageQualities = ["low", "medium", "high", "auto"];
    public static readonly IReadOnlyList<string> ImageSizes = ["1024x1024", "1024x1536", "1536x1024", "auto"];

    /// <summary>One field per text operation: {prefix}.{operation} (e.g. ReasoningEffort.outfit).</summary>
    public static IEnumerable<SettingField> PerOperation(string prefix, Func<string, SettingField> field) =>
        AiTextOperations.Select(operation => field($"{prefix}.{operation}"));

    /// <summary>
    /// AI routing in /droblet/{stage}/worker/Ai (the JSON the workers bind to AiOptions; the key is a separate
    /// SecureString and never part of it). Workers re-read it every 60 s (SSM reload), so a change needs no deploy.
    /// </summary>
    public static readonly SettingGroup AiModels = new(AiModelsGroup,
        [new("worker", "Ai")],
        [
            new("TextModel", SettingFieldType.Model),
            new("FastTextModel", SettingFieldType.Model, Nullable: true),
            new("FastTextOperations", SettingFieldType.OperationList, Options: AiTextOperations),
            new("ImageModel", SettingFieldType.Model),
            new("ReasoningEffort.Default", SettingFieldType.Choice, Options: ReasoningEfforts, Nullable: true),
            .. PerOperation("ReasoningEffort", key => new SettingField(key, SettingFieldType.Choice, Options: ReasoningEfforts, Nullable: true)),
            new("ServiceTier", SettingFieldType.Choice, Options: ServiceTiers, Nullable: true),
            new("PromptCacheKey", SettingFieldType.Bool),
            new("TimeoutSeconds", SettingFieldType.Int, 10, 110),
            new("ImageSize", SettingFieldType.Choice, Options: ImageSizes),
            new("Image.Quality", SettingFieldType.Choice, Options: ImageQualities, Nullable: true),
            new("Image.Size", SettingFieldType.Choice, Options: ImageSizes, Nullable: true),
            new("Image.TryOnQuality", SettingFieldType.Choice, Options: ImageQualities, Nullable: true),
            new("Image.TryOnSize", SettingFieldType.Choice, Options: ImageSizes, Nullable: true),
            new("Image.TryOnInputFidelity", SettingFieldType.Choice, Options: ["high", "low"], Nullable: true),
            new("Image.TryOnPreview", SettingFieldType.Bool),
            new("Image.PreviewQuality", SettingFieldType.Choice, Options: ImageQualities, Nullable: true),
            new("Image.CleanupQuality", SettingFieldType.Choice, Options: ImageQualities, Nullable: true),
            new("Image.CleanupSize", SettingFieldType.Choice, Options: ImageSizes, Nullable: true),
            new("Prompts.Enabled", SettingFieldType.Bool),
            new("Prompts.CacheSeconds", SettingFieldType.Int, 10, 600),
            new("Prompts.FailureThreshold", SettingFieldType.Int, 0, 100),
            new("Prompts.FailureWindowMinutes", SettingFieldType.Int, 1, 120),
        ],
        AdminPermissions.AiManage);

    public static readonly IReadOnlyList<SettingGroup> Groups =
    [
        new("entitlements",
            [new("api", "Entitlements"), new("worker", "Entitlements")],
            [new("Premium.TryOnCreditsPerMonth", SettingFieldType.Int, 0, 1000), new("Free.ItemRecognitionLimit", SettingFieldType.Int, 0, 1000),
             // Photos per "Kombinlerini içe aktar" session, per plan (owner decision 2026-11-19, default 30 for both).
             new("Free.OutfitImportMaxPhotos", SettingFieldType.Int, 1, 100), new("Premium.OutfitImportMaxPhotos", SettingFieldType.Int, 1, 100),
             // Temporary self-serve premium in Ayarlar until store purchases are live (owner decision 2026-11-19).
             new("SelfServePremium.Enabled", SettingFieldType.Bool)]),
        new("packing",
            [new("api", "Packing"), new("worker", "Packing")],
            [new("CabinMaxItems", SettingFieldType.Int, 0, 100), new("MaxTripDays", SettingFieldType.Int, 1, 60)]),
        new("ai",
            [new("worker", "Ai")],
            [new("Enabled", SettingFieldType.Bool)]),
        new("notifications",
            [new("api", "Notifications")],
            [new("DefaultMorningLocal", SettingFieldType.Time), new("DefaultTimeZone", SettingFieldType.TimeZone), new("MaxDevicesPerTenant", SettingFieldType.Int, 1, 50)]),
        new("notifierSchedule",
            [new("notifier", "Notifications")],
            [new("DefaultMorningLocal", SettingFieldType.Time), new("DefaultWeeklyEditLocal", SettingFieldType.WeekdayTime), new("DefaultFriendRatingsLocal", SettingFieldType.Time)]),
        new("authRateLimits",
            [new("api", "AuthRateLimits")],
            [
                new("LoginPerEmailPer15Minutes", SettingFieldType.Int, 1, 1000), new("LoginPerIpPer15Minutes", SettingFieldType.Int, 1, 10000),
                new("RegisterPerIpPerHour", SettingFieldType.Int, 1, 10000), new("ForgotPerEmailPerHour", SettingFieldType.Int, 1, 100),
            ]),
        AiModels,
    ];

    public static SettingGroup? Find(string name) => Groups.FirstOrDefault(g => string.Equals(g.Name, name, StringComparison.Ordinal));

    /// <summary>Every writable parameter (for the IAM policy test).</summary>
    public static IEnumerable<SettingParameter> WritableParameters => Groups.SelectMany(g => g.Parameters).Distinct();

    [GeneratedRegex("^([01][0-9]|2[0-3]):[0-5][0-9]$")]
    private static partial Regex TimePattern();

    [GeneratedRegex("^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) ([01][0-9]|2[0-3]):[0-5][0-9]$")]
    private static partial Regex WeekdayTimePattern();

    /// <summary>Shape of a model id (gpt-6.1-sol, gpt-image-2, ft:gpt-…:org::id); availability is checked against the provider list.</summary>
    [GeneratedRegex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$")]
    public static partial Regex ModelIdPattern();

    public static string TypeName(SettingFieldType type) => type switch
    {
        SettingFieldType.Int => "int",
        SettingFieldType.Bool => "bool",
        SettingFieldType.Time => "time",
        SettingFieldType.WeekdayTime => "weekdayTime",
        SettingFieldType.Model => "model",
        SettingFieldType.Choice => "choice",
        SettingFieldType.OperationList => "operationList",
        _ => "timeZone",
    };

    /// <summary>Field values as stored in the group's first parameter (null when the key is missing).</summary>
    public static SettingGroupDto Read(SettingGroup group, string stage, string? firstParameterJson)
    {
        var root = Parse(firstParameterJson);
        return new SettingGroupDto(group.Name, group.Parameters.Select(p => p.Name(stage)).ToList(),
            group.Fields.Select(f => new SettingFieldValue(f.Key, TypeName(f.Type), f.Min, f.Max, Get(root, f.Key)?.DeepClone(), f.Options, f.Nullable)).ToList());
    }

    /// <summary>Validates the submitted values. Errors are keyed by field: unknown_field, invalid, out_of_range.</summary>
    public static Dictionary<string, string[]> Validate(SettingGroup group, IReadOnlyDictionary<string, JsonElement> values)
    {
        var errors = new Dictionary<string, string[]>(StringComparer.Ordinal);
        if (values.Count == 0)
            errors["values"] = ["required"];
        foreach (var (key, value) in values)
        {
            var field = group.Fields.FirstOrDefault(f => f.Key == key);
            if (field is null)
            {
                errors[key] = ["unknown_field"];
                continue;
            }
            var error = ValidateValue(field, value);
            if (error is not null)
                errors[key] = [error];
        }
        return errors;
    }

    public static string? ValidateValue(SettingField field, JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Null)
            return field.Nullable ? null : "invalid";
        switch (field.Type)
        {
            case SettingFieldType.Model:
                return value.ValueKind == JsonValueKind.String && ModelIdPattern().IsMatch(value.GetString()!) ? null : "invalid";
            case SettingFieldType.Choice:
                return value.ValueKind == JsonValueKind.String && field.Options!.Contains(value.GetString()!, StringComparer.Ordinal) ? null : "invalid";
            case SettingFieldType.OperationList:
                if (value.ValueKind != JsonValueKind.String)
                    return "invalid";
                var parts = value.GetString()!.Split(',', StringSplitOptions.TrimEntries);
                return value.GetString()!.Length == 0 || parts.All(p => field.Options!.Contains(p, StringComparer.Ordinal)) ? null : "invalid";
            case SettingFieldType.Int:
                if (value.ValueKind != JsonValueKind.Number || !value.TryGetInt32(out var number))
                    return "invalid";
                return (field.Min is { } min && number < min) || (field.Max is { } max && number > max) ? "out_of_range" : null;
            case SettingFieldType.Bool:
                return value.ValueKind is JsonValueKind.True or JsonValueKind.False ? null : "invalid";
            case SettingFieldType.Time:
                return value.ValueKind == JsonValueKind.String && TimePattern().IsMatch(value.GetString()!) ? null : "invalid";
            case SettingFieldType.WeekdayTime:
                return value.ValueKind == JsonValueKind.String && WeekdayTimePattern().IsMatch(value.GetString()!) ? null : "invalid";
            default:
                if (value.ValueKind != JsonValueKind.String || value.GetString() is not { Length: > 0 and <= 64 } zone)
                    return "invalid";
                try
                {
                    TimeZoneInfo.FindSystemTimeZoneById(zone);
                    return zone.Contains('/', StringComparison.Ordinal) || zone == "UTC" ? null : "invalid";
                }
                catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException)
                {
                    return "invalid";
                }
        }
    }

    /// <summary>The parameter JSON with the (already validated) values applied; other keys are kept.</summary>
    /// <remarks>A null value (only accepted for nullable fields) removes the key, so the code default applies again.</remarks>
    public static string Apply(string? currentJson, IReadOnlyDictionary<string, JsonElement> values)
    {
        var root = Parse(currentJson);
        foreach (var (key, value) in values)
        {
            if (value.ValueKind == JsonValueKind.Null)
                Remove(root, key);
            else
                Set(root, key, JsonNode.Parse(value.GetRawText()));
        }
        return root.ToJsonString();
    }

    private static void Remove(JsonObject root, string path)
    {
        var parts = path.Split('.');
        JsonNode? node = root;
        foreach (var part in parts[..^1])
        {
            if (node is not JsonObject obj || !obj.TryGetPropertyValue(part, out node))
                return;
        }
        (node as JsonObject)?.Remove(parts[^1]);
    }

    private static JsonObject Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
            return [];
        try
        {
            return JsonNode.Parse(json) as JsonObject ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private static JsonNode? Get(JsonObject root, string path)
    {
        JsonNode? node = root;
        foreach (var part in path.Split('.'))
        {
            if (node is not JsonObject obj || !obj.TryGetPropertyValue(part, out node))
                return null;
        }
        return node;
    }

    private static void Set(JsonObject root, string path, JsonNode? value)
    {
        var parts = path.Split('.');
        var node = root;
        foreach (var part in parts[..^1])
        {
            if (node[part] is not JsonObject child)
            {
                child = [];
                node[part] = child;
            }
            node = child;
        }
        node[parts[^1]] = value;
    }
}
