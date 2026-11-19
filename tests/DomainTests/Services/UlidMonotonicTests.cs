using Domain.Extensions;

namespace DomainTests.Services;

public class UlidMonotonicTests
{
    [Fact]
    public void NewMonotonic_SameMillisecond_IdsKeepTheirOrder()
    {
        var at = new DateTime(2026, 11, 19, 12, 0, 0, DateTimeKind.Utc);
        var ids = Enumerable.Range(0, 2000).Select(_ => Ulid.NewMonotonic(at)).ToList();

        Assert.Equal(ids, ids.Order(StringComparer.Ordinal));
        Assert.Equal(ids.Count, ids.Distinct().Count());
        Assert.All(ids, id => Assert.True(Ulid.IsValid(id)));
    }

    [Fact]
    public void NewMonotonic_ClockSteppedBack_StillAfterThePreviousId()
    {
        var later = Ulid.NewMonotonic(new DateTime(2026, 11, 19, 12, 0, 1, DateTimeKind.Utc));
        var earlierClock = Ulid.NewMonotonic(new DateTime(2026, 11, 19, 12, 0, 0, DateTimeKind.Utc));

        Assert.True(string.CompareOrdinal(earlierClock, later) > 0);
    }
}
