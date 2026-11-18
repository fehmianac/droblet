using System.Buffers.Binary;
using System.Text;

namespace Domain.Services;

public enum ImageFormat { Unknown, Jpeg, Png, Heic }

public sealed record StrippedImage(ImageFormat Format, byte[] Data, string ContentType, string Extension);

/// <summary>
/// Validates magic bytes and removes metadata (EXIF location/device, XMP, comments, text chunks)
/// before a body/face photo is made permanent (SECURITY_ENGINEER.md §Cihaz verisi). Pixel data is copied untouched.
/// JPEG keeps APP0 (JFIF) and the APP2 ICC profile (colour accuracy matters for palette analysis).
/// </summary>
public static class ImageMetadataStripper
{
    private static readonly byte[] PngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    private static readonly HashSet<string> PngDroppedChunks = ["eXIf", "tEXt", "zTXt", "iTXt", "tIME"];
    private static readonly byte[] IccMarker = "ICC_PROFILE\0"u8.ToArray();

    public static ImageFormat Detect(ReadOnlySpan<byte> data)
    {
        if (data.Length >= 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF)
            return ImageFormat.Jpeg;
        if (data.Length >= 8 && data[..8].SequenceEqual(PngSignature))
            return ImageFormat.Png;
        if (data.Length >= 12 && Encoding.ASCII.GetString(data.Slice(4, 4)) == "ftyp")
        {
            var brand = Encoding.ASCII.GetString(data.Slice(8, 4));
            if (brand is "heic" or "heix" or "mif1" or "msf1" or "heim" or "heis")
                return ImageFormat.Heic;
        }
        return ImageFormat.Unknown;
    }

    public static string ContentTypeOf(ImageFormat format) => format switch
    {
        ImageFormat.Jpeg => "image/jpeg",
        ImageFormat.Png => "image/png",
        ImageFormat.Heic => "image/heic",
        _ => "application/octet-stream",
    };

    /// <summary>Returns null when the bytes are not a supported, well-formed JPEG or PNG.</summary>
    public static StrippedImage? Strip(byte[] data)
    {
        return Detect(data) switch
        {
            ImageFormat.Jpeg => StripJpeg(data) is { } jpeg ? new StrippedImage(ImageFormat.Jpeg, jpeg, "image/jpeg", "jpg") : null,
            ImageFormat.Png => StripPng(data) is { } png ? new StrippedImage(ImageFormat.Png, png, "image/png", "png") : null,
            _ => null,
        };
    }

    private static byte[]? StripJpeg(byte[] data)
    {
        using var output = new MemoryStream(data.Length);
        output.Write(data, 0, 2); // SOI
        var pos = 2;

        while (pos < data.Length)
        {
            if (data[pos] != 0xFF)
                return null;

            // Fill bytes
            while (pos < data.Length && data[pos] == 0xFF && pos + 1 < data.Length && data[pos + 1] == 0xFF)
                pos++;
            if (pos + 1 >= data.Length)
                return null;

            var marker = data[pos + 1];

            // Standalone markers without length
            if (marker is 0x01 or (>= 0xD0 and <= 0xD7))
            {
                output.Write(data, pos, 2);
                pos += 2;
                continue;
            }

            if (marker == 0xD9) // EOI
            {
                output.Write(data, pos, 2);
                return output.ToArray();
            }

            if (pos + 4 > data.Length)
                return null;
            var length = BinaryPrimitives.ReadUInt16BigEndian(data.AsSpan(pos + 2, 2));
            if (length < 2 || pos + 2 + length > data.Length)
                return null;

            if (marker == 0xDA) // SOS: entropy-coded data follows until EOI — copy the rest verbatim
            {
                output.Write(data, pos, data.Length - pos);
                return output.ToArray();
            }

            var segmentLength = 2 + length;
            if (KeepJpegSegment(marker, data.AsSpan(pos + 4, length - 2)))
                output.Write(data, pos, segmentLength);
            pos += segmentLength;
        }

        return null;
    }

    private static bool KeepJpegSegment(byte marker, ReadOnlySpan<byte> payload)
    {
        if (marker == 0xFE) return false;                          // COM
        if (marker == 0xE0) return true;                           // APP0 JFIF
        if (marker == 0xE2) return payload.StartsWith(IccMarker);  // APP2 ICC only
        if (marker is >= 0xE1 and <= 0xEF) return false;           // APP1 (EXIF/XMP) … APP15
        return true;                                               // DQT, SOFn, DHT, DRI, …
    }

    private static byte[]? StripPng(byte[] data)
    {
        using var output = new MemoryStream(data.Length);
        output.Write(PngSignature);
        var pos = PngSignature.Length;

        while (pos + 12 <= data.Length)
        {
            var length = BinaryPrimitives.ReadUInt32BigEndian(data.AsSpan(pos, 4));
            if (length > int.MaxValue || pos + 12 + (long)length > data.Length)
                return null;

            var type = Encoding.ASCII.GetString(data, pos + 4, 4);
            var chunkLength = 12 + (int)length;
            if (!PngDroppedChunks.Contains(type))
                output.Write(data, pos, chunkLength);
            pos += chunkLength;

            if (type == "IEND")
                return output.ToArray();
        }

        return null;
    }
}

/// <summary>
/// Reads the pixel size from the image header (JPEG SOFn, PNG IHDR) without decoding. Used to enforce the avatar's maximum
/// dimensions — the server stores, it never resamples (no imaging library in the Lambdas; the app resizes before upload).
/// </summary>
public static class ImageDimensions
{
    public static bool TryRead(ReadOnlySpan<byte> data, out int width, out int height)
    {
        width = height = 0;
        switch (ImageMetadataStripper.Detect(data))
        {
            case ImageFormat.Png:
                // Signature (8) + IHDR length (4) + "IHDR" (4) + width (4) + height (4).
                if (data.Length < 24 || data[12] != (byte)'I' || data[13] != (byte)'H' || data[14] != (byte)'D' || data[15] != (byte)'R')
                    return false;
                width = (int)BinaryPrimitives.ReadUInt32BigEndian(data.Slice(16, 4));
                height = (int)BinaryPrimitives.ReadUInt32BigEndian(data.Slice(20, 4));
                return width > 0 && height > 0;
            case ImageFormat.Jpeg:
                var pos = 2;
                while (pos + 4 <= data.Length)
                {
                    if (data[pos] != 0xFF)
                        return false;
                    var marker = data[pos + 1];
                    if (marker == 0xFF) { pos++; continue; } // fill byte
                    if (marker is 0xD8 or 0x01 or (>= 0xD0 and <= 0xD7)) { pos += 2; continue; } // markers without a length
                    if (marker is 0xD9 or 0xDA)
                        return false; // end of image / start of scan before any frame header
                    var length = BinaryPrimitives.ReadUInt16BigEndian(data.Slice(pos + 2, 2));
                    if (length < 2 || pos + 2 + length > data.Length)
                        return false;
                    // SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC): precision (1), height (2), width (2).
                    if (marker is >= 0xC0 and <= 0xCF and not 0xC4 and not 0xC8 and not 0xCC)
                    {
                        if (length < 7)
                            return false;
                        height = BinaryPrimitives.ReadUInt16BigEndian(data.Slice(pos + 5, 2));
                        width = BinaryPrimitives.ReadUInt16BigEndian(data.Slice(pos + 7, 2));
                        return width > 0 && height > 0;
                    }
                    pos += 2 + length;
                }
                return false;
            default:
                return false;
        }
    }
}
