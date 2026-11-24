using Domain.Enum;
using Domain.Services.Ai;

namespace Domain.Services;

/// <summary>One sub-type id: its category, who the pickers show it to (unisex = everyone) and its names.</summary>
public sealed record SubcategoryEntry(string Id, ItemCategory Category, CatalogSegment Segment, TaxonomyLabel Name);

/// <summary>
/// Sub-type ids the vision model may suggest (ItemEntity.Subcategory, the "Tür" field of 12c). Each belongs to one category;
/// the form keeps accepting any free id. Jewellery and other small pieces get a wider, upscaled crop (CropMath).
/// The list the app offers is per segment (<see cref="ForSegment"/>): women-only ids (dress, skirt, heels …), men-only ids
/// (suit jacket, chinos are unisex, derbies, bow tie …) and unisex ids. Detection and item writes accept every id: a man may
/// own a dress and a woman derbies — the segment only filters the pickers.
/// </summary>
public static class SubcategoryCatalog
{
    private const CatalogSegment W = CatalogSegment.Women;
    private const CatalogSegment M = CatalogSegment.Men;
    private const CatalogSegment U = CatalogSegment.Unisex;

    private static SubcategoryEntry E(string id, ItemCategory category, CatalogSegment segment, string tr, string en) => new(id, category, segment, new TaxonomyLabel(tr, en));

