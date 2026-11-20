using System.Text.Json;
using System.Text.Json.Nodes;
using Domain.Enum;
using Domain.Services.Ai;

namespace Domain.Services.Styling;

/// <summary>
/// Strict JSON schemas for every structured model call. Generated from the fixed vocabularies (enums, ColorCatalog,
/// FabricCatalog, SeasonTypeCatalog) so prompt, schema and guard can never drift apart. Strict mode rules:
/// every property is required, additionalProperties is false, "optional" means nullable.
/// </summary>
public static class AiSchemas
{
    public const string Outfit = "outfit";
    public const string WeekPlan = "week_plan";
    public const string Packing = "packing";
    public const string GarmentDraft = "garment_draft";
    public const string ItemDetection = "item_detection";
    public const string PaletteSeason = "palette_season";
    public const string PhotoCheck = "photo_check";
    /// <summary>Photo try-on: the check of the outfit photo (someone wearing the outfit), before it goes to the image model.</summary>
    public const string ReferenceCheck = "reference_check";
    public const string ItemMatch = "item_match";

    public static string NameFor(JobKind kind) => kind switch
    {
        JobKind.StylistOutfit => Outfit,
        JobKind.StylistWeek => WeekPlan,
        JobKind.StylistPack => Packing,
        _ => throw new ArgumentOutOfRangeException(nameof(kind), kind, "No stylist schema for this job kind."),
    };

    public static JsonObject For(JobKind kind) => kind switch
    {
        JobKind.StylistOutfit => OutfitSchema(),
        JobKind.StylistWeek => WeekSchema(),
        JobKind.StylistPack => PackSchema(),
        _ => throw new ArgumentOutOfRangeException(nameof(kind), kind, "No stylist schema for this job kind."),
    };

    public static JsonObject OutfitSchema() => Object(
        ("suggestions", Array(Object(
            ("title", NullableString()),
            ("explanation", NullableString()),
            ("slots", Slots()),
            ("missing", Array(Object(
                ("slot", Enum(Names<OutfitSlot>())),
                ("category", NullableEnum(Names<ItemCategory>())),
                ("productId", NullableString()))))))),
        ("refusal", NullableEnum([StylistRefusals.OutOfScope, StylistRefusals.InsufficientWardrobe])));

    public static JsonObject WeekSchema() => Object(
        ("days", Array(Day())),
        ("refusal", NullableEnum([StylistRefusals.OutOfScope, StylistRefusals.InsufficientWardrobe])));

    public static JsonObject PackSchema() => Object(
        ("itemIds", Array(String())),
        ("days", Array(Day())),
        ("refusal", NullableEnum([StylistRefusals.OutOfScope, StylistRefusals.InsufficientWardrobe])));

    public static JsonObject GarmentSchema() => Object(
        ("isGarment", Boolean()),
        ("garmentCount", Integer()),
        ("garment", Garment()));

    /// <summary>
    /// Every wearable piece in one photo. box = edges as fractions of the photo (0 = left / top, 1 = right / bottom);
    /// itemConfidence = how sure the model is that the box is one real, separate piece; isWearable = false for anything else.
    /// </summary>
    public static JsonObject ItemDetectionSchema() => Object(
        ("items", Array(Object(
            ("name", NullableString()),
            ("category", NullableEnum(Names<ItemCategoryHint>())),
            ("subcategory", NullableEnum(SubcategoryCatalog.Ids)),
            ("colorIds", Array(Enum(ColorCatalog.Ids))),
            ("fabric", NullableEnum(FabricCatalog.Ids)),
            ("seasons", Array(Enum(Names<Season>()))),
            ("isWearable", Boolean()),
            ("itemConfidence", Number()),
            ("box", Object(("left", Number()), ("top", Number()), ("right", Number()), ("bottom", Number()))),
            ("confidence", FieldConfidence())))));

    /// <summary>Outfit import match: the 1-based number of the candidate that is the same piece, or null.</summary>
    public static JsonObject ItemMatchSchema() => Object(
        ("match", NullableInteger()),
        ("confidence", Number()));

    public static JsonObject PaletteSchema() => Object(
        ("facesDetected", Integer()),
        ("seasonTypeId", NullableEnum(SeasonTypeCatalog.Ids)),
        ("confidence", Number()),
        ("refusal", NullableEnum([StylistRefusals.PhotoUnsuitable])));

    public static JsonObject PhotoCheckSchema() => Object(
        ("people", Integer()),
        ("fullBody", Boolean()),
        ("faceVisible", Boolean()),
        ("tooDark", Boolean()),
        ("blurry", Boolean()),
        ("appearsMinor", Boolean()));

    public static JsonObject ReferenceCheckSchema() => Object(
        ("people", Integer()),
        ("clothingVisible", Boolean()),
        ("appearsMinor", Boolean()));

    private static JsonObject Garment() => Object(
        ("name", NullableString()),
        ("category", NullableEnum(Names<ItemCategoryHint>())),
        ("colorIds", Array(Enum(ColorCatalog.Ids))),
        ("fabric", NullableEnum(FabricCatalog.Ids)),
        ("seasons", Array(Enum(Names<Season>()))),
        ("confidence", FieldConfidence()));

    private static JsonObject FieldConfidence() => Object(
        (GarmentVisionGuard.FieldCategory, Number()),
        (GarmentVisionGuard.FieldColors, Number()),
        (GarmentVisionGuard.FieldFabric, Number()),
        (GarmentVisionGuard.FieldSeasons, Number()));

    private static JsonObject Day() => Object(
        ("date", String()),
        ("title", NullableString()),
        ("explanation", NullableString()),
        ("occasion", NullableEnum(Names<Occasion>())),
        ("slots", Slots()));

    private static JsonObject Slots() => Object(
        ("top", NullableString()),
        ("bottom", NullableString()),
        ("outerwear", NullableString()),
        ("shoes", NullableString()),
        ("bagAccessory", NullableString()));

    /// <summary>camelCase enum names, the spelling used on the wire everywhere.</summary>
    public static IReadOnlyList<string> Names<T>() where T : struct, System.Enum =>
        System.Enum.GetNames<T>().Select(JsonNamingPolicy.CamelCase.ConvertName).ToList();

    private static JsonObject Object(params (string Name, JsonNode Schema)[] properties)
    {
        var props = new JsonObject();
        var required = new JsonArray();
        foreach (var (name, schema) in properties)
        {
            props[name] = schema;
            required.Add(name);
        }

        return new JsonObject
        {
            ["type"] = "object",
            ["properties"] = props,
            ["required"] = required,
            ["additionalProperties"] = false,
        };
    }

    private static JsonObject Array(JsonNode items) => new() { ["type"] = "array", ["items"] = items };
    private static JsonObject String() => new() { ["type"] = "string" };
    private static JsonObject Boolean() => new() { ["type"] = "boolean" };
    private static JsonObject Integer() => new() { ["type"] = "integer" };
    private static JsonObject Number() => new() { ["type"] = "number" };
    private static JsonObject NullableString() => new() { ["type"] = new JsonArray("string", "null") };

    private static JsonObject NullableInteger() => new() { ["type"] = new JsonArray("integer", "null") };

    private static JsonObject Enum(IEnumerable<string> values) =>
        new() { ["type"] = "string", ["enum"] = new JsonArray(values.Select(v => (JsonNode)v).ToArray()) };

    private static JsonObject NullableEnum(IEnumerable<string> values) =>
        new()
        {
            ["type"] = new JsonArray("string", "null"),
            ["enum"] = new JsonArray(values.Select(v => (JsonNode?)v).Append(null).ToArray()),
        };
}
