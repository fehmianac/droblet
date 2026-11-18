using Domain.Enum;
using Domain.Options;

namespace Domain.Services;

/// <summary>Commission per brand (network or direct deal). Amounts are integer minor units (kuruş).</summary>
public static class AffiliateCommission
{
    public static (AffiliateSource Source, int RateBps) TermsFor(AffiliateOptions options, string brandId) =>
        options.Brands.TryGetValue(brandId, out var brand)
            ? (brand.Source, brand.CommissionRateBps)
            : (AffiliateSource.Network, options.DefaultCommissionRateBps);

    public static long Calculate(long amountMinor, int rateBps)
    {
        if (amountMinor <= 0 || rateBps <= 0)
            return 0;
        return amountMinor * rateBps / 10_000;
    }
}
