namespace Domain.Options;

/// <summary>
/// deploy-infra creates every secret SSM parameter once with the literal value CHANGE_ME (and never overwrites it);
/// the owner replaces it in Parameter Store. Until then the secret is "not configured" — exactly like an empty value —
/// so a provider is switched off instead of sending the placeholder as a credential, and a shared secret can never
/// be "CHANGE_ME".
/// </summary>
public static class ConfigSecret
{
    public const string Placeholder = "CHANGE_ME";

    public static bool IsSet(string? value) =>
        !string.IsNullOrWhiteSpace(value) && !string.Equals(value.Trim(), Placeholder, StringComparison.Ordinal);

    /// <summary>The value, or null when it is empty or still the placeholder.</summary>
    public static string? OrNull(string? value) => IsSet(value) ? value : null;
}
