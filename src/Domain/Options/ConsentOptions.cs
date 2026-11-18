using Domain.Enum;

namespace Domain.Options;

/// <summary>
/// Current text version per consent type (section `Consents:Versions`, keyed by the camelCase type name). Publishing a
/// new text = bumping its version here: every stored consent on an older version stops being valid and the app
/// asks again just in time. The default is the date of the current drafts (landing `/consents`).
/// </summary>
public sealed class ConsentOptions
{
    public const string Section = "Consents";
    public const string DefaultVersion = "2026-11-19";

    public Dictionary<string, string> Versions { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    public string CurrentVersion(ConsentType type) =>
        Versions.TryGetValue(Name(type), out var version) && !string.IsNullOrWhiteSpace(version) ? version.Trim() : DefaultVersion;

    /// <summary>camelCase wire name (bodyPhotoAi …), the same as the JSON enum value.</summary>
    public static string Name(ConsentType type)
    {
        var name = type.ToString();
        return char.ToLowerInvariant(name[0]) + name[1..];
    }
}
