using System.Text;
using System.Text.Json;
using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.DocumentModel;
using Amazon.DynamoDBv2.Model;
using Domain.Constant;
using Domain.Entity.Base;
using Domain.Manager;
using Infrastructure.Serialization;

namespace Infrastructure;

/// <summary>The only class that talks to DynamoDB.</summary>
public class Repository(IAmazonDynamoDB client) : IRepository
{
    private const string PkName = "pk";
    private const string SkName = "sk";
    private const string VersionName = "version";
    private const int BatchWriteSize = 25;
    private const int BatchGetSize = 100;
    private const int MaxBatchRetries = 8;

    private static string Table => DynamoDbConstant.TableName;

    public async Task<bool> SaveAsync(IEntity entity, CancellationToken ct = default)
    {
        await client.PutItemAsync(new PutItemRequest { TableName = Table, Item = ToItem(entity) }, ct);
        return true;
    }

    public async Task<T?> GetAsync<T>(string pk, string sk, CancellationToken ct = default) where T : new()
    {
        var response = await client.GetItemAsync(new GetItemRequest
        {
            TableName = Table,
            Key = Key(pk, sk),
            ConsistentRead = true,
        }, ct);

        return response.Item is { Count: > 0 } ? FromItem<T>(response.Item) : default;
    }

    public async Task<bool> DeleteAsync(string pk, string sk, CancellationToken ct = default)
    {
        await client.DeleteItemAsync(new DeleteItemRequest { TableName = Table, Key = Key(pk, sk) }, ct);
        return true;
    }

    public Task<List<T>> GetAllAsync<T>(string pk, CancellationToken ct = default) =>
        QueryAllAsync<T>(BuildQuery(pk, null, null), ct);

    public Task<List<T>> GetAllAsync<T>(string pk, string sk, SkOperator op, CancellationToken ct = default) =>
        QueryAllAsync<T>(BuildQuery(pk, sk, op), ct);

    public Task<(List<T> entities, string? pageToken, long count)> GetPagedAsync<T>(
        string pk, string? pagedToken, int? limit, CancellationToken ct = default) =>
        QueryPageAsync<T>(BuildQuery(pk, null, null), pagedToken, limit, ct);

    public Task<(List<T> entities, string? pageToken, long count)> GetPagedAsync<T>(
        string pk, SkOperator op, string? sk, string? pagedToken, int? limit, CancellationToken ct = default) =>
        QueryPageAsync<T>(BuildQuery(pk, sk, sk is null ? null : op), pagedToken, limit, ct);

    public Task BatchWriteAsync(List<IEntity> itemList, CancellationToken ct = default) =>
        BatchWriteAsync(itemList, [], ct);

    public async Task BatchWriteAsync(List<IEntity> putItemList, List<IEntity> deleteItemList, CancellationToken ct = default)
    {
        var requests = putItemList.Select(e => new WriteRequest { PutRequest = new PutRequest { Item = ToItem(e) } })
            .Concat(deleteItemList.Select(e => new WriteRequest { DeleteRequest = new DeleteRequest { Key = Key(e.Pk, e.Sk) } }))
            .ToList();
        await ExecuteBatchWriteAsync(requests, ct);
    }

    public Task BatchDeleteAsync(List<IEntity> itemList, CancellationToken ct = default) =>
        BatchWriteAsync([], itemList, ct);

    public Task BatchDeleteAsync<T>(List<T> entities, CancellationToken ct = default) where T : IEntity, new() =>
        BatchWriteAsync([], entities.Cast<IEntity>().ToList(), ct);

    public async Task<List<T>> BatchGetAsync<T>(List<T> entities, CancellationToken ct = default) where T : IEntity, new()
    {
        var result = new List<T>();
        foreach (var chunk in entities.Select(e => (e.Pk, e.Sk)).Distinct().Chunk(BatchGetSize))
        {
            var keys = chunk.Select(k => Key(k.Pk, k.Sk)).ToList();
            for (var attempt = 0; keys.Count > 0; attempt++)
            {
                var response = await client.BatchGetItemAsync(new BatchGetItemRequest
                {
                    RequestItems = new Dictionary<string, KeysAndAttributes> { [Table] = new() { Keys = keys, ConsistentRead = true } },
                }, ct);

                if (response.Responses?.TryGetValue(Table, out var items) == true)
                    result.AddRange(items.Select(FromItem<T>));

                keys = response.UnprocessedKeys?.TryGetValue(Table, out var rest) == true ? rest.Keys : [];
                if (keys.Count > 0)
                    await BackoffAsync(attempt, ct);
            }
        }
        return result;
    }

