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

    /// <summary>Runs before a listing answers (a test's hook for "something happened meanwhile").</summary>
    public Func<string, Task>? BeforeList { get; set; }

    public async Task<IReadOnlyList<string>> ListKeysAsync(string prefix, CancellationToken ct)
    {
        if (BeforeList is { } hook)
            await hook(prefix);
        return Objects.Keys.Where(k => k.StartsWith(prefix, StringComparison.Ordinal)).Order(StringComparer.Ordinal).ToList();
    }

    public Task<Stream?> OpenReadAsync(string key, CancellationToken ct) =>
        Task.FromResult<Stream?>(Objects.TryGetValue(key, out var o) ? new MemoryStream(o.Data, writable: false) : null);

    public async Task PutFileAsync(string key, string filePath, string contentType, CancellationToken ct) =>
        Objects[key] = (await File.ReadAllBytesAsync(filePath, ct), contentType);

    public Task<string> CreateDownloadUrlAsync(string key, string fileName, TimeSpan ttl, CancellationToken ct) =>
        Task.FromResult($"https://s3.test/bucket/{key}?X-Amz-Expires={(int)ttl.TotalSeconds}&response-content-disposition=attachment");

    public Task DeletePrefixAsync(string prefix, CancellationToken ct)
    {
        DeletedPrefixes.Add(prefix);
        foreach (var key in Objects.Keys.Where(k => k.StartsWith(prefix, StringComparison.Ordinal)).ToList())
            Objects.TryRemove(key, out _);
        return Task.CompletedTask;
    }
}
