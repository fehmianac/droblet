using Domain.Services;

namespace DomainTests.Services;

public class DominantColorTests
{
    private static readonly (byte R, byte G, byte B) White = (255, 255, 255), Cream = (0xEF, 0xE6, 0xD3);

    /// <summary>A size × size picture: <paramref name="ground"/> everywhere, <paramref name="paint"/> decides the garment's pixels (null = ground).</summary>
    private static byte[] Picture(int size, (byte R, byte G, byte B) ground, Func<int, int, (byte R, byte G, byte B)?> paint, byte alpha = 255)
    {
        var rgba = new byte[size * size * 4];
        for (var y = 0; y < size; y++)
            for (var x = 0; x < size; x++)
            {
                var (r, g, b) = paint(x, y) ?? ground;
                var i = (y * size + x) * 4;
                (rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]) = (r, g, b, alpha);
            }
        return rgba;
    }

    private static bool Inside(int x, int y) => x is >= 8 and < 32 && y is >= 8 and < 32;

    [Theory]
    [InlineData(0x1B, 0x2A, 0x49, "navy")]
    [InlineData(0x4F, 0x8A, 0x2E, "olive")]
    [InlineData(0xEB, 0x7A, 0x2B, "orange")]
    [InlineData(0x10, 0x10, 0x12, "black")]
    public void AGarmentOnAPlainGround_IsItsOwnColour_NotTheGrounds(byte r, byte g, byte b, string expected)
    {
        Assert.Equal(expected, DominantColor.Of(Picture(40, White, (x, y) => Inside(x, y) ? (r, g, b) : null), 40, 40));
        Assert.Equal(expected, DominantColor.Of(Picture(40, Cream, (x, y) => Inside(x, y) ? (r, g, b) : null), 40, 40));
    }

    [Fact]
    public void AWhiteGarmentOnAWhiteGround_IsWhite_NotTheColourOfItsShadows()
    {
        // Only the outline is shaded (a cool light grey); the cloth itself is the ground's white.
        static bool Edge(int x, int y) => Inside(x, y) && (x is 8 or 31 || y is 8 or 31);
        var picture = Picture(40, White, (x, y) => Edge(x, y) ? ((byte)0xC8, (byte)0xD2, (byte)0xDC) : null);

        Assert.Equal("white", DominantColor.Of(picture, 40, 40));
    }

    [Fact]
    public void Stripes_TakeTheMostVotedColourOfTheMostVotedFamily()
    {
        // Two blues (navy, denim) share the garment with a narrower red stripe: blue wins as a family, navy within it.
        var picture = Picture(40, White, (x, y) => !Inside(x, y) ? null : (x % 6) switch
        {
            0 or 1 or 2 => ((byte)0x1B, (byte)0x2A, (byte)0x49),
            3 or 4 => ((byte)0x4D, (byte)0x6D, (byte)0x9A),
            _ => ((byte)0xC8, (byte)0x10, (byte)0x2E),
        });

        Assert.Equal("navy", DominantColor.Of(picture, 40, 40));
    }

    [Fact]
    public void ShadedWhiteCloth_IsWhite_AndMetallicNamesAreNeverGuessed()
    {
        Assert.Equal("white", DominantColor.Nearest(0xE4, 0xE8, 0xEC));                         // not "icy-blue"
        Assert.Equal("grey", DominantColor.Nearest(0xA9, 0xAB, 0xAF));                          // a metal's grey, never "silver"
        Assert.NotEqual("gold", DominantColor.Nearest(0xC9, 0xA2, 0x27));
        Assert.True(ColorCatalog.IsKnown(DominantColor.Nearest(0x12, 0x34, 0x56)));
    }

    [Fact]
    public void NothingToRead_IsNull()
    {
        Assert.Null(DominantColor.Of([], 0, 0));
        Assert.Null(DominantColor.Of(new byte[8], 4, 4));                                       // fewer bytes than pixels
        Assert.Null(DominantColor.Of(Picture(8, White, (_, _) => null, alpha: 0), 8, 8));       // fully transparent
    }
}
