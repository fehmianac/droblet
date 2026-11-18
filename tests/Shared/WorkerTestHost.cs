using Domain.Entity;
using Domain.Enum;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Infrastructure;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Time.Testing;

namespace Tests.Shared;

/// <summary>Worker DI with the real services and in-memory AWS doubles.</summary>
public sealed class WorkerTestHost
{
    public static readonly DateTime Now = new(2026, 11, 18, 9, 0, 0, DateTimeKind.Utc);

    public InMemoryRepository Repository { get; } = new();
    public FakeObjectStorage Storage { get; } = new();
    public FakeTimeProvider Clock { get; } = new(new DateTimeOffset(Now));
    public IServiceProvider Services { get; }

    public WorkerTestHost(Action<IServiceCollection>? configure = null)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Entitlements:Premium:TryOnCreditsPerMonth"] = "30" })
            .Build();
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddDrobletCore(configuration);
        services.AddDrobletAi();
        services.RemoveAll<IRepository>();
        services.AddSingleton<IRepository>(Repository);
        services.RemoveAll<IObjectStorage>();
        services.AddSingleton<IObjectStorage>(Storage);
        services.RemoveAll<TimeProvider>();
        services.AddSingleton<TimeProvider>(Clock);
        configure?.Invoke(services);
        Services = services.BuildServiceProvider();
    }

    public T Get<T>() where T : notnull => Services.GetRequiredService<T>();

    public async Task<JobEntity> QueueJobAsync(string tenantId, JobKind kind, string? creditKey = null)
    {
        var job = new JobEntity
        {
            Id = Domain.Extensions.Ulid.New(Now), TenantId = tenantId, Kind = kind, Status = JobStatus.Queued,
            CreditIdempotencyKey = creditKey, CreatedAt = Now, UpdatedAt = Now,
        };
        await Repository.SaveAsync(job);
        return job;
    }

    public async Task MakePremiumAsync(string tenantId) => await Repository.SaveAsync(new EntitlementEntity
    {
        Id = "tx", TenantId = tenantId, Tier = Tier.Premium, Source = EntitlementSource.Store,
        StartsAt = Now.AddDays(-2), ExpiresAt = Now.AddMonths(1), PeriodAnchor = Now.AddDays(-2),
    });

    public async Task<PhotoEntity> AddPhotoAsync(string tenantId, PhotoKind kind)
    {
        var photo = new PhotoEntity
        {
            Id = Domain.Extensions.Ulid.New(Now), TenantId = tenantId, Kind = kind, ContentType = "image/jpeg", Active = true, CreatedAt = Now,
        };
        photo.S3Key = StorageKeys.Photo(tenantId, kind, photo.Id, "jpg");
        await Storage.PutAsync(photo.S3Key, TestImages.JpegWithExif(), "image/jpeg", default);
        await Repository.SaveAsync(photo);
        return photo;
    }

    public Task<JobEntity?> JobAsync(JobEntity job) => Repository.GetAsync<JobEntity>(job.Pk, job.Sk);

    public async Task<int> RemainingCreditsAsync(string tenantId) =>
        (await Get<IEntitlementService>().GetAsync(tenantId, default)).Credits.TotalRemaining;
}
