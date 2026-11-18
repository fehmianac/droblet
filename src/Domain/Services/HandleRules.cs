using System.Text.RegularExpressions;

namespace Domain.Services;

public static partial class HandleRules
{
    public const int MinLength = 3;
    public const int MaxLength = 30;

    private static readonly HashSet<string> Reserved =
    [
        "admin", "administrator", "droblet", "droplet", "support", "help", "root", "system",
        "api", "www", "official", "staff", "moderator", "security", "privacy", "editor", "edit",
        "suggested", // v1/tenant/people/suggested
    ];

    [GeneratedRegex("^[a-z0-9](?:[a-z0-9._]*[a-z0-9])?$")]
    private static partial Regex Pattern();

    public static string Normalize(string handle) => handle.Trim().TrimStart('@').ToLowerInvariant();

    public static bool IsValidFormat(string normalized) =>
        normalized.Length is >= MinLength and <= MaxLength
        && Pattern().IsMatch(normalized)
        && !normalized.Contains("..", StringComparison.Ordinal);

    public static bool IsReserved(string normalized) => Reserved.Contains(normalized);
}
