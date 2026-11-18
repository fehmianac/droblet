using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.Json.Nodes;
using Domain.Constant;
using Domain.Entity.Base;
using Domain.Manager;
using Infrastructure.Serialization;

namespace Tests.Shared;

/// <summary>
/// IRepository double with DynamoDB semantics that matter to the domain: items round-trip through the same JSON as
/// the real repository, conditional writes and transactions are all-or-nothing, versioned puts increment.
/// </summary>
public sealed class InMemoryRepository : IRepository
{
    private readonly object _gate = new();
    private readonly SortedDictionary<(string Pk, string Sk), string> _items = new(Comparer<(string, string)>.Create(
        (a, b) => string.CompareOrdinal(a.Item1, b.Item1) is var c && c != 0 ? c : string.CompareOrdinal(a.Item2, b.Item2)));

    public ConcurrentDictionary<(string, string), long> Counters { get; } = new();

    public int Count { get { lock (_gate) return _items.Count; } }

    public IReadOnlyList<(string Pk, string Sk)> Keys { get { lock (_gate) return _items.Keys.ToList(); } }

    public IReadOnlyList<string> PartitionKeys { get { lock (_gate) return _items.Keys.Select(k => k.Pk).Distinct().ToList(); } }

    public Task<bool> SaveAsync(IEntity entity, CancellationToken ct = default)
    {
        lock (_gate) _items[(entity.Pk, entity.Sk)] = EntitySerializer.Serialize(entity);
        return Task.FromResult(true);
    }

    public Task<T?> GetAsync<T>(string pk, string sk, CancellationToken ct = default) where T : new()
    {
        lock (_gate)
            return Task.FromResult(_items.TryGetValue((pk, sk), out var json) ? EntitySerializer.Deserialize<T>(json) : default);
    }

    public Task<bool> DeleteAsync(string pk, string sk, CancellationToken ct = default)
    {
        lock (_gate) _items.Remove((pk, sk));
        return Task.FromResult(true);
    }

    public Task<List<T>> GetAllAsync<T>(string pk, CancellationToken ct = default) =>
        Task.FromResult(Query(pk, _ => true).Select(EntitySerializer.Deserialize<T>).ToList());

    public Task<List<T>> GetAllAsync<T>(string pk, string sk, SkOperator op, CancellationToken ct = default) =>
        Task.FromResult(Query(pk, s => Match(s, sk, op)).Select(EntitySerializer.Deserialize<T>).ToList());

    public Task<(List<T> entities, string? pageToken, long count)> GetPagedAsync<T>(string pk, string? pagedToken, int? limit, CancellationToken ct = default) =>
        GetPagedAsync<T>(pk, SkOperator.Equal, null, pagedToken, limit, ct);

    public Task<(List<T> entities, string? pageToken, long count)> GetPagedAsync<T>(string pk, SkOperator op, string? sk, string? pagedToken, int? limit, CancellationToken ct = default)
    {
        var all = Query(pk, s => sk is null || Match(s, sk, op)).AsEnumerable().Reverse().ToList();
        var skip = int.TryParse(pagedToken, out var n) ? n : 0;
        var take = Math.Clamp(limit ?? 20, 1, 100);
        var page = all.Skip(skip).Take(take).Select(EntitySerializer.Deserialize<T>).ToList();
        var next = skip + take < all.Count ? (skip + take).ToString(System.Globalization.CultureInfo.InvariantCulture) : null;
        return Task.FromResult((page, next, (long)page.Count));
    }

    public Task BatchWriteAsync(List<IEntity> itemList, CancellationToken ct = default) => BatchWriteAsync(itemList, [], ct);

    public Task BatchWriteAsync(List<IEntity> putItemList, List<IEntity> deleteItemList, CancellationToken ct = default)
    {
        lock (_gate)
        {
            foreach (var e in putItemList) _items[(e.Pk, e.Sk)] = EntitySerializer.Serialize(e);
            foreach (var e in deleteItemList) _items.Remove((e.Pk, e.Sk));
        }
        return Task.CompletedTask;
    }

    public Task BatchDeleteAsync(List<IEntity> itemList, CancellationToken ct = default) => BatchWriteAsync([], itemList, ct);

    public Task BatchDeleteAsync<T>(List<T> entities, CancellationToken ct = default) where T : IEntity, new() =>
        BatchWriteAsync([], entities.Cast<IEntity>().ToList(), ct);

    public async Task<List<T>> BatchGetAsync<T>(List<T> entities, CancellationToken ct = default) where T : IEntity, new()
    {
        var result = new List<T>();
        foreach (var e in entities)
            if (await GetAsync<T>(e.Pk, e.Sk, ct) is { } found) result.Add(found);
        return result;
    }

    public Task<List<(string Pk, string Sk)>> GetKeysAsync(string pk, CancellationToken ct = default)
    {
        lock (_gate) return Task.FromResult(_items.Keys.Where(k => k.Pk == pk).ToList());
    }