    private static readonly SubcategoryEntry[] Entries =
    [
        E("t-shirt", ItemCategory.Top, U, "Tişört", "T-shirt"), E("shirt", ItemCategory.Top, U, "Gömlek", "Shirt"),
        E("blouse", ItemCategory.Top, W, "Bluz", "Blouse"), E("sweater", ItemCategory.Top, U, "Kazak", "Sweater"),
        E("cardigan", ItemCategory.Top, U, "Hırka", "Cardigan"), E("hoodie", ItemCategory.Top, U, "Kapüşonlu sweatshirt", "Hoodie"),
        E("tank-top", ItemCategory.Top, U, "Atlet", "Tank top"), E("top", ItemCategory.Top, W, "Üst", "Top"),
        E("jeans", ItemCategory.Bottom, U, "Jean", "Jeans"), E("trousers", ItemCategory.Bottom, U, "Pantolon", "Trousers"),
        E("skirt", ItemCategory.Bottom, W, "Etek", "Skirt"), E("shorts", ItemCategory.Bottom, U, "Şort", "Shorts"),
        E("leggings", ItemCategory.Bottom, W, "Tayt", "Leggings"),
        E("dress", ItemCategory.Dress, W, "Elbise", "Dress"), E("jumpsuit", ItemCategory.Dress, W, "Tulum", "Jumpsuit"),
        E("blazer", ItemCategory.Outerwear, U, "Blazer", "Blazer"), E("jacket", ItemCategory.Outerwear, U, "Ceket", "Jacket"),
        E("coat", ItemCategory.Outerwear, U, "Kaban", "Coat"), E("trench-coat", ItemCategory.Outerwear, U, "Trençkot", "Trench coat"),
        E("puffer", ItemCategory.Outerwear, U, "Şişme mont", "Puffer"), E("vest", ItemCategory.Outerwear, U, "Yelek", "Vest"),
        E("sneakers", ItemCategory.Shoes, U, "Spor ayakkabı", "Sneakers"), E("boots", ItemCategory.Shoes, U, "Çizme", "Boots"),
        E("ankle-boots", ItemCategory.Shoes, U, "Bot", "Ankle boots"), E("heels", ItemCategory.Shoes, W, "Topuklu ayakkabı", "Heels"),
        E("flats", ItemCategory.Shoes, W, "Babet", "Flats"), E("sandals", ItemCategory.Shoes, U, "Sandalet", "Sandals"),
        E("loafers", ItemCategory.Shoes, U, "Loafer", "Loafers"),
        E("handbag", ItemCategory.Bag, W, "El çantası", "Handbag"), E("tote", ItemCategory.Bag, U, "Tote çanta", "Tote"),
        E("shoulder-bag", ItemCategory.Bag, W, "Omuz çantası", "Shoulder bag"), E("crossbody", ItemCategory.Bag, U, "Çapraz çanta", "Crossbody bag"),
        E("clutch", ItemCategory.Bag, W, "Clutch", "Clutch"), E("backpack", ItemCategory.Bag, U, "Sırt çantası", "Backpack"),
        E("belt", ItemCategory.Accessory, U, "Kemer", "Belt"), E("hat", ItemCategory.Accessory, U, "Şapka", "Hat"),
        E("cap", ItemCategory.Accessory, U, "Kep", "Cap"), E("beanie", ItemCategory.Accessory, U, "Bere", "Beanie"),
        E("socks", ItemCategory.Socks, U, "Çorap", "Socks"), E("tights", ItemCategory.Socks, W, "Külotlu çorap", "Tights"),
        E("scarf", ItemCategory.Accessory, U, "Şal / eşarp", "Scarf"), E("sunglasses", ItemCategory.Accessory, U, "Güneş gözlüğü", "Sunglasses"),
        E("glasses", ItemCategory.Accessory, U, "Gözlük", "Glasses"), E("watch", ItemCategory.Accessory, U, "Saat", "Watch"),
        E("gloves", ItemCategory.Accessory, U, "Eldiven", "Gloves"), E("tie", ItemCategory.Accessory, U, "Kravat", "Tie"),
        E("hair-accessory", ItemCategory.Accessory, W, "Saç aksesuarı", "Hair accessory"),
        E("ring", ItemCategory.Accessory, U, "Yüzük", "Ring"), E("necklace", ItemCategory.Accessory, U, "Kolye", "Necklace"),
        E("earrings", ItemCategory.Accessory, W, "Küpe", "Earrings"), E("bracelet", ItemCategory.Accessory, U, "Bileklik", "Bracelet"),
        E("brooch", ItemCategory.Accessory, W, "Broş", "Brooch"), E("anklet", ItemCategory.Accessory, W, "Halhal", "Anklet"),
        E("bikini", ItemCategory.Beachwear, W, "Bikini", "Bikini"), E("swimsuit", ItemCategory.Beachwear, W, "Mayo", "Swimsuit"),
        E("kaftan", ItemCategory.Beachwear, W, "Kaftan", "Kaftan"),
        E("ski-jacket", ItemCategory.Skiwear, U, "Kayak montu", "Ski jacket"), E("ski-pants", ItemCategory.Skiwear, U, "Kayak pantolonu", "Ski pants"),

        // Men's launch (appended: ids are never renamed or removed).
        E("polo", ItemCategory.Top, U, "Polo yaka tişört", "Polo shirt"), E("oxford-shirt", ItemCategory.Top, M, "Oxford gömlek", "Oxford shirt"),
        E("dress-shirt", ItemCategory.Top, M, "Klasik gömlek", "Dress shirt"), E("henley", ItemCategory.Top, M, "Henley tişört", "Henley"),
        E("sweatshirt", ItemCategory.Top, U, "Sweatshirt", "Sweatshirt"), E("turtleneck", ItemCategory.Top, U, "Balıkçı yaka kazak", "Turtleneck"),
        E("quarter-zip", ItemCategory.Top, M, "Yarım fermuarlı kazak", "Quarter-zip sweater"),
        E("chinos", ItemCategory.Bottom, U, "Chino pantolon", "Chinos"), E("suit-trousers", ItemCategory.Bottom, M, "Takım pantolonu", "Suit trousers"),
        E("cargo-trousers", ItemCategory.Bottom, U, "Kargo pantolon", "Cargo trousers"), E("joggers", ItemCategory.Bottom, U, "Jogger eşofman altı", "Joggers"),
        E("suit-jacket", ItemCategory.Outerwear, M, "Takım ceketi", "Suit jacket"), E("overshirt", ItemCategory.Outerwear, U, "Gömlek ceket", "Overshirt"),
        E("bomber", ItemCategory.Outerwear, U, "Bomber ceket", "Bomber jacket"), E("leather-jacket", ItemCategory.Outerwear, U, "Deri ceket", "Leather jacket"),
        E("parka", ItemCategory.Outerwear, U, "Parka", "Parka"), E("waistcoat", ItemCategory.Outerwear, M, "Takım yeleği", "Waistcoat"),
        E("derbies", ItemCategory.Shoes, M, "Derby ayakkabı", "Derby shoes"), E("oxford-shoes", ItemCategory.Shoes, M, "Oxford ayakkabı", "Oxford shoes"),
        E("chelsea-boots", ItemCategory.Shoes, U, "Chelsea bot", "Chelsea boots"), E("boat-shoes", ItemCategory.Shoes, M, "Makosen", "Boat shoes"),
        E("briefcase", ItemCategory.Bag, U, "Evrak çantası", "Briefcase"), E("messenger-bag", ItemCategory.Bag, U, "Postacı çanta", "Messenger bag"),
        E("bow-tie", ItemCategory.Accessory, M, "Papyon", "Bow tie"), E("pocket-square", ItemCategory.Accessory, M, "Cep mendili", "Pocket square"),
        E("cufflinks", ItemCategory.Accessory, M, "Kol düğmesi", "Cufflinks"), E("suspenders", ItemCategory.Accessory, M, "Pantolon askısı", "Suspenders"),
        E("swim-shorts", ItemCategory.Beachwear, M, "Deniz şortu", "Swim shorts"),
    ];

