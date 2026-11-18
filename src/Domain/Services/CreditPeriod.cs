namespace Domain.Services;

/// <summary>
/// "Subscription month": monthly windows anchored at the original purchase instant, so a yearly
/// subscriber also gets 30 credits per month. Each boundary is anchor.AddMonths(k) (never chained),
/// so a 31 Jan anchor yields 28/29 Feb, 31 Mar, 30 Apr… without drifting.
/// </summary>
public static class CreditPeriod
{
    public static (DateTime Start, DateTime End) Containing(DateTime anchor, DateTime now)
    {
        if (now < anchor)
            return (anchor, anchor.AddMonths(1));

        var k = (now.Year - anchor.Year) * 12 + now.Month - anchor.Month;
        var start = anchor.AddMonths(k);
        if (start > now)
        {
            k--;
            start = anchor.AddMonths(k);
        }

        return (start, anchor.AddMonths(k + 1));
    }
}
