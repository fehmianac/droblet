namespace Domain.Services;

/// <summary>
/// The reference colour of one clean piece picture (a garment alone on a plain ground), read from its pixels — no AI call.
/// The ground is what the picture's border shows; pixels close to it are left out, every other pixel votes for the
/// reference colour nearest to it (CIE Lab distance), and the winner is the most voted colour of the most voted family
/// (a striped pair of jeans is "blue" before it is navy or denim). Ground-coloured pixels inside the garment's outline vote for the ground's colour, so a
/// white shirt on a white ground is white, not the colour of its shadows. Metallic names (silver, gold) are never guessed from pixels.
/// </summary>
public static class DominantColor
{
    /// <summary>Lab distance under which a pixel counts as the ground.</summary>
    private const double GroundDistance = 9;
    /// <summary>Fewer garment pixels than this share = the garment has the ground's colour.</summary>
    private const double MinGarmentShare = 0.04;

    private static readonly (ColorDefinition Color, double L, double A, double B)[] Candidates = ColorCatalog.All
        .Where(c => c.Id is not (ColorCatalog.OtherId or "silver" or "gold"))
        .Select(c =>
        {
            var (l, a, b) = Lab(Convert.ToByte(c.Hex[1..3], 16), Convert.ToByte(c.Hex[3..5], 16), Convert.ToByte(c.Hex[5..7], 16));
            return (c, l, a, b);
        })
        .ToArray();

    /// <summary>The reference colour id nearest to one sRGB colour.</summary>
    public static string Nearest(byte r, byte g, byte b)
    {
        var (l, a, bb) = Lab(r, g, b);
        return Candidates[NearestIndex(l, a, bb)].Color.Id;
    }

    /// <summary>
    /// <paramref name="rgba"/>: width × height pixels, 4 bytes each (R, G, B, A; not premultiplied). Null when there is
    /// nothing to read (no pixels, or every pixel transparent).
    /// </summary>
    public static string? Of(ReadOnlySpan<byte> rgba, int width, int height)
    {
        if (width <= 0 || height <= 0 || rgba.Length < width * height * 4)
            return null;

        // The ground: the mean of the opaque pixels on the picture's border.
        double gl = 0, ga = 0, gb = 0;
        var border = 0;
        var opaque = 0;
        for (var y = 0; y < height; y++)
        {
            for (var x = 0; x < width; x++)
            {
                var i = (y * width + x) * 4;
                if (rgba[i + 3] < 128)
                    continue;
                opaque++;
                if (x != 0 && y != 0 && x != width - 1 && y != height - 1)
                    continue;
                var (l, a, b) = Lab(rgba[i], rgba[i + 1], rgba[i + 2]);
                gl += l; ga += a; gb += b;
                border++;
            }
        }
        if (opaque == 0)
            return null;
        var hasGround = border > 0;
        if (hasGround)
        {
            gl /= border; ga /= border; gb /= border;
        }

        var votes = new int[Candidates.Length];
        var garment = 0;
        // Where the garment is: the first and last non-ground pixel of every row and column.
        var ground = new bool[width * height];
        int[] rowMin = new int[height], rowMax = new int[height], colMin = new int[width], colMax = new int[width];
        Array.Fill(rowMin, int.MaxValue); Array.Fill(rowMax, -1); Array.Fill(colMin, int.MaxValue); Array.Fill(colMax, -1);
        for (var y = 0; y < height; y++)
        {
            for (var x = 0; x < width; x++)
            {
                var i = (y * width + x) * 4;
                if (rgba[i + 3] < 128)
                    continue;
                var (l, a, b) = Lab(rgba[i], rgba[i + 1], rgba[i + 2]);
                if (hasGround && Distance(l, a, b, gl, ga, gb) < GroundDistance)
                {
                    ground[y * width + x] = true;
                    continue;
                }
                votes[NearestIndex(l, a, b)]++;
                garment++;
                rowMin[y] = Math.Min(rowMin[y], x); rowMax[y] = Math.Max(rowMax[y], x);
                colMin[x] = Math.Min(colMin[x], y); colMax[x] = Math.Max(colMax[x], y);
            }
        }
        if (hasGround)
        {
            // Ground-coloured pixels INSIDE the garment (between its edges both across and down) are the garment itself:
            // a white shirt on a white ground shows only its shadows otherwise.
            var groundIndex = NearestIndex(gl, ga, gb);
            for (var y = 0; y < height; y++)
                for (var x = 0; x < width; x++)
                    if (ground[y * width + x] && x > rowMin[y] && x < rowMax[y] && y > colMin[x] && y < colMax[x])
                    {
                        votes[groundIndex]++;
                        garment++;
                    }
        }
        if (garment < opaque * MinGarmentShare)
            return hasGround ? Candidates[NearestIndex(gl, ga, gb)].Color.Id : null;

        var family = Candidates.Select((c, index) => (c.Color.Family, Votes: votes[index]))
            .GroupBy(c => c.Family, StringComparer.Ordinal)
            .MaxBy(g => g.Sum(c => c.Votes))!.Key;
        var best = -1;
        for (var index = 0; index < Candidates.Length; index++)
            if (Candidates[index].Color.Family == family && (best < 0 || votes[index] > votes[best]))
                best = index;
        return Candidates[best].Color.Id;
    }

    private static readonly int White = IndexOf("white"), Grey = IndexOf("grey"), Charcoal = IndexOf("charcoal"), Black = IndexOf("black");

    private static int IndexOf(string id) => Array.FindIndex(Candidates, c => c.Color.Id == id);

    /// <summary>Under this chroma a pixel has no hue to speak of: it is white, grey, charcoal or black by its lightness alone.</summary>
    private const double NeutralChroma = 7;

    private static int NearestIndex(double l, double a, double b)
    {
        // Real white cloth is never #FFFFFF: by distance alone its shaded folds land on the pale tints (icy blue, blush).
        if (Math.Sqrt(a * a + b * b) < NeutralChroma)
            return l >= 78 ? White : l >= 50 ? Grey : l >= 24 ? Charcoal : Black;
        var best = 0;
        var bestDistance = double.MaxValue;
        for (var index = 0; index < Candidates.Length; index++)
        {
            var d = Distance(l, a, b, Candidates[index].L, Candidates[index].A, Candidates[index].B);
            if (d < bestDistance)
            {
                bestDistance = d;
                best = index;
            }
        }
        return best;
    }

    private static double Distance(double l1, double a1, double b1, double l2, double a2, double b2) =>
        Math.Sqrt((l1 - l2) * (l1 - l2) + (a1 - a2) * (a1 - a2) + (b1 - b2) * (b1 - b2));

    /// <summary>sRGB (D65) → CIE L*a*b*.</summary>
    private static (double L, double A, double B) Lab(byte r, byte g, byte b)
    {
        static double Linear(byte channel)
        {
            var c = channel / 255d;
            return c <= 0.04045 ? c / 12.92 : Math.Pow((c + 0.055) / 1.055, 2.4);
        }
        static double F(double t) => t > 0.008856 ? Math.Cbrt(t) : 7.787 * t + 16d / 116;

        double lr = Linear(r), lg = Linear(g), lb = Linear(b);
        var x = F((0.4124 * lr + 0.3576 * lg + 0.1805 * lb) / 0.95047);
        var y = F(0.2126 * lr + 0.7152 * lg + 0.0722 * lb);
        var z = F((0.0193 * lr + 0.1192 * lg + 0.9505 * lb) / 1.08883);
        return (116 * y - 16, 500 * (x - y), 200 * (y - z));
    }
}
