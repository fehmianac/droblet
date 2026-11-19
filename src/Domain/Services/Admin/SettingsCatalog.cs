using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Domain.Services.Admin;

public enum SettingFieldType { Int, Bool, Time, WeekdayTime, TimeZone }

public sealed record SettingField(string Key, SettingFieldType Type, int? Min = null, int? Max = null);

/// <summary>One SSM String parameter: /droblet/{stage}/{Scope}/{Section}, value = JSON.</summary>
public sealed record SettingParameter(string Scope, string Section)
{
    public string Name(string stage) => $"/droblet/{stage}/{Scope}/{Section}";
}

/// <summary>A group of fields edited together; every parameter of the group receives the same field values.</summary>
public sealed record SettingGroup(string Name, IReadOnlyList<SettingParameter> Parameters, IReadOnlyList<SettingField> Fields);

public sealed record SettingFieldValue(string Key, string Type, int? Min, int? Max, JsonNode? Value);

public sealed record SettingGroupDto(string Group, IReadOnlyList<string> Parameters, IReadOnlyList<SettingFieldValue> Fields);

/// <summary>
/// The owner-editable, non-secret Parameter Store values (README §13 decision 4 "uygulama ayarları"). Only these
/// parameters are writable from the panel — template.yaml grants ssm:PutParameter on exactly these ARNs. Secrets
/// (SecureString) are never part of a group. Writing replaces only the listed keys inside the JSON value; every other
/// key of the parameter is kept as is.
/// </summary>
public static partial class SettingsCatalog
{
    public static readonly IReadOnlyList<SettingGroup> Groups =
    [
        new("entitlements",
            [new("api", "Entitlements"), new("worker", "Entitlements")],
            [new("Premium.TryOnCreditsPerMonth", SettingFieldType.Int, 0, 1000), new("Free.ItemRecognitionLimit", SettingFieldType.Int, 0, 1000),
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
    ];

    public static SettingGroup? Find(string name) => Groups.FirstOrDefault(g => string.Equals(g.Name, name, StringComparison.Ordinal));

    /// <summary>Every writable parameter (for the IAM policy test).</summary>
    public static IEnumerable<SettingParameter> WritableParameters => Groups.SelectMany(g => g.Parameters).Distinct();

    [GeneratedRegex("^([01][0-9]|2[0-3]):[0-5][0-9]$")]
    private static partial Regex TimePattern();

    [GeneratedRegex("^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) ([01][0-9]|2[0-3]):[0-5][0-9]$")]
    private static partial Regex WeekdayTimePattern();

    public static string TypeName(SettingFieldType type) => type switch
    {
        SettingFieldType.Int => "int",
        SettingFieldType.Bool => "bool",
        SettingFieldType.Time => "time",
        SettingFieldType.WeekdayTime => "weekdayTime",
        _ => "timeZone",
    };

    /// <summary>Field values as stored in the group's first parameter (null when the key is missing).</summary>
    public static SettingGroupDto Read(SettingGroup group, string stage, string? firstParameterJson)
    {
        var root = Parse(firstParameterJson);
        return new SettingGroupDto(group.Name, group.Parameters.Select(p => p.Name(stage)).ToList(),
            group.Fields.Select(f => new SettingFieldValue(f.Key, TypeName(f.Type), f.Min, f.Max, Get(root, f.Key)?.DeepClone())).ToList());
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
        switch (field.Type)
        {
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
    public static string Apply(string? currentJson, IReadOnlyDictionary<string, JsonElement> values)
    {
        var root = Parse(currentJson);
        foreach (var (key, value) in values)
            Set(root, key, JsonNode.Parse(value.GetRawText()));
        return root.ToJsonString();
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
