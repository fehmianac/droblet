using System.Security.Cryptography;

namespace Domain.Extensions;

/// <summary>Minimal ULID (26 chars, Crockford base32, time-sortable).</summary>
public static class Ulid
{
    private const string Alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

    public static string New(DateTime? utcNow = null)
    {
        var ms = (utcNow ?? DateTime.UtcNow).ToUnixTimeMilliseconds();
        Span<byte> random = stackalloc byte[10];
        RandomNumberGenerator.Fill(random);

        Span<char> chars = stackalloc char[26];
        for (var i = 9; i >= 0; i--)
        {
            chars[i] = Alphabet[(int)(ms % 32)];
            ms /= 32;
        }

        // 80 random bits -> 16 chars
        var bitBuffer = 0;
        var bitCount = 0;
        var index = 10;
        foreach (var b in random)
        {
            bitBuffer = (bitBuffer << 8) | b;
            bitCount += 8;
            while (bitCount >= 5)
            {
                bitCount -= 5;
                chars[index++] = Alphabet[(bitBuffer >> bitCount) & 31];
            }
        }

        return new string(chars);
    }

    public static bool IsValid(string? value) =>
        value is { Length: 26 } && value.All(c => Alphabet.Contains(char.ToUpperInvariant(c)));
}
