using Domain.Constant;
using Domain.Entity.Base;

namespace Domain.Manager;

public enum SkOperator { Equal, BeginsWith, LessThan, LessThanOrEqual, GreaterThan, GreaterThanOrEqual }

public enum TransactOutcome { Applied, DuplicateReceipt, VersionConflict, ConditionFailed }

public enum WriteCondition { None, NotExists, Exists, VersionEquals }

/// <summary>One write inside a DynamoDB transaction. Built through the factory methods.</summary>
public sealed record TransactWriteOperation
{
    public IEntity? Entity { get; private init; }
    public string Pk { get; private init; } = null!;
    public string Sk { get; private init; } = null!;
    public bool IsDelete { get; private init; }
    /// <summary>True when a successful write stores ExpectedVersion + 1 (versioned put, or create of a versioned entity).</summary>
    public bool WritesVersion => !IsDelete && Entity is IVersionedEntity && Condition is WriteCondition.VersionEquals or WriteCondition.NotExists;
    public WriteCondition Condition { get; private init; }
    public long ExpectedVersion { get; private init; }

    /// <summary>Unconditional put.</summary>
    public static TransactWriteOperation Put(IEntity entity) =>
        new() { Entity = entity, Pk = entity.Pk, Sk = entity.Sk };

    /// <summary>Put only if the key does not exist yet (uniqueness / receipts). A versioned entity is written as version 1.</summary>
    public static TransactWriteOperation Create(IEntity entity) =>
        new() { Entity = entity, Pk = entity.Pk, Sk = entity.Sk, Condition = WriteCondition.NotExists };

    /// <summary>Put if the stored version equals the entity's current version (0 = must not exist); version is incremented.</summary>
    public static TransactWriteOperation PutVersioned(IVersionedEntity entity) =>
        new() { Entity = entity, Pk = entity.Pk, Sk = entity.Sk, Condition = WriteCondition.VersionEquals, ExpectedVersion = entity.Version };

    /// <summary>Put only if the key still exists: a background writer never brings back a row the user deleted meanwhile.</summary>
    public static TransactWriteOperation PutExisting(IEntity entity) =>
        new() { Entity = entity, Pk = entity.Pk, Sk = entity.Sk, Condition = WriteCondition.Exists };

    public static TransactWriteOperation Delete(string pk, string sk) =>
        new() { Pk = pk, Sk = sk, IsDelete = true };

    /// <summary>Delete only if the item exists (single-use tokens).</summary>
    public static TransactWriteOperation DeleteExisting(string pk, string sk) =>
        new() { Pk = pk, Sk = sk, IsDelete = true, Condition = WriteCondition.Exists };
}

public sealed record TransactResult(TransactOutcome Outcome, int? FailedIndex = null)
{
    public bool Applied => Outcome == TransactOutcome.Applied;
    public static readonly TransactResult Success = new(TransactOutcome.Applied);
}

/// <summary>The only path to DynamoDB. Handlers and services never use the AWS SDK directly.</summary>
public interface IRepository
{
    // Single item
    Task<bool> SaveAsync(IEntity entity, CancellationToken ct = default);
    Task<T?> GetAsync<T>(string pk, string sk, CancellationToken ct = default) where T : new();
    Task<bool> DeleteAsync(string pk, string sk, CancellationToken ct = default);

    // Collection queries
    Task<List<T>> GetAllAsync<T>(string pk, CancellationToken ct = default);
    Task<List<T>> GetAllAsync<T>(string pk, string sk, SkOperator op, CancellationToken ct = default);

    // Pagination
    Task<(List<T> entities, string? pageToken, long count)> GetPagedAsync<T>(
        string pk, string? pagedToken, int? limit, CancellationToken ct = default);
    Task<(List<T> entities, string? pageToken, long count)> GetPagedAsync<T>(
        string pk, SkOperator op, string? sk, string? pagedToken, int? limit, CancellationToken ct = default);

    // Batch
    Task BatchWriteAsync(List<IEntity> itemList, CancellationToken ct = default);
    Task BatchWriteAsync(List<IEntity> putItemList, List<IEntity> deleteItemList, CancellationToken ct = default);
    Task BatchDeleteAsync(List<IEntity> itemList, CancellationToken ct = default);
    Task BatchDeleteAsync<T>(List<T> entities, CancellationToken ct = default) where T : IEntity, new();
    Task<List<T>> BatchGetAsync<T>(List<T> entities, CancellationToken ct = default) where T : IEntity, new();

    // Raw-key helpers used by deletion flows (partition listing without a typed entity)
    Task<List<(string Pk, string Sk)>> GetKeysAsync(string pk, CancellationToken ct = default);
    Task BatchDeleteKeysAsync(IReadOnlyList<(string Pk, string Sk)> keys, CancellationToken ct = default);

    // GSI queries
    Task<List<T>> QueryGsiAsync<T>(DynamoDbConstant.IndexDefinition index, string gsiPk, CancellationToken ct = default);
    Task<List<T>> QueryGsiAsync<T>(DynamoDbConstant.IndexDefinition index, string gsiPk, string gsiSk, SkOperator op, CancellationToken ct = default);

    // Atomic operations
    Task<bool> AtomicIncrementInMapAsync(string pk, string sk, string mapAttributeName, string mapKey, int increment = 1, CancellationToken ct = default);
    /// <summary>Atomically increments a numeric counter attribute (creating the item) and returns the new value. ttl is Unix seconds.</summary>
    Task<long> IncrementCounterAsync(string pk, string sk, string attributeName, long ttl, CancellationToken ct = default);
    /// <summary>
    /// Atomically ADDs each value to its top-level numeric attribute of an EXISTING item (nothing is created) and returns
    /// every top-level numeric attribute after the update; null when the item does not exist.
    /// </summary>
    Task<IReadOnlyDictionary<string, long>?> AddCountersAsync(string pk, string sk, IReadOnlyDictionary<string, long> increments, CancellationToken ct = default);

    // Offline sync / multi device
    /// <summary>Writes when stored version == expectedVersion (0 = must not exist); sets entity.Version = expectedVersion + 1.</summary>
    Task<bool> SaveIfVersionAsync(IVersionedEntity entity, long expectedVersion, CancellationToken ct = default);
    /// <summary>Writes receipt (attribute_not_exists) plus items in one transaction; versioned items are conditioned on their read version and incremented.</summary>
    Task<TransactOutcome> SaveWithReceiptAsync(IEntity receipt, IReadOnlyList<IEntity> items, CancellationToken ct = default);
    /// <summary>General TransactWriteItems (max 100 operations). Versioned puts get Version+1 on success.</summary>
    Task<TransactResult> TransactWriteAsync(IReadOnlyList<TransactWriteOperation> operations, CancellationToken ct = default);
}
