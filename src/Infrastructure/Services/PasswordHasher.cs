using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Domain.Services;

namespace Infrastructure.Services;

/// <summary>PBKDF2-SHA256, 16-byte salt, 32-byte key, ≥ 600 000 iterations (README §9.3). Format: pbkdf2-sha256$iter$salt$hash.</summary>
public sealed class PasswordHasher : IPasswordHasher
{
    public const int DefaultIterations = 600_000;
    private const string Prefix = "pbkdf2-sha256";
    private const int SaltSize = 16;
    private const int KeySize = 32;

    private readonly int _iterations;

    public PasswordHasher() : this(DefaultIterations) { }

    /// <summary>Lower iteration counts are for tests only.</summary>
    public PasswordHasher(int iterations)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(iterations, 1);
        _iterations = iterations;
    }

    public string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltSize);
        var key = Derive(password, salt, _iterations);
        return string.Join('$', Prefix, _iterations.ToString(CultureInfo.InvariantCulture), Convert.ToBase64String(salt), Convert.ToBase64String(key));
    }

    public PasswordVerification Verify(string password, string encodedHash)
    {
        var parts = encodedHash.Split('$');
        if (parts.Length != 4 || parts[0] != Prefix
            || !int.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out var iterations) || iterations < 1)
            return PasswordVerification.Failed;

        byte[] salt, expected;
        try
        {
            salt = Convert.FromBase64String(parts[2]);
            expected = Convert.FromBase64String(parts[3]);
        }
        catch (FormatException)
        {
            return PasswordVerification.Failed;
        }

        var actual = Derive(password, salt, iterations, expected.Length);
        if (!CryptographicOperations.FixedTimeEquals(actual, expected))
            return PasswordVerification.Failed;

        return iterations < _iterations ? PasswordVerification.SuccessRehashNeeded : PasswordVerification.Success;
    }

    private static byte[] Derive(string password, byte[] salt, int iterations, int length = KeySize) =>
        Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(password), salt, iterations, HashAlgorithmName.SHA256, length);
}
