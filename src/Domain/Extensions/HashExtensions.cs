using System.Security.Cryptography;
using System.Text;

namespace Domain.Extensions;

public static class HashExtensions
{
    /// <summary>Lower-case hex SHA-256 of the UTF-8 string. Used for token lookup keys and log-safe identifiers.</summary>
    public static string Sha256Hex(this string value) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
}
