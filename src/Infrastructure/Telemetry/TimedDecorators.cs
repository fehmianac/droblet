using Domain.Constant;
using Domain.Entity.Base;
using Domain.Manager;
using Domain.Services;

namespace Infrastructure.Telemetry;

/// <summary>Adds every DynamoDB call of a worker run to the "db" stage (cumulative ms) — no-op outside a run.</summary>
public sealed class TimedRepository(IRepository inner) : IRepository
{
    private const string Stage = "db";

    private static async Task<T> Time<T>(Func<Task<T>> call)
    {
        using var _ = AiTelemetry.Measure(Stage);
        return await call();
    }

    private static async Task Time(Func<Task> call)
    {
        using var _ = AiTelemetry.Measure(Stage);
        await call();
    }

    public Task<bool> SaveAsync(IEntity entity, CancellationToken ct = default) => Time(() => inner.SaveAsync(entity, ct));
    public Task<T?> GetAsync<T>(string pk, string sk, CancellationToken ct = default) where T : new() => Time(() => inner.GetAsync<T>(pk, sk, ct));
    public Task<bool> DeleteAsync(string pk, string sk, CancellationToken ct = default) => Time(() => inner.DeleteAsync(pk, sk, ct));
    public Task<List<T>> GetAllAsync<T>(string pk, CancellationToken ct = default) => Time(() => inner.GetAllAsync<T>(pk, ct));
    public Task<List<T>> GetAllAsync<T>(string pk, string sk, SkOperator op, CancellationToken ct = default) => Time(() => inner.GetAllAsync<T>(pk, sk, op, ct));
    public Task<(List<T> entities, string? pageToken, long count)> GetPagedAsync<T>(string pk, string? pagedToken, int? limit, CancellationToken ct = default) =>
        Time(() => inner.GetPagedAsync<T>(pk, pagedToken, limit, ct));
    public Task<(List<T> entities, string? pageToken, long count)> GetPagedAsync<T>(string pk, SkOperator op, string? sk, string? pagedToken, int? limit, CancellationToken ct = default) =>
        Time(() => inner.GetPagedAsync<T>(pk, op, sk, pagedToken, limit, ct));
    public Task BatchWriteAsync(List<IEntity> itemList, CancellationToken ct = default) => Time(() => inner.BatchWriteAsync(itemList, ct));
    public Task BatchWriteAsync(List<IEntity> putItemList, List<IEntity> deleteItemList, CancellationToken ct = default) => Time(() => inner.BatchWriteAsync(putItemList, deleteItemList, ct));
    public Task BatchDeleteAsync(List<IEntity> itemList, CancellationToken ct = default) => Time(() => inner.BatchDeleteAsync(itemList, ct));
    public Task BatchDeleteAsync<T>(List<T> entities, CancellationToken ct = default) where T : IEntity, new() => Time(() => inner.BatchDeleteAsync(entities, ct));
    public Task<List<T>> BatchGetAsync<T>(List<T> entities, CancellationToken ct = default) where T : IEntity, new() => Time(() => inner.BatchGetAsync(entities, ct));
    public Task<List<(string Pk, string Sk)>> GetKeysAsync(string pk, CancellationToken ct = default) => Time(() => inner.GetKeysAsync(pk, ct));
    public Task BatchDeleteKeysAsync(IReadOnlyList<(string Pk, string Sk)> keys, CancellationToken ct = default) => Time(() => inner.BatchDeleteKeysAsync(keys, ct));
    public Task<List<T>> QueryGsiAsync<T>(DynamoDbConstant.IndexDefinition index, string gsiPk, CancellationToken ct = default) => Time(() => inner.QueryGsiAsync<T>(index, gsiPk, ct));
    public Task<List<T>> QueryGsiAsync<T>(DynamoDbConstant.IndexDefinition index, string gsiPk, string gsiSk, SkOperator op, CancellationToken ct = default) =>
        Time(() => inner.QueryGsiAsync<T>(index, gsiPk, gsiSk, op, ct));
    public Task<bool> AtomicIncrementInMapAsync(string pk, string sk, string mapAttributeName, string mapKey, int increment = 1, CancellationToken ct = default) =>
        Time(() => inner.AtomicIncrementInMapAsync(pk, sk, mapAttributeName, mapKey, increment, ct));
    public Task<long> IncrementCounterAsync(string pk, string sk, string attributeName, long ttl, CancellationToken ct = default) =>
        Time(() => inner.IncrementCounterAsync(pk, sk, attributeName, ttl, ct));
    public Task<bool> SaveIfVersionAsync(IVersionedEntity entity, long expectedVersion, CancellationToken ct = default) => Time(() => inner.SaveIfVersionAsync(entity, expectedVersion, ct));
    public Task<TransactOutcome> SaveWithReceiptAsync(IEntity receipt, IReadOnlyList<IEntity> items, CancellationToken ct = default) => Time(() => inner.SaveWithReceiptAsync(receipt, items, ct));
    public Task<TransactResult> TransactWriteAsync(IReadOnlyList<TransactWriteOperation> operations, CancellationToken ct = default) => Time(() => inner.TransactWriteAsync(operations, ct));
}

/// <summary>Adds S3 reads to "s3_get" and writes to "s3_put" (cumulative ms) — no-op outside a run.</summary>
public sealed class TimedObjectStorage(IObjectStorage inner) : IObjectStorage
{
    public Task<PresignedUpload> CreateUploadAsync(string key, string contentType, long maxBytes, TimeSpan ttl, CancellationToken ct) =>
        inner.CreateUploadAsync(key, contentType, maxBytes, ttl, ct);

    public Task<string> CreateReadUrlAsync(string key, TimeSpan ttl, CancellationToken ct) => inner.CreateReadUrlAsync(key, ttl, ct);

    public async Task<StoredObjectInfo?> HeadAsync(string key, CancellationToken ct)
    {
        using var _ = AiTelemetry.Measure("s3_get");
        return await inner.HeadAsync(key, ct);
    }

    public async Task<byte[]?> ReadAsync(string key, long maxBytes, CancellationToken ct)
    {
        using var _ = AiTelemetry.Measure("s3_get");
        return await inner.ReadAsync(key, maxBytes, ct);
    }

    public async Task PutAsync(string key, byte[] data, string contentType, CancellationToken ct)
    {
        using var _ = AiTelemetry.Measure("s3_put");
        await inner.PutAsync(key, data, contentType, ct);
    }

    public async Task DeleteAsync(string key, CancellationToken ct)
    {
        using var _ = AiTelemetry.Measure("s3_put");
        await inner.DeleteAsync(key, ct);
    }

    public Task DeletePrefixAsync(string prefix, CancellationToken ct) => inner.DeletePrefixAsync(prefix, ct);

    // Data export only (not an AI job): passed through untimed.
    public Task<IReadOnlyList<string>> ListKeysAsync(string prefix, CancellationToken ct) => inner.ListKeysAsync(prefix, ct);

    public Task<Stream?> OpenReadAsync(string key, CancellationToken ct) => inner.OpenReadAsync(key, ct);

    public Task PutFileAsync(string key, string filePath, string contentType, CancellationToken ct) => inner.PutFileAsync(key, filePath, contentType, ct);

    public Task<string> CreateDownloadUrlAsync(string key, string fileName, TimeSpan ttl, CancellationToken ct) => inner.CreateDownloadUrlAsync(key, fileName, ttl, ct);
}
