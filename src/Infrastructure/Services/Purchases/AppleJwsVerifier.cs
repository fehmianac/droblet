using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using Domain.Options;
using Domain.Services;
using Microsoft.Extensions.Options;

namespace Infrastructure.Services.Purchases;

/// <summary>A trust anchor for StoreKit signed data. Apple anchors also require Apple's marker OIDs on the chain.</summary>
public sealed record AppleTrustAnchor(X509Certificate2 Root, bool RequireAppleOids, string? OnlyEnvironment = null);

/// <summary>Roots a StoreKit JWS may chain to. Production: Apple Root CA - G3 (embedded). Tests inject their own chain.</summary>
public interface IAppleRootCertificates
{
    IReadOnlyList<AppleTrustAnchor> Anchors { get; }
}

/// <summary>
/// Apple Root CA - G3 (https://www.apple.com/certificateauthority/AppleRootCA-G3.cer), embedded so verification never
/// downloads anything; SHA-256 fingerprint pinned below. Plus, when configured, the local "StoreKit Testing in Xcode"
/// root — accepted only for transactions whose environment is "Xcode" (simulator testing with Droblet.storekit).
/// </summary>
public sealed class AppleRootCertificates(IOptionsMonitor<StoreOptions> options) : IAppleRootCertificates
{
    public const string AppleRootCaG3Sha256 = "63343ABFB89A6A03EBB57E9B3F5FA7BE7C4F5C756F3017B3A8C488C3653E9179";

    private const string AppleRootCaG3 =
        "MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwSQXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcNMTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBSb290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9yaXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtfTjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySrMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gAMGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM6BgD56KyKA==";

    private static readonly Lazy<X509Certificate2> AppleRoot = new(() =>
    {
        var certificate = X509CertificateLoader.LoadCertificate(Convert.FromBase64String(AppleRootCaG3));
        if (!string.Equals(certificate.GetCertHashString(HashAlgorithmName.SHA256), AppleRootCaG3Sha256, StringComparison.OrdinalIgnoreCase))
            throw new CryptographicException("Embedded Apple Root CA - G3 does not match its pinned fingerprint.");
        return certificate;
    });

    private string? _xcodeSource;
    private X509Certificate2? _xcodeRoot;

    public static X509Certificate2 AppleRootCaG3Certificate => AppleRoot.Value;

    public IReadOnlyList<AppleTrustAnchor> Anchors
    {
        get
        {
            var anchors = new List<AppleTrustAnchor> { new(AppleRoot.Value, RequireAppleOids: true) };
            var xcode = ConfigSecret.OrNull(options.CurrentValue.XcodeTestRootCertificate);
            if (xcode is not null)
            {
                if (!string.Equals(xcode, _xcodeSource, StringComparison.Ordinal))
                {
                    try
                    {
                        _xcodeRoot = X509CertificateLoader.LoadCertificate(Convert.FromBase64String(xcode.Trim()));
                    }
                    catch (Exception ex) when (ex is FormatException or CryptographicException)
                    {
                        _xcodeRoot = null;
                    }
                    _xcodeSource = xcode;
                }
                if (_xcodeRoot is not null)
                    anchors.Add(new AppleTrustAnchor(_xcodeRoot, RequireAppleOids: false, OnlyEnvironment: StoreRules.XcodeEnvironment));
            }
            return anchors;
        }
    }
}

public sealed record VerifiedJws(JsonElement Payload, string? Environment);

/// <summary>
/// Verifies StoreKit 2 / App Store Server Notification JWS locally (Apple's documented procedure, as in
/// app-store-server-library's SignedDataVerifier, without the online OCSP check):
///   1. header alg = ES256 with an x5c chain [leaf, intermediate, root];
///   2. the chain builds to a trusted root (byte-equal anchor), evaluated at the payload's signedDate;
///   3. Apple chains carry the marker OIDs: leaf 1.2.840.113635.100.6.11.1, intermediate 1.2.840.113635.100.6.2.1;
///   4. the ES256 signature verifies with the leaf key.
/// Returns null when any step fails. The caller checks bundle id, product id and environment.
/// </summary>
public sealed class AppleJwsVerifier(IAppleRootCertificates roots, TimeProvider timeProvider)
{
    public const string LeafOid = "1.2.840.113635.100.6.11.1";
    public const string IntermediateOid = "1.2.840.113635.100.6.2.1";

