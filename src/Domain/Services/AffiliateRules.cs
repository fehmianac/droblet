using System.Security.Cryptography;
using System.Text;
using Domain.Entity;
using Domain.Enum;
using Domain.Options;

namespace Domain.Services;

/// <summary>Outbound links: the click id is appended as a query parameter (replacing an existing one of the same name).</summary>
public static class AffiliateLinkBuilder
{
    public static bool IsHttpsUrl(string? url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps;

    public static string AppendClickId(string url, string parameter, string clickId)
    {
        var fragmentIndex = url.IndexOf('#', StringComparison.Ordinal);
        var fragment = fragmentIndex >= 0 ? url[fragmentIndex..] : "";
        var withoutFragment = fragmentIndex >= 0 ? url[..fragmentIndex] : url;

        var queryIndex = withoutFragment.IndexOf('?', StringComparison.Ordinal);
        var path = queryIndex >= 0 ? withoutFragment[..queryIndex] : withoutFragment;
        var pairs = queryIndex >= 0
            ? withoutFragment[(queryIndex + 1)..].Split('&', StringSplitOptions.RemoveEmptyEntries)
                .Where(p => !p.StartsWith(parameter + "=", StringComparison.OrdinalIgnoreCase) && !p.Equals(parameter, StringComparison.OrdinalIgnoreCase))
                .ToList()
            : [];
        pairs.Add($"{Uri.EscapeDataString(parameter)}={Uri.EscapeDataString(clickId)}");
        return $"{path}?{string.Join('&', pairs)}{fragment}";
    }
}

/// <summary>
/// Postback authentication. POST: X-Droblet-Signature = "sha256=" + hex(HMAC-SHA256(secret, raw body)).
/// GET (networks that cannot sign): ?key= shared secret. Both compared in constant time. No secret configured = reject.
/// </summary>
public static class PostbackSignature
{
    public const string Header = "X-Droblet-Signature";
    private const string Prefix = "sha256=";

    public static string Compute(string secret, ReadOnlySpan<byte> body) =>
        Prefix + Convert.ToHexStringLower(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), body));

    public static bool Verify(string? secret, ReadOnlySpan<byte> body, string? signatureHeader)
    {
        if (string.IsNullOrEmpty(secret) || string.IsNullOrWhiteSpace(signatureHeader))
            return false;
        var expected = Encoding.ASCII.GetBytes(Compute(secret, body));
        var actual = Encoding.ASCII.GetBytes(signatureHeader.Trim().ToLowerInvariant());
        return CryptographicOperations.FixedTimeEquals(expected, actual);
    }

    public static bool VerifySharedKey(string? secret, string? key)
    {
        if (string.IsNullOrEmpty(secret) || string.IsNullOrEmpty(key))
            return false;
        return CryptographicOperations.FixedTimeEquals(SHA256.HashData(Encoding.UTF8.GetBytes(secret)), SHA256.HashData(Encoding.UTF8.GetBytes(key)));
    }

    /// <summary>
    /// Null = no usable secret: the postback is refused. An empty value and the deploy placeholder (CHANGE_ME) are
    /// both "not configured" — otherwise anybody could sign a conversion with the well-known placeholder.
    /// </summary>
    public static string? SecretFor(AffiliatePostbackOptions options, AffiliateSource source, string? brandId) => source switch
    {
        AffiliateSource.Network => ConfigSecret.OrNull(options.NetworkSecret),
        _ => brandId is not null && options.DirectBrandSecrets.TryGetValue(brandId, out var secret) && ConfigSecret.IsSet(secret)
            ? secret
            : ConfigSecret.OrNull(options.DirectSecret),
    };
}

public sealed record RevenueBucket(string Key, int Conversions, long GmvMinor, long CommissionMinor);

public sealed record RevenueDay(string Day, int Clicks, int Conversions, long GmvMinor, long CommissionMinor);

