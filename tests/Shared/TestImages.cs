namespace Tests.Shared;

/// <summary>Hand-built image byte streams for metadata stripping tests.</summary>
public static class TestImages
{
    public static readonly byte[] ExifGps = "Exif\0\0GPS-LAT-41.0082-LON-28.9784"u8.ToArray();

    /// <summary>SOI, APP0 JFIF, APP1 EXIF (with fake GPS), COM, DQT, SOS + scan bytes, EOI.</summary>
    public static byte[] JpegWithExif()
    {
        var bytes = new List<byte> { 0xFF, 0xD8 };
        Segment(bytes, 0xE0, "JFIF\0\u0001\u0001\0\0\u0001\0\u0001\0\0"u8.ToArray());
        Segment(bytes, 0xE1, ExifGps);
        Segment(bytes, 0xFE, "secret comment"u8.ToArray());
        Segment(bytes, 0xDB, new byte[65]);
        Segment(bytes, 0xDA, [0x01, 0x01, 0x00, 0x00, 0x3F, 0x00]);
        bytes.AddRange([0x12, 0x34, 0x56, 0x78]);
        bytes.AddRange([0xFF, 0xD9]);
        return bytes.ToArray();
    }

    public static byte[] Png(bool withText)
    {
        var bytes = new List<byte> { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A };
        Chunk(bytes, "IHDR", new byte[13]);
        if (withText)
        {
            Chunk(bytes, "tEXt", "Comment\0hello"u8.ToArray());
            Chunk(bytes, "eXIf", ExifGps);
        }
        Chunk(bytes, "IDAT", [1, 2, 3, 4]);
        Chunk(bytes, "IEND", []);
        return bytes.ToArray();
    }

    public static bool Contains(byte[] haystack, byte[] needle) =>
        haystack.AsSpan().IndexOf(needle) >= 0;

    private static void Segment(List<byte> bytes, byte marker, byte[] payload)
    {
        var length = payload.Length + 2;
        bytes.AddRange([0xFF, marker, (byte)(length >> 8), (byte)length]);
        bytes.AddRange(payload);
    }

    private static void Chunk(List<byte> bytes, string type, byte[] data)
    {
        bytes.AddRange([(byte)(data.Length >> 24), (byte)(data.Length >> 16), (byte)(data.Length >> 8), (byte)data.Length]);
        bytes.AddRange(System.Text.Encoding.ASCII.GetBytes(type));
        bytes.AddRange(data);
        bytes.AddRange([0, 0, 0, 0]); // CRC not validated by the stripper
    }
}
