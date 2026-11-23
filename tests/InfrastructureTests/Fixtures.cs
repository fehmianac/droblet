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

    /// <summary>The Akış share state (account deletion removes the shared looks through it); covers are never requested here.</summary>
    public static Infrastructure.Services.Store.FeedShareService FeedShares(Domain.Manager.IRepository repository, Domain.Services.IObjectStorage? storage = null)
    {
        storage ??= new Tests.Shared.FakeObjectStorage();
        return new(repository, new NoCovers(), storage,
            new Infrastructure.Storage.ItemImagePublisher(storage, new NoCdn(), Microsoft.Extensions.Logging.Abstractions.NullLogger<Infrastructure.Storage.ItemImagePublisher>.Instance),
            new Infrastructure.Services.RateLimiter(repository, TimeProvider.System), Monitor(new ContentFeedOptions()), TimeProvider.System,
            Microsoft.Extensions.Logging.Abstractions.NullLogger<Infrastructure.Services.Store.FeedShareService>.Instance);
    }

    private sealed class NoCdn : Domain.Services.ICdnCache
    {
        public Task PurgeAsync(IReadOnlyList<string> publicKeys, CancellationToken ct) => Task.CompletedTask;
    }

    private sealed class NoCovers : Domain.Services.ILookCoverService
    {
        public Task<LookCoverEntity?> RequestAsync(LookEntity look, CancellationToken ct) => Task.FromResult<LookCoverEntity?>(null);
        public Task<LookCoverEntity?> GetAsync(string tenantId, string lookId, CancellationToken ct) => Task.FromResult<LookCoverEntity?>(null);
        public Task<IReadOnlyDictionary<string, LookCoverEntity>> GetAllAsync(string tenantId, CancellationToken ct) =>
            Task.FromResult<IReadOnlyDictionary<string, LookCoverEntity>>(new Dictionary<string, LookCoverEntity>());
        public Task<Domain.Domain.LookDto> WithCoverAsync(LookEntity look, Domain.Domain.LookDto dto, LookCoverEntity? cover, CancellationToken ct) => Task.FromResult(dto);
        public Task DeleteAsync(string tenantId, string lookId, CancellationToken ct) => Task.CompletedTask;
    }

    /// <summary>The stylist job gate with the default Teen:Stylist options (adults / members: no reservation).</summary>
    public static Infrastructure.Services.StylistAllowanceService Allowance(Domain.Manager.IRepository repository, TimeProvider clock, TeenOptions? teen = null) =>
        new(repository, new Infrastructure.Services.EntitlementService(repository, Entitlements(), clock), Monitor(teen ?? new TeenOptions()), clock);

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
