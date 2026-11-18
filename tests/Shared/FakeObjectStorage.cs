using System.Collections.Concurrent;
using Domain.Services;

namespace Tests.Shared;

public sealed class FakeObjectStorage : IObjectStorage
{
    public ConcurrentDictionary<string, (byte[] Data, string ContentType)> Objects { get; } = new();
    public List<string> DeletedPrefixes { get; } = [];

    public Task<PresignedUpload> CreateUploadAsync(string key, string contentType, long maxBytes, TimeSpan ttl, CancellationToken ct) =>
        Task.FromResult(new PresignedUpload("https://s3.test/bucket", new Dictionary<string, string> { ["key"] = key, ["Content-Type"] = contentType }, DateTime.UtcNow.Add(ttl)));

    public Task<string> CreateReadUrlAsync(string key, TimeSpan ttl, CancellationToken ct) =>
        Task.FromResult($"https://s3.test/bucket/{key}?X-Amz-Expires={(int)ttl.TotalSeconds}");

    public Task<StoredObjectInfo?> HeadAsync(string key, CancellationToken ct) =>
        Task.FromResult(Objects.TryGetValue(key, out var o) ? new StoredObjectInfo(o.Data.Length, o.ContentType) : null);

    public Task<byte[]?> ReadAsync(string key, long maxBytes, CancellationToken ct) =>
        Task.FromResult(Objects.TryGetValue(key, out var o) && o.Data.Length <= maxBytes ? o.Data : null);

    public Task PutAsync(string key, byte[] data, string contentType, CancellationToken ct)
    {
        Objects[key] = (data, contentType);
        return Task.CompletedTask;
    }

    public Task DeleteAsync(string key, CancellationToken ct)
    {
        Objects.TryRemove(key, out _);
        return Task.CompletedTask;
    }

    public Task DeletePrefixAsync(string prefix, CancellationToken ct)
    {
        DeletedPrefixes.Add(prefix);
        foreach (var key in Objects.Keys.Where(k => k.StartsWith(prefix, StringComparison.Ordinal)).ToList())
            Objects.TryRemove(key, out _);
        return Task.CompletedTask;
    }
}
