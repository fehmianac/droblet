namespace Infrastructure.Services.Maintenance;

/// <summary>
/// Thumbnailer of hosts without SkiaSharp (Api, Stylist, TryOn, …). Thumbnails are made only in the item processor,
/// which registers the real one; reaching this means a batch ran in the wrong host.
/// </summary>
public sealed class UnavailableImageThumbnailer : Domain.Services.IImageThumbnailer
{
    public byte[]? ToWebp(byte[] image, int maxSide) =>
        throw new InvalidOperationException("Thumbnails are made by the item processor only (SkiaSharp).");
}
