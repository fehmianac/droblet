using Domain.Services;

namespace DomainTests.Services;

public class CreditPeriodTests
{
    private static DateTime Utc(int y, int m, int d, int h = 0) => new(y, m, d, h, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void Containing_WhenInFirstMonth_StartsAtAnchor()
    {
        var (start, end) = CreditPeriod.Containing(Utc(2026, 3, 15, 10), Utc(2026, 3, 20));

        Assert.Equal(Utc(2026, 3, 15, 10), start);
        Assert.Equal(Utc(2026, 4, 15, 10), end);
    }

    [Fact]
    public void Containing_WhenBeforeMonthlyAnniversaryInLaterMonth_UsesPreviousWindow()
    {
        var (start, end) = CreditPeriod.Containing(Utc(2026, 3, 15, 10), Utc(2026, 7, 15, 9));

        Assert.Equal(Utc(2026, 6, 15, 10), start);
        Assert.Equal(Utc(2026, 7, 15, 10), end);
    }

    [Fact]
    public void Containing_WhenExactlyAtBoundary_NewWindowStarts()
    {
        var (start, _) = CreditPeriod.Containing(Utc(2026, 3, 15, 10), Utc(2026, 4, 15, 10));

        Assert.Equal(Utc(2026, 4, 15, 10), start);
    }

    [Fact]
    public void Containing_WhenAnchorIs31st_ClampsWithoutDrift()
    {
        var anchor = Utc(2026, 1, 31);

        Assert.Equal((Utc(2026, 1, 31), Utc(2026, 2, 28)), CreditPeriod.Containing(anchor, Utc(2026, 2, 10)));
        Assert.Equal((Utc(2026, 2, 28), Utc(2026, 3, 31)), CreditPeriod.Containing(anchor, Utc(2026, 3, 1)));
        Assert.Equal((Utc(2026, 3, 31), Utc(2026, 4, 30)), CreditPeriod.Containing(anchor, Utc(2026, 4, 1)));
    }

    [Fact]
    public void Containing_WhenYearlySubscription_StillMonthlyWindows()
    {
        var (start, end) = CreditPeriod.Containing(Utc(2026, 1, 5), Utc(2026, 11, 18));

        Assert.Equal(Utc(2026, 11, 5), start);
        Assert.Equal(Utc(2026, 12, 5), end);
    }

    [Fact]
    public void Containing_WhenNowBeforeAnchor_ReturnsFirstWindow()
    {
        var (start, _) = CreditPeriod.Containing(Utc(2026, 5, 1), Utc(2026, 4, 1));

        Assert.Equal(Utc(2026, 5, 1), start);
    }
}
