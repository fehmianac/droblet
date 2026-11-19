using System.Security.Cryptography;

namespace Domain.Extensions;

/// <summary>Minimal ULID (26 chars, Crockford base32, time-sortable).</summary>
public static class Ulid
{
    private const string Alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

    public static string New(DateTime? utcNow = null)
    {
        Span<byte> random = stackalloc byte[10];
        RandomNumberGenerator.Fill(random);
        return Build((utcNow ?? DateTime.UtcNow).ToUnixTimeMilliseconds(), random);
    }

    private static readonly object MonotonicGate = new();
    private static string _lastMonotonic = "";

    /// <summary>
    /// A ULID strictly greater than every earlier one from this process: two ids made in the same millisecond (or with a
    /// clock that stepped back) still sort in the order they were made. Used where the sort key alone orders a log
    /// (admin audit trail) and a random tie-break would show two quick writes in the wrong order.
    /// </summary>
    public static string NewMonotonic(DateTime? utcNow = null)
    {
        var candidate = New(utcNow);
        lock (MonotonicGate)
        {
            if (string.CompareOrdinal(candidate, _lastMonotonic) <= 0)
                candidate = Increment(_lastMonotonic);
            _lastMonotonic = candidate;
            return candidate;
        }
    }

    /// <summary>The next ULID after <paramref name="value"/> (base32 +1 with carry; the time part only moves on overflow).</summary>
    internal static string Increment(string value)
    {
        var chars = value.ToCharArray();
        for (var i = chars.Length - 1; i >= 0; i--)
        {
            var digit = Alphabet.IndexOf(chars[i]);
            if (digit < Alphabet.Length - 1)
            {
                chars[i] = Alphabet[digit + 1];
                return new string(chars);
            }
            chars[i] = Alphabet[0];
        }
        throw new OverflowException("ULID space exhausted.");
    }

    /// <summary>
    /// A ULID that is a pure function of (time, seed): the same server-side action always yields the same id, so a
    /// retried mutation is idempotent without the client supplying an id.
    /// </summary>
    public static string Deterministic(DateTime utc, string seed) =>
        Build(utc.ToUnixTimeMilliseconds(), SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(seed)).AsSpan(0, 10));

    private static string Build(long ms, ReadOnlySpan<byte> random)
    {

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
