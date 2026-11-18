using Domain.Entity;
using Domain.Enum;
using Domain.Options;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Time.Testing;

namespace InfrastructureTests;

internal static class Fixtures
{
    public static readonly DateTime Now = new(2026, 11, 18, 9, 0, 0, DateTimeKind.Utc);

    public static FakeTimeProvider Clock() => new(new DateTimeOffset(Now));

    public static IOptionsMonitor<T> Monitor<T>(T value) where T : class => new StaticMonitor<T>(value);

    public static IOptionsMonitor<EntitlementOptions> Entitlements(int credits = 30) =>
        Monitor(new EntitlementOptions { Premium = { TryOnCreditsPerMonth = credits } });

    public static EntitlementEntity Premium(string tenantId, DateTime anchor, DateTime? expires = null) => new()
    {
        Id = "orig-tx-1",
        TenantId = tenantId,
        Tier = Tier.Premium,
        Source = EntitlementSource.Store,
        Platform = StorePlatform.Apple,
        ProductId = "com.alatech.droplet.premium.monthly",
        StartsAt = anchor,
        ExpiresAt = expires ?? anchor.AddYears(1),
        PeriodAnchor = anchor,
    };

    private sealed class StaticMonitor<T>(T value) : IOptionsMonitor<T>
    {
        public T CurrentValue => value;
        public T Get(string? name) => value;
        public IDisposable? OnChange(Action<T, string?> listener) => null;
    }
}