    public async Task<List<(string Pk, string Sk)>> GetKeysAsync(string pk, CancellationToken ct = default)
    {
        var request = BuildQuery(pk, null, null);
        request.ProjectionExpression = "#pk, #sk";
        request.ExpressionAttributeNames["#sk"] = SkName;
        var keys = new List<(string, string)>();
        do
        {
            var response = await client.QueryAsync(request, ct);
            keys.AddRange(response.Items.Select(i => (i[PkName].S, i[SkName].S)));
            request.ExclusiveStartKey = response.LastEvaluatedKey is { Count: > 0 } last ? last : null;
        } while (request.ExclusiveStartKey is not null);
        return keys;
    }

    public Task BatchDeleteKeysAsync(IReadOnlyList<(string Pk, string Sk)> keys, CancellationToken ct = default) =>
        ExecuteBatchWriteAsync(keys.Distinct().Select(k => new WriteRequest { DeleteRequest = new DeleteRequest { Key = Key(k.Pk, k.Sk) } }).ToList(), ct);

    public Task<List<T>> QueryGsiAsync<T>(DynamoDbConstant.IndexDefinition index, string gsiPk, CancellationToken ct = default) =>
        QueryAllAsync<T>(BuildGsiQuery(index, gsiPk, null, null), ct);

    public Task<List<T>> QueryGsiAsync<T>(DynamoDbConstant.IndexDefinition index, string gsiPk, string gsiSk, SkOperator op, CancellationToken ct = default) =>
        QueryAllAsync<T>(BuildGsiQuery(index, gsiPk, gsiSk, op), ct);

    public async Task<bool> AtomicIncrementInMapAsync(string pk, string sk, string mapAttributeName, string mapKey, int increment = 1, CancellationToken ct = default)
    {
        var key = Key(pk, sk);
        var names = new Dictionary<string, string> { ["#m"] = mapAttributeName, ["#k"] = mapKey };
        try
        {
            await client.UpdateItemAsync(new UpdateItemRequest
            {
                TableName = Table,
                Key = key,
                UpdateExpression = "ADD #m.#k :inc",
                ExpressionAttributeNames = names,
                ExpressionAttributeValues = new Dictionary<string, AttributeValue> { [":inc"] = Number(increment) },
            }, ct);
        }
        catch (AmazonDynamoDBException ex) when (ex.ErrorCode == "ValidationException")
        {
            // Map attribute does not exist yet: create it, then retry once.
            await client.UpdateItemAsync(new UpdateItemRequest
            {
                TableName = Table,
                Key = key,
                UpdateExpression = "SET #m = if_not_exists(#m, :empty)",
                ExpressionAttributeNames = new Dictionary<string, string> { ["#m"] = mapAttributeName },
                ExpressionAttributeValues = new Dictionary<string, AttributeValue> { [":empty"] = new() { M = new Dictionary<string, AttributeValue>() } },
            }, ct);
            await client.UpdateItemAsync(new UpdateItemRequest
            {
                TableName = Table,
                Key = key,
                UpdateExpression = "ADD #m.#k :inc",
                ExpressionAttributeNames = names,
                ExpressionAttributeValues = new Dictionary<string, AttributeValue> { [":inc"] = Number(increment) },
            }, ct);
        }
        return true;
    }