    public Task BatchDeleteKeysAsync(IReadOnlyList<(string Pk, string Sk)> keys, CancellationToken ct = default)
    {
        lock (_gate) foreach (var k in keys) _items.Remove(k);
        return Task.CompletedTask;
    }

    public Task<List<T>> QueryGsiAsync<T>(DynamoDbConstant.IndexDefinition index, string gsiPk, CancellationToken ct = default) =>
        throw new NotSupportedException("No GSI in this slice.");

    public Task<List<T>> QueryGsiAsync<T>(DynamoDbConstant.IndexDefinition index, string gsiPk, string gsiSk, SkOperator op, CancellationToken ct = default) =>
        throw new NotSupportedException("No GSI in this slice.");

    public Task<bool> AtomicIncrementInMapAsync(string pk, string sk, string mapAttributeName, string mapKey, int increment = 1, CancellationToken ct = default)
    {
        Counters.AddOrUpdate(($"{pk}|{sk}", $"{mapAttributeName}.{mapKey}"), increment, (_, v) => v + increment);
        return Task.FromResult(true);
    }

    public Task<long> IncrementCounterAsync(string pk, string sk, string attributeName, long ttl, CancellationToken ct = default) =>
        Task.FromResult(Counters.AddOrUpdate(($"{pk}|{sk}", attributeName), 1, (_, v) => v + 1));

    public Task<bool> SaveIfVersionAsync(IVersionedEntity entity, long expectedVersion, CancellationToken ct = default)
    {
        lock (_gate)
        {
            if (!VersionMatches(entity.Pk, entity.Sk, expectedVersion))
                return Task.FromResult(false);
            entity.Version = expectedVersion + 1;
            _items[(entity.Pk, entity.Sk)] = EntitySerializer.Serialize(entity);
            return Task.FromResult(true);
        }
    }

    public async Task<TransactOutcome> SaveWithReceiptAsync(IEntity receipt, IReadOnlyList<IEntity> items, CancellationToken ct = default)
    {
        var ops = new List<TransactWriteOperation> { TransactWriteOperation.Create(receipt) };
        ops.AddRange(items.Select(i => i is IVersionedEntity v ? TransactWriteOperation.PutVersioned(v) : TransactWriteOperation.Put(i)));
        var result = await TransactWriteAsync(ops, ct);
        return result.Outcome == TransactOutcome.ConditionFailed && result.FailedIndex == 0 ? TransactOutcome.DuplicateReceipt : result.Outcome;
    }

    public Task<TransactResult> TransactWriteAsync(IReadOnlyList<TransactWriteOperation> operations, CancellationToken ct = default)
    {
        lock (_gate)
        {
            for (var i = 0; i < operations.Count; i++)
            {
                var op = operations[i];
                var exists = _items.ContainsKey((op.Pk, op.Sk));
                var ok = op.Condition switch
                {
                    WriteCondition.NotExists => !exists,
                    WriteCondition.Exists => exists,
                    WriteCondition.VersionEquals => VersionMatches(op.Pk, op.Sk, op.ExpectedVersion),
                    _ => true,
                };
                if (!ok)
                    return Task.FromResult(new TransactResult(
                        op.Condition == WriteCondition.VersionEquals ? TransactOutcome.VersionConflict : TransactOutcome.ConditionFailed, i));
            }

            foreach (var op in operations)
            {
                if (op.IsDelete)
                {
                    _items.Remove((op.Pk, op.Sk));
                    continue;
                }
                if (op is { WritesVersion: true, Entity: IVersionedEntity v })
                    v.Version = op.ExpectedVersion + 1;
                _items[(op.Pk, op.Sk)] = EntitySerializer.Serialize(op.Entity!);
            }
            return Task.FromResult(TransactResult.Success);
        }
    }

    private bool VersionMatches(string pk, string sk, long expected)
    {
        if (!_items.TryGetValue((pk, sk), out var json))
            return expected == 0;
        var stored = JsonNode.Parse(json)?["version"]?.GetValue<long>() ?? 0;
        return expected != 0 && stored == expected;
    }

    private List<string> Query(string pk, Func<string, bool> skFilter)
    {
        lock (_gate) return _items.Where(kv => kv.Key.Pk == pk && skFilter(kv.Key.Sk)).Select(kv => kv.Value).ToList();
    }

    private static bool Match(string sk, string value, SkOperator op) => op switch
    {
        SkOperator.Equal => sk == value,
        SkOperator.BeginsWith => sk.StartsWith(value, StringComparison.Ordinal),
        SkOperator.LessThan => string.CompareOrdinal(sk, value) < 0,
        SkOperator.LessThanOrEqual => string.CompareOrdinal(sk, value) <= 0,
        SkOperator.GreaterThan => string.CompareOrdinal(sk, value) > 0,
        SkOperator.GreaterThanOrEqual => string.CompareOrdinal(sk, value) >= 0,
        _ => false,
    };

    public string Raw(string pk, string sk)
    {
        lock (_gate) return _items[(pk, sk)];
    }

    public static JsonElement Parse(string json) => JsonDocument.Parse(json).RootElement;
}
