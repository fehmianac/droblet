using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using Infrastructure.Services.Purchases;

namespace InfrastructureTests;

/// <summary>
/// A self-generated StoreKit-shaped certificate chain (root → intermediate → leaf, P-256, Apple marker OIDs) injected
/// through IAppleRootCertificates — the fixed test vector for JWS verification. Nothing talks to Apple.
/// </summary>
internal sealed class StoreKitTestChain : IAppleRootCertificates, IDisposable
{
    public X509Certificate2 Root { get; }
    public X509Certificate2 Intermediate { get; }
    public X509Certificate2 Leaf { get; }
    private readonly ECDsa _leafKey;

    public static readonly DateTimeOffset ValidFrom = new(2025, 1, 1, 0, 0, 0, TimeSpan.Zero);
    public static readonly DateTimeOffset ValidTo = new(2030, 1, 1, 0, 0, 0, TimeSpan.Zero);

    public StoreKitTestChain(bool leafOid = true, bool intermediateOid = true, DateTimeOffset? leafNotAfter = null)
    {
        using var rootKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var rootRequest = new CertificateRequest("CN=Droblet Test Root CA", rootKey, HashAlgorithmName.SHA256);
        rootRequest.CertificateExtensions.Add(new X509BasicConstraintsExtension(true, false, 0, true));
        rootRequest.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.KeyCertSign | X509KeyUsageFlags.CrlSign, true));
        Root = rootRequest.CreateSelfSigned(ValidFrom, ValidTo);

        using var intermediateKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var intermediateRequest = new CertificateRequest("CN=Droblet Test WWDR", intermediateKey, HashAlgorithmName.SHA256);
        intermediateRequest.CertificateExtensions.Add(new X509BasicConstraintsExtension(true, false, 0, true));
        intermediateRequest.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.KeyCertSign | X509KeyUsageFlags.CrlSign, true));
        if (intermediateOid)
            intermediateRequest.CertificateExtensions.Add(new X509Extension(new Oid(AppleJwsVerifier.IntermediateOid), [0x05, 0x00], false));
        using var intermediatePublic = intermediateRequest.Create(Root, ValidFrom, ValidTo, [1, 2, 3, 4]);
        Intermediate = intermediatePublic.CopyWithPrivateKey(intermediateKey);

        _leafKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var leafRequest = new CertificateRequest("CN=Droblet Test StoreKit Signing", _leafKey, HashAlgorithmName.SHA256);
        leafRequest.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, true));
        leafRequest.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature, true));
        if (leafOid)
            leafRequest.CertificateExtensions.Add(new X509Extension(new Oid(AppleJwsVerifier.LeafOid), [0x05, 0x00], false));
        Leaf = leafRequest.Create(Intermediate, ValidFrom, leafNotAfter ?? ValidTo, [5, 6, 7, 8]);
    }

    public IReadOnlyList<AppleTrustAnchor> Anchors => [new AppleTrustAnchor(Root, RequireAppleOids: true)];

    /// <summary>A StoreKit-style compact JWS: header { alg: ES256, x5c: [leaf, intermediate, root] }.</summary>
    public string Sign(object payload, string alg = "ES256")
    {
        var header = JsonSerializer.Serialize(new
        {
            alg,
            x5c = new[] { Leaf, Intermediate, Root }.Select(c => Convert.ToBase64String(c.RawData)).ToArray(),
        });
        var signingInput = $"{B64(Encoding.UTF8.GetBytes(header))}.{B64(JsonSerializer.SerializeToUtf8Bytes(payload))}";
        var signature = _leafKey.SignData(Encoding.ASCII.GetBytes(signingInput), HashAlgorithmName.SHA256);
        return $"{signingInput}.{B64(signature)}";
    }

    public static string B64(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public void Dispose()
    {
        Root.Dispose();
        Intermediate.Dispose();
        Leaf.Dispose();
        _leafKey.Dispose();
    }
}
