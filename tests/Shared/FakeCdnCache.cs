using Domain.Services;

namespace Tests.Shared;

/// <summary>Records CDN purges (public item image keys) instead of calling Cloudflare.</summary>
public sealed class FakeCdnCache : ICdnCache
{
    public List<string> Purged { get; } = [];

    public Task PurgeAsync(IReadOnlyList<string> publicKeys, CancellationToken ct)
    {
        lock (Purged)
            Purged.AddRange(publicKeys);
        return Task.CompletedTask;
    }
}

/// <summary>Stands in for SkiaSharp: "renders" a rendition whose bytes name the size (no decoding).</summary>
public sealed class FakeThumbnailer : IImageThumbnailer
{
    public List<int> Sizes { get; } = [];

    public byte[]? ToWebp(byte[] image, int maxSide)
    {
        lock (Sizes)
            Sizes.Add(maxSide);
        return image.Length == 0 ? null : System.Text.Encoding.ASCII.GetBytes($"webp-{maxSide}");
    }
}
