using System.Collections.Concurrent;
using Domain.Services;

namespace Tests.Shared;

/// <summary>IPublicImageReader over a dictionary (URL → bytes): no network in tests. An unknown URL reads as missing.</summary>
public sealed class FakePublicImageReader : IPublicImageReader
{
    public ConcurrentDictionary<string, byte[]> Images { get; } = new(StringComparer.Ordinal);
    public ConcurrentQueue<string> Reads { get; } = new();

    public Task<byte[]?> ReadAsync(string url, long maxBytes, CancellationToken ct)
    {
        Reads.Enqueue(url);
        return Task.FromResult(Images.TryGetValue(url, out var data) && data.Length <= maxBytes ? data : null);
    }
}