    public async Task<long> IncrementCounterAsync(string pk, string sk, string attributeName, long ttl, CancellationToken ct = default, long amount = 1)
    {
        var response = await client.UpdateItemAsync(new UpdateItemRequest
        {
            TableName = Table,
            Key = Key(pk, sk),
            UpdateExpression = "ADD #a :one SET #ttl = if_not_exists(#ttl, :ttl)",
            ExpressionAttributeNames = new Dictionary<string, string> { ["#a"] = attributeName, ["#ttl"] = "ttl" },
            ExpressionAttributeValues = new Dictionary<string, AttributeValue> { [":one"] = Number(amount), [":ttl"] = Number(ttl) },
            ReturnValues = ReturnValue.UPDATED_NEW,
        }, ct);
        return long.Parse(response.Attributes[attributeName].N, System.Globalization.CultureInfo.InvariantCulture);
    }

    public async Task<IReadOnlyDictionary<string, long>?> AddCountersAsync(string pk, string sk, IReadOnlyDictionary<string, long> increments, CancellationToken ct = default)
    {
        if (increments.Count == 0)
            throw new ArgumentException("At least one counter.", nameof(increments));
        var names = new Dictionary<string, string> { ["#pk"] = PkName };
        var values = new Dictionary<string, AttributeValue>();
        var adds = new List<string>();
        var i = 0;
        foreach (var (name, increment) in increments)
        {
            names[$"#c{i}"] = name;
            values[$":c{i}"] = Number(increment);
            adds.Add($"#c{i} :c{i}");
            i++;
        }
        try
        {
            var response = await client.UpdateItemAsync(new UpdateItemRequest
            {
                TableName = Table,
                Key = Key(pk, sk),
                UpdateExpression = "ADD " + string.Join(", ", adds),
                ConditionExpression = "attribute_exists(#pk)",
                ExpressionAttributeNames = names,
                ExpressionAttributeValues = values,
                ReturnValues = ReturnValue.ALL_NEW,
            }, ct);
            return response.Attributes
                .Where(a => a.Value.N is not null)
                .ToDictionary(a => a.Key, a => long.Parse(a.Value.N, System.Globalization.CultureInfo.InvariantCulture), StringComparer.Ordinal);
        }
        catch (ConditionalCheckFailedException)
        {
            return null;
        }
    }

    public async Task<bool> SaveIfVersionAsync(IVersionedEntity entity, long expectedVersion, CancellationToken ct = default)
    {
        var item = ToItem(entity);
        item[VersionName] = Number(expectedVersion + 1);
        var (condition, names, values) = VersionCondition(expectedVersion);
        try
        {
            await client.PutItemAsync(new PutItemRequest
            {
                TableName = Table,
                Item = item,
                ConditionExpression = condition,
                ExpressionAttributeNames = names,
                ExpressionAttributeValues = values,
            }, ct);
        }
        catch (ConditionalCheckFailedException)
        {
            return false;
        }

        entity.Version = expectedVersion + 1;
        return true;
    }

    public async Task<TransactOutcome> SaveWithReceiptAsync(IEntity receipt, IReadOnlyList<IEntity> items, CancellationToken ct = default)
    {
        var operations = new List<TransactWriteOperation> { TransactWriteOperation.Create(receipt) };
        operations.AddRange(items.Select(i => i is IVersionedEntity v ? TransactWriteOperation.PutVersioned(v) : TransactWriteOperation.Put(i)));

        var result = await TransactWriteAsync(operations, ct);
        return result.Outcome == TransactOutcome.ConditionFailed && result.FailedIndex == 0
            ? TransactOutcome.DuplicateReceipt
            : result.Outcome;
    }