    public VerifiedJws? Verify(string? jws)
    {
        if (string.IsNullOrWhiteSpace(jws))
            return null;
        var parts = jws.Trim().Split('.');
        if (parts.Length != 3)
            return null;

        try
        {
            using var header = JsonDocument.Parse(Base64Url(parts[0]));
            if (StoreRules.Str(header.RootElement, "alg") != "ES256"
                || !header.RootElement.TryGetProperty("x5c", out var x5c) || x5c.ValueKind != JsonValueKind.Array || x5c.GetArrayLength() < 1)
                return null;

            var payloadDocument = JsonDocument.Parse(Base64Url(parts[1]));
            var payload = payloadDocument.RootElement.Clone();
            payloadDocument.Dispose();

            var chain = x5c.EnumerateArray()
                .Select(c => X509CertificateLoader.LoadCertificate(Convert.FromBase64String(c.GetString() ?? "")))
                .ToList();
            try
            {
                var environment = StoreRules.Str(payload, "environment")
                                  ?? (payload.TryGetProperty("data", out var data) ? StoreRules.Str(data, "environment") : null);
                var effectiveDate = StoreRules.Ms(payload, "signedDate") ?? timeProvider.GetUtcNow().UtcDateTime;
                if (!ChainIsTrusted(chain, environment, effectiveDate))
                    return null;

                using var key = chain[0].GetECDsaPublicKey();
                if (key is null)
                    return null;
                var signature = Base64Url(parts[2]);
                // JWS ES256 = raw r||s (IEEE P1363), which is .NET's default signature format for ECDsa.
                if (signature.Length != 64 || !key.VerifyData(Encoding.ASCII.GetBytes($"{parts[0]}.{parts[1]}"), signature, HashAlgorithmName.SHA256))
                    return null;

                return new VerifiedJws(payload, environment);
            }
            finally
            {
                foreach (var certificate in chain)
                    certificate.Dispose();
            }
        }
        catch (Exception ex) when (ex is FormatException or JsonException or CryptographicException or ArgumentException or InvalidOperationException)
        {
            return null;
        }
    }

    private bool ChainIsTrusted(IReadOnlyList<X509Certificate2> chain, string? environment, DateTime effectiveDate)
    {
        foreach (var anchor in roots.Anchors)
        {
            if (anchor.OnlyEnvironment is not null && !string.Equals(anchor.OnlyEnvironment, environment, StringComparison.Ordinal))
                continue;
            if (anchor.RequireAppleOids && (chain.Count != 3 || !HasExtension(chain[0], LeafOid) || !HasExtension(chain[1], IntermediateOid)))
                continue;
            if (Builds(chain, anchor.Root, effectiveDate))
                return true;
        }
        return false;
    }

    private static bool Builds(IReadOnlyList<X509Certificate2> chain, X509Certificate2 root, DateTime effectiveDate)
    {
        using var builder = new X509Chain();
        builder.ChainPolicy.TrustMode = X509ChainTrustMode.CustomRootTrust;
        builder.ChainPolicy.CustomTrustStore.Add(root);
        builder.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck;
        builder.ChainPolicy.VerificationTime = DateTime.SpecifyKind(effectiveDate, DateTimeKind.Utc);
        builder.ChainPolicy.VerificationTimeIgnored = false;
        builder.ChainPolicy.DisableCertificateDownloads = true;
        foreach (var intermediate in chain.Skip(1))
            builder.ChainPolicy.ExtraStore.Add(intermediate);

        if (!builder.Build(chain[0]))
            return false;
        // The chain must end at the anchor itself (not at some other certificate that happens to be in the system store).
        var built = builder.ChainElements[^1].Certificate;
        return built.RawData.AsSpan().SequenceEqual(root.RawData);
    }

    private static bool HasExtension(X509Certificate2 certificate, string oid) =>
        certificate.Extensions.Any(e => e.Oid?.Value == oid);

    public static byte[] Base64Url(string value)
    {
        var s = value.Replace('-', '+').Replace('_', '/');
        s = (s.Length % 4) switch { 2 => s + "==", 3 => s + "=", 0 => s, _ => throw new FormatException("Invalid base64url length.") };
        return Convert.FromBase64String(s);
    }
}