public sealed record RevenueReport(
    string From, string To, string Currency,
    int Conversions, long GmvMinor, long CommissionMinor,
    int Pending, int Approved, int Rejected,
    IReadOnlyList<RevenueBucket> ByBrand,
    IReadOnlyList<RevenueBucket> ByLook,
    IReadOnlyList<RevenueBucket> BySource,
    int Clicks,
    IReadOnlyList<RevenueDay> ByDay,
    IReadOnlyList<RevenueBucket> ByNetwork);

/// <summary>GMV and commission from the conversion ledger. Rejected conversions are counted but add no money.</summary>
public static class RevenueReportRules
{
    public const string NoLook = "none";

    public static string LookKey(LookRefKind? kind, string? lookId) =>
        kind is null || string.IsNullOrEmpty(lookId) ? NoLook : $"{kind.Value.ToString().ToLowerInvariant()}:{lookId}";

    /// <summary>Network bucket key: the brand's affiliate network, "direct" for direct deals, "network" when unnamed.</summary>
    public static string NetworkKey(AffiliateSource source, string? network) =>
        source == AffiliateSource.Direct ? "direct" : string.IsNullOrWhiteSpace(network) ? "network" : network.Trim().ToLowerInvariant();

    public static RevenueReport Build(IEnumerable<AffiliateConversionLedgerEntity> ledger, DateOnly from, DateOnly to, string currency = "TRY",
        IEnumerable<AffiliateClickLedgerEntity>? clicks = null, IReadOnlyDictionary<string, string?>? brandNetworks = null)
    {
        var start = from.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var end = to.AddDays(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var rows = ledger.Where(r => r.ReceivedAt >= start && r.ReceivedAt < end && r.Currency == currency).ToList();
        var counted = rows.Where(r => r.Status != AffiliateConversionStatus.Rejected).ToList();
        var clickRows = (clicks ?? []).Where(c => c.CreatedAt >= start && c.CreatedAt < end).ToList();
        string Day(DateTime at) => WeeklyEditRules.Format(DateOnly.FromDateTime(at));
        var clicksByDay = clickRows.GroupBy(c => Day(c.CreatedAt)).ToDictionary(g => g.Key, g => g.Count(), StringComparer.Ordinal);
        var conversionsByDay = counted.GroupBy(r => Day(r.ReceivedAt)).ToDictionary(g => g.Key, g => g.ToList(), StringComparer.Ordinal);
        var byDay = new List<RevenueDay>();
        for (var day = from; day <= to; day = day.AddDays(1))
        {
            var key = WeeklyEditRules.Format(day);
            var dayRows = conversionsByDay.GetValueOrDefault(key) ?? [];
            byDay.Add(new RevenueDay(key, clicksByDay.GetValueOrDefault(key), dayRows.Count, dayRows.Sum(r => r.AmountMinor), dayRows.Sum(r => r.CommissionMinor)));
        }

        return new RevenueReport(
            WeeklyEditRules.Format(from), WeeklyEditRules.Format(to), currency,
            counted.Count, counted.Sum(r => r.AmountMinor), counted.Sum(r => r.CommissionMinor),
            rows.Count(r => r.Status == AffiliateConversionStatus.Pending),
            rows.Count(r => r.Status == AffiliateConversionStatus.Approved),
            rows.Count(r => r.Status == AffiliateConversionStatus.Rejected),
            Buckets(counted, r => r.BrandId),
            Buckets(counted, r => LookKey(r.LookKind, r.LookId)),
            Buckets(counted, r => r.Source.ToString().ToLowerInvariant()),
            clickRows.Count,
            byDay,
            Buckets(counted, r => NetworkKey(r.Source, brandNetworks?.GetValueOrDefault(r.BrandId))));
    }

    private static List<RevenueBucket> Buckets(IEnumerable<AffiliateConversionLedgerEntity> rows, Func<AffiliateConversionLedgerEntity, string> key) =>
        rows.GroupBy(key)
            .Select(g => new RevenueBucket(g.Key, g.Count(), g.Sum(r => r.AmountMinor), g.Sum(r => r.CommissionMinor)))
            .OrderByDescending(b => b.GmvMinor).ThenBy(b => b.Key, StringComparer.Ordinal)
            .ToList();
}
