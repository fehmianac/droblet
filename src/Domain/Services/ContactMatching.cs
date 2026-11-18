using System.Security.Cryptography;
using System.Text;

namespace Domain.Services;

/// <summary>
/// Decision 13 (2026-11-19): "Rehberden arkadaş bul" in phase 1. Raw contacts never leave the device:
/// <list type="number">
/// <item>The app asks for a single-use, 10-minute salt (<c>POST v1/tenant/contacts/salt</c>).</item>
/// <item>For each e-mail address: <c>h0 = SHA-256(normalised address)</c> (hex), <c>p = h0[..PrefixLength]</c>,
/// <c>h = SHA-256(salt + ":email:" + h0)</c> (hex). Only (p, h) pairs are sent.</item>
/// <item>The server reads the directory bucket of each prefix (h0 of the members' verified e-mails), salts those with
/// the same salt and compares. The prefix narrows the comparison to 1/4096 of the members and reveals 12 bits of h0 —
/// never enough to identify an address. Because the salt is random, single-use and per request, an uploaded hash is
/// worthless outside that request and two uploads cannot be linked.</item>
/// </list>
/// Nothing of the upload is stored or logged. Phone numbers are not matched: no member has one on file.
/// </summary>
public static class ContactHashRules
{
    public const int PrefixLength = 3;
    public const string EmailKind = "email";
    public const int SaltBytes = 32;
    public static readonly TimeSpan SaltLifetime = TimeSpan.FromMinutes(10);

    public static string NormalizeEmail(string email) => email.Trim().ToLowerInvariant();

    public static string Sha256Hex(string value) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    /// <summary>Unsalted hash of a normalised identifier — what the directory keeps for members.</summary>
    public static string BaseHash(string normalizedIdentifier) => Sha256Hex(normalizedIdentifier);

    public static string Prefix(string baseHash) => baseHash[..PrefixLength];

    public static string Salted(string salt, string kind, string baseHash) => Sha256Hex($"{salt}:{kind}:{baseHash}");

    public static string NewSalt() => Base64Url(RandomNumberGenerator.GetBytes(SaltBytes));

    public static bool IsValidPrefix(string? value) => value is { Length: PrefixLength } && value.All(IsLowerHex);

    public static bool IsValidHash(string? value) => value is { Length: 64 } && value.All(IsLowerHex);

    private static bool IsLowerHex(char c) => c is >= '0' and <= '9' or >= 'a' and <= 'f';

    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}

public sealed record ContactHashInput(string P, string H);

public sealed record ContactSaltDto(string SaltId, string Salt, int PrefixLength, int MaxHashes, DateTime ExpiresAt);

public sealed record ContactMatchesDto(IReadOnlyList<PersonCardDto> Matches);

public enum ContactMatchOutcome { Ok, SaltNotFound, RateLimited }

public interface IContactMatchService
{
    Task<ContactSaltDto> IssueSaltAsync(string tenantId, CancellationToken ct);

    /// <summary>Consumes the salt. Matches are profile cards the caller may see (visibility, blocks); never the caller.</summary>
    Task<(ContactMatchOutcome Outcome, ContactMatchesDto? Result)> MatchAsync(string tenantId, string saltId, IReadOnlyList<ContactHashInput> hashes, CancellationToken ct);
}

/// <summary>The members' side: verified e-mail addresses in the hashed directory (Apple / Google verified, or proven by a password reset).</summary>
public interface IContactDirectory
{
    Task ListVerifiedEmailAsync(string tenantId, string email, CancellationToken ct);
}