    private static readonly HashSet<string> JewelleryIds = ["ring", "necklace", "earrings", "bracelet", "brooch", "anklet", "cufflinks"];
    private static readonly HashSet<string> SmallIds = [.. JewelleryIds, "watch", "sunglasses", "glasses", "hair-accessory", "bow-tie", "pocket-square"];

    public static IReadOnlyList<string> Ids { get; } = Entries.Select(e => e.Id).ToList();

    public static IReadOnlyList<SubcategoryEntry> All { get; } = Entries;

    /// <summary>The sub-types the app offers a segment, grouped by category in catalog order (women-only ids are left out for men and vice versa).</summary>
    public static IReadOnlyList<SubcategoryEntry> ForSegment(Segment segment) =>
        Entries.Where(e => SegmentPolicy.Shows(e.Segment, segment)).OrderBy(e => e.Category).ToList();

    public static ItemCategory? CategoryOf(string? id)
    {
        foreach (var entry in Entries)
            if (entry.Id == id)
                return entry.Category;
        return null;
    }

    public static bool IsJewellery(string? id) => id is not null && JewelleryIds.Contains(id);

    /// <summary>Pieces that are small in any photo (jewellery, watches, glasses): wider padding and an upscaled crop.</summary>
    public static bool IsSmall(string? id) => id is not null && SmallIds.Contains(id);

    /// <summary>The suggested id when it exists and belongs to the suggested category; null otherwise (the form stays empty).</summary>
    public static string? Normalize(string? id, ItemCategory? category) =>
        id is not null && CategoryOf(id) is { } owner && (category is null || owner == category) ? id : null;
}

