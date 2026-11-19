using Domain.Enum;
using Domain.Services.Ai;

namespace Domain.Services;

/// <summary>
/// Sub-type ids the vision model may suggest (ItemEntity.Subcategory, the "Tür" field of 12c). Each belongs to one category;
/// the form keeps accepting any free id. Jewellery and other small pieces get a wider, upscaled crop (CropMath).
/// </summary>
public static class SubcategoryCatalog
{
    private static readonly (string Id, ItemCategory Category)[] Entries =
    [
        ("t-shirt", ItemCategory.Top), ("shirt", ItemCategory.Top), ("blouse", ItemCategory.Top), ("sweater", ItemCategory.Top),
        ("cardigan", ItemCategory.Top), ("hoodie", ItemCategory.Top), ("tank-top", ItemCategory.Top), ("top", ItemCategory.Top),
        ("jeans", ItemCategory.Bottom), ("trousers", ItemCategory.Bottom), ("skirt", ItemCategory.Bottom), ("shorts", ItemCategory.Bottom),
        ("leggings", ItemCategory.Bottom),
        ("dress", ItemCategory.Dress), ("jumpsuit", ItemCategory.Dress),
        ("blazer", ItemCategory.Outerwear), ("jacket", ItemCategory.Outerwear), ("coat", ItemCategory.Outerwear),
        ("trench-coat", ItemCategory.Outerwear), ("puffer", ItemCategory.Outerwear), ("vest", ItemCategory.Outerwear),
        ("sneakers", ItemCategory.Shoes), ("boots", ItemCategory.Shoes), ("ankle-boots", ItemCategory.Shoes), ("heels", ItemCategory.Shoes),
        ("flats", ItemCategory.Shoes), ("sandals", ItemCategory.Shoes), ("loafers", ItemCategory.Shoes),
        ("handbag", ItemCategory.Bag), ("tote", ItemCategory.Bag), ("shoulder-bag", ItemCategory.Bag), ("crossbody", ItemCategory.Bag),
        ("clutch", ItemCategory.Bag), ("backpack", ItemCategory.Bag),
        ("belt", ItemCategory.Accessory), ("hat", ItemCategory.Accessory), ("cap", ItemCategory.Accessory), ("beanie", ItemCategory.Accessory),
        ("scarf", ItemCategory.Accessory), ("sunglasses", ItemCategory.Accessory), ("glasses", ItemCategory.Accessory),
        ("watch", ItemCategory.Accessory), ("gloves", ItemCategory.Accessory), ("tie", ItemCategory.Accessory),
        ("hair-accessory", ItemCategory.Accessory),
        ("ring", ItemCategory.Accessory), ("necklace", ItemCategory.Accessory), ("earrings", ItemCategory.Accessory),
        ("bracelet", ItemCategory.Accessory), ("brooch", ItemCategory.Accessory), ("anklet", ItemCategory.Accessory),
        ("bikini", ItemCategory.Beachwear), ("swimsuit", ItemCategory.Beachwear), ("kaftan", ItemCategory.Beachwear),
        ("ski-jacket", ItemCategory.Skiwear), ("ski-pants", ItemCategory.Skiwear),
    ];

    private static readonly HashSet<string> JewelleryIds = ["ring", "necklace", "earrings", "bracelet", "brooch", "anklet"];
    private static readonly HashSet<string> SmallIds = [.. JewelleryIds, "watch", "sunglasses", "glasses", "hair-accessory"];

    public static IReadOnlyList<string> Ids { get; } = Entries.Select(e => e.Id).ToList();

    public static ItemCategory? CategoryOf(string? id)
    {
        foreach (var (entryId, category) in Entries)
            if (entryId == id)
                return category;
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