    public async Task<TransactResult> TransactWriteAsync(IReadOnlyList<TransactWriteOperation> operations, CancellationToken ct = default)
    {
        if (operations.Count == 0)
            return TransactResult.Success;
        if (operations.Count > 100)
            throw new ArgumentException("A DynamoDB transaction supports at most 100 operations.", nameof(operations));

        var writes = operations.Select(ToTransactItem).ToList();
        try
        {
            await client.TransactWriteItemsAsync(new TransactWriteItemsRequest { TransactItems = writes }, ct);
        }
        catch (TransactionCanceledException ex)
        {
            var reasons = ex.CancellationReasons ?? [];
            for (var i = 0; i < reasons.Count && i < operations.Count; i++)
            {
                if (reasons[i].Code != "ConditionalCheckFailed")
                    continue;
                return new TransactResult(
                    operations[i].Condition == WriteCondition.VersionEquals ? TransactOutcome.VersionConflict : TransactOutcome.ConditionFailed,
                    i);
            }
            throw;
        }

        foreach (var op in operations)
        {
            if (op is { WritesVersion: true, Entity: IVersionedEntity versioned })
                versioned.Version = op.ExpectedVersion + 1;
        }
        return TransactResult.Success;
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static TransactWriteItem ToTransactItem(TransactWriteOperation op)
    {
        string? condition = null;
        Dictionary<string, string>? names = null;
        Dictionary<string, AttributeValue>? values = null;

        switch (op.Condition)
        {
            case WriteCondition.NotExists:
                condition = "attribute_not_exists(#pk)";
                names = new() { ["#pk"] = PkName };
                break;
            case WriteCondition.Exists:
                condition = "attribute_exists(#pk)";
                names = new() { ["#pk"] = PkName };
                break;
            case WriteCondition.VersionEquals:
                (condition, names, values) = VersionCondition(op.ExpectedVersion);
                break;
        }

        if (op.IsDelete)
        {
            return new TransactWriteItem
            {
                Delete = new Delete
                {
                    TableName = Table,
                    Key = Key(op.Pk, op.Sk),
                    ConditionExpression = condition,
                    ExpressionAttributeNames = names,
                    ExpressionAttributeValues = values,
                },
            };
        }

        var item = ToItem(op.Entity!);
        if (op.WritesVersion)
            item[VersionName] = Number(op.ExpectedVersion + 1);

        return new TransactWriteItem
        {
            Put = new Put
            {
                TableName = Table,
                Item = item,
                ConditionExpression = condition,
                ExpressionAttributeNames = names,
                ExpressionAttributeValues = values,
            },
        };
    }

    private static (string, Dictionary<string, string>, Dictionary<string, AttributeValue>?) VersionCondition(long expectedVersion) =>
        expectedVersion == 0
            ? ("attribute_not_exists(#pk)", new Dictionary<string, string> { ["#pk"] = PkName }, null)
            : ("#v = :expected", new Dictionary<string, string> { ["#v"] = VersionName },
                new Dictionary<string, AttributeValue> { [":expected"] = Number(expectedVersion) });

    private static QueryRequest BuildQuery(string pk, string? sk, SkOperator? op)
    {
        var request = new QueryRequest
        {
            TableName = Table,
            ConsistentRead = true,
            ExpressionAttributeNames = new Dictionary<string, string> { ["#pk"] = PkName },
            ExpressionAttributeValues = new Dictionary<string, AttributeValue> { [":pk"] = new() { S = pk } },
            KeyConditionExpression = "#pk = :pk",
        };
        if (sk is not null && op is { } skOp)
        {
            request.ExpressionAttributeNames["#sk"] = SkName;
            request.ExpressionAttributeValues[":sk"] = new AttributeValue { S = sk };
            request.KeyConditionExpression += " AND " + SkCondition("#sk", ":sk", skOp);
        }
        return request;
    }

    private static QueryRequest BuildGsiQuery(DynamoDbConstant.IndexDefinition index, string gsiPk, string? gsiSk, SkOperator? op)
    {
        var request = new QueryRequest
        {
            TableName = Table,
            IndexName = index.IndexName,
            ExpressionAttributeNames = new Dictionary<string, string> { ["#gpk"] = index.PkAttribute },
            ExpressionAttributeValues = new Dictionary<string, AttributeValue> { [":gpk"] = new() { S = gsiPk } },
            KeyConditionExpression = "#gpk = :gpk",
        };
        if (gsiSk is not null && op is { } skOp && index.SkAttribute is { } skAttribute)
        {
            request.ExpressionAttributeNames["#gsk"] = skAttribute;
            request.ExpressionAttributeValues[":gsk"] = new AttributeValue { S = gsiSk };
            request.KeyConditionExpression += " AND " + SkCondition("#gsk", ":gsk", skOp);
        }
        return request;
    }

    private static string SkCondition(string name, string value, SkOperator op) => op switch
    {
        SkOperator.Equal => $"{name} = {value}",
        SkOperator.BeginsWith => $"begins_with({name}, {value})",
        SkOperator.LessThan => $"{name} < {value}",
        SkOperator.LessThanOrEqual => $"{name} <= {value}",
        SkOperator.GreaterThan => $"{name} > {value}",
        SkOperator.GreaterThanOrEqual => $"{name} >= {value}",
        _ => throw new ArgumentOutOfRangeException(nameof(op)),
    };

    private async Task<List<T>> QueryAllAsync<T>(QueryRequest request, CancellationToken ct)
    {
        var result = new List<T>();
        do
        {
            var response = await client.QueryAsync(request, ct);
            result.AddRange(response.Items.Select(FromItem<T>));
            request.ExclusiveStartKey = response.LastEvaluatedKey is { Count: > 0 } last ? last : null;
        } while (request.ExclusiveStartKey is not null);
        return result;
    }

    private async Task<(List<T>, string?, long)> QueryPageAsync<T>(QueryRequest request, string? pageToken, int? limit, CancellationToken ct)
    {
        request.Limit = Math.Clamp(limit ?? 20, 1, 100);
        request.ScanIndexForward = false; // newest first
        request.ExclusiveStartKey = DecodePageToken(pageToken);
        var response = await client.QueryAsync(request, ct);
        var items = response.Items.Select(FromItem<T>).ToList();
        return (items, EncodePageToken(response.LastEvaluatedKey), response.Count ?? items.Count);
    }

    private async Task ExecuteBatchWriteAsync(List<WriteRequest> requests, CancellationToken ct)
    {
        foreach (var chunk in requests.Chunk(BatchWriteSize))
        {
            var pending = chunk.ToList();
            for (var attempt = 0; pending.Count > 0; attempt++)
            {
                if (attempt > MaxBatchRetries)
                    throw new InvalidOperationException("BatchWriteItem left unprocessed items after retries.");

                var response = await client.BatchWriteItemAsync(new BatchWriteItemRequest
                {
                    RequestItems = new Dictionary<string, List<WriteRequest>> { [Table] = pending },
                }, ct);

                pending = response.UnprocessedItems?.TryGetValue(Table, out var rest) == true ? rest : [];
                if (pending.Count > 0)
                    await BackoffAsync(attempt, ct);
            }
        }
    }

    private static Task BackoffAsync(int attempt, CancellationToken ct) =>
        Task.Delay(TimeSpan.FromMilliseconds(Math.Min(1000, 25 * Math.Pow(2, attempt))), ct);

    private static Dictionary<string, AttributeValue> Key(string pk, string sk) => new()
    {
        [PkName] = new AttributeValue { S = pk },
        [SkName] = new AttributeValue { S = sk },
    };

    private static AttributeValue Number(long value) => new() { N = value.ToString(System.Globalization.CultureInfo.InvariantCulture) };

    internal static Dictionary<string, AttributeValue> ToItem(IEntity entity) =>
        Document.FromJson(EntitySerializer.Serialize(entity)).ToAttributeMap();

    internal static T FromItem<T>(Dictionary<string, AttributeValue> item) =>
        EntitySerializer.Deserialize<T>(Document.FromAttributeMap(item).ToJson());

    private static string? EncodePageToken(Dictionary<string, AttributeValue>? lastKey)
    {
        if (lastKey is not { Count: > 0 })
            return null;
        var plain = lastKey.ToDictionary(kv => kv.Key, kv => kv.Value.S ?? kv.Value.N);
        return Convert.ToBase64String(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(plain)))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    private static Dictionary<string, AttributeValue>? DecodePageToken(string? token)
    {
        if (string.IsNullOrWhiteSpace(token))
            return null;
        try
        {
            var base64 = token.Replace('-', '+').Replace('_', '/');
            base64 = base64.PadRight(base64.Length + (4 - base64.Length % 4) % 4, '=');
            var plain = JsonSerializer.Deserialize<Dictionary<string, string>>(Encoding.UTF8.GetString(Convert.FromBase64String(base64)));
            return plain?.ToDictionary(kv => kv.Key, kv => new AttributeValue { S = kv.Value });
        }
        catch (Exception ex) when (ex is FormatException or JsonException)
        {
            return null;
        }
    }
}