/// <summary>
/// Rules for the multi-item detection answer (one vision call per photo). Drops what is not a wearable piece (people,
/// body parts, faces are never returned as pieces), boxes that are invalid or too small to be useful, duplicates of a
/// piece already kept, and caps the list; the rest is numbered in reading order (top to bottom, then left to right).
/// </summary>
public static class ItemDetectionGuard
{
    /// <summary>Shortest box side (fraction of the photo). A ring on a full flat-lay is ~3 %; below 2 % nothing usable is left.</summary>
    public const double MinSide = 0.02;
    public const double MinArea = 0.0008;
    /// <summary>Below this the model itself does not believe the box is a piece.</summary>
    public const double MinConfidence = 0.2;
    /// <summary>Two boxes overlapping this much (IoU) are the same piece, whatever the category.</summary>
    public const double DuplicateIou = 0.6;
    /// <summary>Same category: a lower overlap, or one box lying almost wholly inside the other, is the same piece.</summary>
    public const double SameCategoryIou = 0.35;
    public const double SameCategoryContainment = 0.85;

    public static IReadOnlyList<DetectedItem> Filter(IReadOnlyList<DetectedItem> items, int maxItems)
    {
        var candidates = items
            .Where(i => i.IsWearable && i.Garment.IsGarment && i.Confidence >= MinConfidence)
            .Select(i => Clamp(i.Box) is { } box ? i with { Box = box } : null)
            .Where(i => i is not null && i.Box.Width >= MinSide && i.Box.Height >= MinSide && i.Box.Area >= MinArea)
            .Select(i => i!)
            .OrderByDescending(i => i.Confidence)
            .ToList();

        var kept = new List<DetectedItem>();
        foreach (var item in candidates)
        {
            if (kept.Count >= Math.Max(1, maxItems))
                break;
            if (!kept.Any(k => IsDuplicate(k, item)))
                kept.Add(item);
        }

        return kept.OrderBy(i => i.Box.Y).ThenBy(i => i.Box.X).ToList();
    }

    public static bool IsDuplicate(DetectedItem a, DetectedItem b)
    {
        var iou = Iou(a.Box, b.Box);
        if (iou >= DuplicateIou)
            return true;
        if (a.Garment.Category != b.Garment.Category)
            return false;
        var smaller = Math.Min(a.Box.Area, b.Box.Area);
        return iou >= SameCategoryIou || smaller > 0 && Intersection(a.Box, b.Box) / smaller >= SameCategoryContainment
            && (a.Subcategory == b.Subcategory || a.Subcategory is null || b.Subcategory is null);
    }

    /// <summary>The draft suggestion of one detected piece: the vision guard's fields, flagged for review when the box itself is doubtful.</summary>
    public static GarmentDraftFields Fields(DetectedItem item, double confidenceThreshold)
    {
        var fields = GarmentVisionGuard.Apply(item.Garment with { GarmentCount = 1 }, confidenceThreshold);
        if (item.Confidence >= confidenceThreshold || fields.NeedsReview)
            return fields;
        var flagged = fields.FlaggedFields.Contains(GarmentVisionGuard.FieldCategory)
            ? fields.FlaggedFields
            : [GarmentVisionGuard.FieldCategory, .. fields.FlaggedFields];
        return fields with { FlaggedFields = flagged, NeedsReview = true };
    }

    public static string? Subcategory(DetectedItem item, ItemCategory? category) => SubcategoryCatalog.Normalize(item.Subcategory, category);

    public static double Iou(BoundingBox a, BoundingBox b)
    {
        var inter = Intersection(a, b);
        var union = a.Area + b.Area - inter;
        return union <= 0 ? 0 : inter / union;
    }

    public static double Intersection(BoundingBox a, BoundingBox b)
    {
        var w = Math.Min(a.Right, b.Right) - Math.Max(a.X, b.X);
        var h = Math.Min(a.Bottom, b.Bottom) - Math.Max(a.Y, b.Y);
        return w <= 0 || h <= 0 ? 0 : w * h;
    }

    /// <summary>The box clipped to the photo; null when it is not a box at all (NaN, negative size, wholly outside).</summary>
    public static BoundingBox? Clamp(BoundingBox box)
    {
        if (!double.IsFinite(box.X) || !double.IsFinite(box.Y) || !double.IsFinite(box.Width) || !double.IsFinite(box.Height) || box.Width <= 0 || box.Height <= 0)
            return null;
        var left = Math.Clamp(box.X, 0, 1);
        var top = Math.Clamp(box.Y, 0, 1);
        var right = Math.Clamp(box.Right, 0, 1);
        var bottom = Math.Clamp(box.Bottom, 0, 1);
        return right <= left || bottom <= top ? null : new BoundingBox(left, top, right - left, bottom - top);
    }
}

/// <summary>
/// Box → pixel crop of the EXIF-stripped original. The box is padded (a little for garments, a lot for jewellery and other
/// small pieces so the image model sees the whole piece and some context), clipped to the photo, and the result is scaled so
/// its long side is at least MinOutput (small pieces are upscaled to a usable size) and at most MaxOutput.
/// </summary>
public static class CropMath
{
    public const double Padding = 0.08;
    public const double SmallPadding = 0.35;
    public const int MinPaddingPx = 8;
    public const int SmallMinPaddingPx = 24;
    public const int MinCropSidePx = 48;
    public const int MinOutput = 512;
    public const int SmallMinOutput = 1024;
    public const int MaxOutput = 1536;
    public const double MaxUpscale = 4;
    /// <summary>A small box: its longer side is under this fraction of the photo.</summary>
    public const double SmallBoxSide = 0.15;
    /// <summary>One piece filling this much of the photo is cleaned from the whole photo (cropping would only lose context).</summary>
    public const double WholePhotoArea = 0.6;

    public static bool IsSmall(BoundingBox box, string? subcategory) =>
        SubcategoryCatalog.IsSmall(subcategory) || Math.Max(box.Width, box.Height) < SmallBoxSide;

    public static bool UseWholePhoto(BoundingBox box) => box.Area >= WholePhotoArea;

    public static CropPlan Plan(BoundingBox box, PixelSize image, bool small)
    {
        var clamped = ItemDetectionGuard.Clamp(box) ?? new BoundingBox(0, 0, 1, 1);
        double left = clamped.X * image.Width, top = clamped.Y * image.Height;
        double right = clamped.Right * image.Width, bottom = clamped.Bottom * image.Height;

        var longSide = Math.Max(right - left, bottom - top);
        var pad = Math.Max(small ? SmallMinPaddingPx : MinPaddingPx, longSide * (small ? SmallPadding : Padding));
        left -= pad;
        top -= pad;
        right += pad;
        bottom += pad;

        // A tiny box still gives the model something to look at.
        var minSide = Math.Min(MinCropSidePx, Math.Min(image.Width, image.Height));
        Grow(ref left, ref right, minSide);
        Grow(ref top, ref bottom, minSide);

        // Rounded first: 0.2 × 1500 is 300.00000000000006 in floating point, which must not grow the crop by a pixel.
        var x = (int)Math.Floor(Math.Round(Math.Clamp(left, 0, image.Width), 3));
        var y = (int)Math.Floor(Math.Round(Math.Clamp(top, 0, image.Height), 3));
        var w = Math.Max(1, (int)Math.Ceiling(Math.Round(Math.Clamp(right, 0, image.Width), 3)) - x);
        var h = Math.Max(1, (int)Math.Ceiling(Math.Round(Math.Clamp(bottom, 0, image.Height), 3)) - y);

        var cropLong = Math.Max(w, h);
        var target = small ? SmallMinOutput : MinOutput;
        var scale = cropLong < target ? Math.Min(MaxUpscale, (double)target / cropLong)
            : cropLong > MaxOutput ? (double)MaxOutput / cropLong
            : 1;
        return new CropPlan(x, y, w, h, Math.Max(1, (int)Math.Round(w * scale)), Math.Max(1, (int)Math.Round(h * scale)));
    }

    private static void Grow(ref double from, ref double to, double min)
    {
        var size = to - from;
        if (size >= min)
            return;
        var extra = (min - size) / 2;
        from -= extra;
        to += extra;
    }
}
