using System.Text.Json;
using System.Text.Json.Nodes;
using Domain.Enum;
using Domain.Services.Ai;
using Domain.Services.Styling;

namespace Infrastructure.Ai;

/// <summary>Where a prompt goes in the request.</summary>
public enum PromptKind
{
    /// <summary>The system message of a chat call (static: the cacheable prefix of every request).</summary>
    Instructions,
    /// <summary>A text appended to several system messages (the language suffix).</summary>
    Fragment,
    /// <summary>The text part of the user message (before the images).</summary>
    Request,
    /// <summary>The prompt of an image edit.</summary>
    Image,
    /// <summary>The strict JSON schema of the answer — view only (see <see cref="PromptCatalog"/>).</summary>
    Schema,
}

/// <summary>How a draft is tried ("Dene"): the chat capability it runs through, or none (image prompts: preview only).</summary>
public enum PromptTrialTarget { None, StylistOutfit, StylistWeek, StylistPack, ItemDescribe, ItemDetect, ItemMatch, Palette, PhotoCheckBody, PhotoCheckFace, PhotoCheckReference }

public sealed record PromptVariable(string Name, bool Required, string Description, string Sample);

/// <param name="Operation">The AI operation (log / metric name, Ai:ReasoningEffort / Ai:FastTextOperations key) the prompt is sent with.</param>
/// <param name="Default">The shipped template (code default). Rendered with the variables it is byte-identical to what the code sends.</param>
/// <param name="ImagesRequired">Images a dry-run needs (0 = text only); ItemMatch: the crop first, then at least one candidate.</param>
public sealed record PromptDefinition(
    string Key,
    string Feature,
    string Operation,
    PromptKind Kind,
    string Description,
    IReadOnlyList<PromptVariable> Variables,
    Func<string> Default,
    int MaxLength,
    PromptTrialTarget Trial,
    int ImagesRequired = 0)
{
    public bool Editable => Kind != PromptKind.Schema;
    public string Position => Kind switch
    {
        PromptKind.Instructions => "system",
        PromptKind.Fragment => "system_suffix",
        PromptKind.Request => "user",
        PromptKind.Image => "image_prompt",
        _ => "response_format",
    };
}

/// <summary>
/// Every prompt the AI services send, by stable key. The code defaults stay in <see cref="OpenAiPrompts"/> and
/// <see cref="AiSchemas"/> (texts unchanged); this catalog only names them, lists their variables and limits.
/// Response schemas are listed view-only: they are generated from the fixed vocabularies (colours, fabrics,
/// categories, season types) and must match the DTO the code deserializes and the guards check, so a hand edit could
/// only break parsing or drift from the catalogs — behaviour is tuned through the instructions instead.
/// </summary>
public static class PromptCatalog
{
    public const int InstructionsMaxLength = 12000;
    public const int RequestMaxLength = 2000;
    public const int ImageMaxLength = 4000;

    public const string Language = "common.language";
    public const string CompactCandidates = "stylist.compact_candidates";

    public static string StylistInstructions(JobKind kind) => kind switch
    {
        JobKind.StylistOutfit => "stylist.outfit.instructions",
        JobKind.StylistWeek => "stylist.week.instructions",
        JobKind.StylistPack => "stylist.pack.instructions",
        _ => throw new ArgumentOutOfRangeException(nameof(kind), kind, "No stylist prompt for this job kind."),
    };

    public const string DescribeInstructions = "item.describe.instructions";
    public const string DescribeRequest = "item.describe.request";
    public const string DetectInstructions = "item.detect.instructions";
    public const string DetectRequest = "item.detect.request";
    public const string MatchInstructions = "item.match.instructions";
    public const string MatchRequest = "item.match.request";
    public const string PaletteInstructions = "palette.instructions";
    public const string PaletteRequest = "palette.request";
    public static string PhotoCheckInstructions(PhotoKind kind) => kind == PhotoKind.Body ? "photo_check.body.instructions" : "photo_check.face.instructions";
    public const string PhotoCheckRequest = "photo_check.request";
    public const string TryOnBody = "tryon.image.body";
    public const string TryOnFace = "tryon.image.face";
    public const string TryOnPhotoBody = "tryon.image.photo.body";
    public const string TryOnPhotoFace = "tryon.image.photo.face";
    public const string ReferenceCheckInstructions = "photo_check.reference.instructions";
    public const string CleanupGarment = "cleanup.garment.image";
    public static string CleanupItem(bool jewellery) => jewellery ? "cleanup.item.jewellery.image" : "cleanup.item.image";

    private static readonly IReadOnlyList<PromptVariable> None = [];

    private static readonly JsonSerializerOptions Pretty = new() { WriteIndented = true };

    private static Func<string> SchemaText(Func<JsonObject> schema) => () => schema().ToJsonString(Pretty);

    private static PromptDefinition Schema(string key, string feature, string operation, Func<JsonObject> schema) =>
        new(key, feature, operation, PromptKind.Schema,
            $"Strict JSON schema of the {operation} answer (response_format). View only: generated from the fixed vocabularies and the DTO the code deserializes.",
            None, SchemaText(schema), int.MaxValue, PromptTrialTarget.None);

    public static readonly IReadOnlyList<PromptDefinition> All =
    [
        new(Language, "common", "outfit, week_plan, packing, garment_draft, item_detection", PromptKind.Fragment,
            "Language suffix appended to the stylist, garment and detection system prompts: every generated text in the user's language.",
            [
                new("languageName", true, "English name of the language (Turkish, English).", "Turkish"),
                new("languageCode", false, "Language code (tr, en).", "tr"),
            ],
            () => OpenAiPrompts.LanguageTemplate, 500, PromptTrialTarget.StylistOutfit),

        new(StylistInstructions(JobKind.StylistOutfit), "stylist", AiSchemas.Outfit, PromptKind.Instructions,
            "Kombin önerisi: system prompt of the outfit suggestions (count outfits from the candidate pieces, slot rules, refusals, tone).",
            None, () => OpenAiPrompts.StylistInstructions(JobKind.StylistOutfit), InstructionsMaxLength, PromptTrialTarget.StylistOutfit),
        new(StylistInstructions(JobKind.StylistWeek), "stylist", AiSchemas.WeekPlan, PromptKind.Instructions,
            "Haftalık plan: system prompt of the week plan (one look per day, no repeat on consecutive days).",
            None, () => OpenAiPrompts.StylistInstructions(JobKind.StylistWeek), InstructionsMaxLength, PromptTrialTarget.StylistWeek),
        new(StylistInstructions(JobKind.StylistPack), "stylist", AiSchemas.Packing, PromptKind.Instructions,
            "Bavul: system prompt of the suitcase (capsule packing list + one look per trip day, re-wear and cabin rules).",
            None, () => OpenAiPrompts.StylistInstructions(JobKind.StylistPack), InstructionsMaxLength, PromptTrialTarget.StylistPack),
        new(CompactCandidates, "stylist", "outfit, week_plan, packing", PromptKind.Fragment,
            "Compact candidates (Stylist:CompactPrompt): how to read the 'id|category|colorIds|fabric|seasons' descriptor strings; appended before the language suffix.",
            None, () => OpenAiPrompts.CompactCandidates, 2000, PromptTrialTarget.None),
        Schema("stylist.outfit.schema", "stylist", AiSchemas.Outfit, AiSchemas.OutfitSchema),
        Schema("stylist.week.schema", "stylist", AiSchemas.WeekPlan, AiSchemas.WeekSchema),
        Schema("stylist.pack.schema", "stylist", AiSchemas.Packing, AiSchemas.PackSchema),

        new(DetectInstructions, "wardrobe", AiSchemas.ItemDetection, PromptKind.Instructions,
            "Parça tanıma: system prompt of the multi-item detection of a wardrobe photo (every wearable piece with its box, category, colours, fabric).",
            None, () => OpenAiPrompts.ItemDetectionBase, InstructionsMaxLength, PromptTrialTarget.ItemDetect, 1),
        new(DetectRequest, "wardrobe", AiSchemas.ItemDetection, PromptKind.Request,
            "User message text sent with the photo of the detection call.",
            None, () => OpenAiPrompts.ItemDetectionRequest, RequestMaxLength, PromptTrialTarget.ItemDetect, 1),
        Schema("item.detect.schema", "wardrobe", AiSchemas.ItemDetection, AiSchemas.ItemDetectionSchema),
        new(DescribeInstructions, "wardrobe", AiSchemas.GarmentDraft, PromptKind.Instructions,
            "Tek parça etiketi: system prompt of the single-garment labelling (category, colours, fabric, seasons, name).",
            None, () => OpenAiPrompts.GarmentVisionBase, InstructionsMaxLength, PromptTrialTarget.ItemDescribe, 1),
        new(DescribeRequest, "wardrobe", AiSchemas.GarmentDraft, PromptKind.Request,
            "User message text sent with the garment photo.",
            None, () => OpenAiPrompts.GarmentVisionRequest, RequestMaxLength, PromptTrialTarget.ItemDescribe, 1),
        Schema("item.describe.schema", "wardrobe", AiSchemas.GarmentDraft, AiSchemas.GarmentSchema),

        new(MatchInstructions, "outfit_import", AiSchemas.ItemMatch, PromptKind.Instructions,
            "Kombinlerini içe aktar: is the cropped piece the very same physical piece as one of the wardrobe candidates?",
            None, () => OpenAiPrompts.ItemMatch, InstructionsMaxLength, PromptTrialTarget.ItemMatch, 2),
        new(MatchRequest, "outfit_import", AiSchemas.ItemMatch, PromptKind.Request,
            "User message text of the match call (the crop first, then the numbered candidates).",
            [
                new("candidates", true, "Number of candidate images after the crop.", "3"),
                new("pieceHint", false, "\" (sub-type)\" of the crop, or empty.", " (denim jacket)"),
            ],
            () => OpenAiPrompts.ItemMatchRequestTemplate, RequestMaxLength, PromptTrialTarget.ItemMatch, 2),
        Schema("item.match.schema", "outfit_import", AiSchemas.ItemMatch, AiSchemas.ItemMatchSchema),

        new(PaletteInstructions, "palette", AiSchemas.PaletteSeason, PromptKind.Instructions,
            "Renk analizi: system prompt of the seasonal colour type from one face photo.",
            None, () => OpenAiPrompts.Palette, InstructionsMaxLength, PromptTrialTarget.Palette, 1),
        new(PaletteRequest, "palette", AiSchemas.PaletteSeason, PromptKind.Request,
            "User message text sent with the face photo.",
            None, () => OpenAiPrompts.PaletteRequest, RequestMaxLength, PromptTrialTarget.Palette, 1),
        Schema("palette.schema", "palette", AiSchemas.PaletteSeason, AiSchemas.PaletteSchema),

        new(PhotoCheckInstructions(PhotoKind.Body), "tryon", AiSchemas.PhotoCheck, PromptKind.Instructions,
            "Fotoğraf kontrolü (boy fotoğrafı): people, full body, face, light, sharpness, minor — before the first try-on.",
            None, () => OpenAiPrompts.PhotoCheck(PhotoKind.Body), InstructionsMaxLength, PromptTrialTarget.PhotoCheckBody, 1),
        new(PhotoCheckInstructions(PhotoKind.Face), "tryon", AiSchemas.PhotoCheck, PromptKind.Instructions,
            "Fotoğraf kontrolü (yüz fotoğrafı): one clearly visible face, light, sharpness, minor.",
            None, () => OpenAiPrompts.PhotoCheck(PhotoKind.Face), InstructionsMaxLength, PromptTrialTarget.PhotoCheckFace, 1),
        new(PhotoCheckRequest, "tryon", AiSchemas.PhotoCheck, PromptKind.Request,
            "User message text sent with the photo to check.",
            None, () => OpenAiPrompts.PhotoCheckRequest, RequestMaxLength, PromptTrialTarget.PhotoCheckBody, 1),
        Schema("photo_check.schema", "tryon", AiSchemas.PhotoCheck, AiSchemas.PhotoCheckSchema),
        new(ReferenceCheckInstructions, "tryon", AiSchemas.ReferenceCheck, PromptKind.Instructions,
            "Kombin fotoğrafı kontrolü: one person wearing visible clothing, no minor — before a photo try-on (the request text is photo_check.request).",
            None, () => OpenAiPrompts.ReferenceCheck, InstructionsMaxLength, PromptTrialTarget.PhotoCheckReference, 1),
        Schema("photo_check.reference.schema", "tryon", AiSchemas.ReferenceCheck, AiSchemas.ReferenceCheckSchema),

        new(TryOnBody, "tryon", "image_tryon", PromptKind.Image,
            "Prova (boy fotoğrafı): image edit prompt — the person of the body photo wearing the garment images.",
            [new("garmentCount", true, "Number of garment images after the body photo.", "2")],
            () => OpenAiPrompts.TryOnTemplate, ImageMaxLength, PromptTrialTarget.None),
        new(TryOnFace, "tryon", "image_tryon", PromptKind.Image,
            "Prova (yüz fotoğrafı): image edit prompt — a full-length figure from the face photo, body type, height and size.",
            [
                new("garmentCount", true, "Number of garment images after the face photo.", "2"),
                new("bodyShape", true, "Body type description chosen by the user.", "a pear body shape (hips wider than the shoulders)"),
                new("height", false, "\" about 170 cm tall,\" or empty.", " about 170 cm tall,"),
                new("size", false, "\" wearing clothing size M,\" or empty.", " wearing clothing size M,"),
            ],
            () => OpenAiPrompts.TryOnFromFaceTemplate, ImageMaxLength, PromptTrialTarget.None),
        new(TryOnPhotoBody, "tryon", "image_tryon", PromptKind.Image,
            "Kombin fotoğrafını üzerimde dene (boy fotoğrafı): image edit prompt — the user of the body photo wearing exactly the outfit of the reference photo (second image), never the reference person's face or body.",
            None, () => OpenAiPrompts.TryOnOutfitPhotoTemplate, ImageMaxLength, PromptTrialTarget.None),
        new(TryOnPhotoFace, "tryon", "image_tryon", PromptKind.Image,
            "Kombin fotoğrafını üzerimde dene (yüz fotoğrafı): a full-length figure from the face photo, body type, height and size, wearing the outfit of the reference photo.",
            [
                new("bodyShape", true, "Body type description chosen by the user.", "a pear body shape (hips wider than the shoulders)"),
                new("height", false, "\" about 170 cm tall,\" or empty.", " about 170 cm tall,"),
                new("size", false, "\" wearing clothing size M,\" or empty.", " wearing clothing size M,"),
            ],
            () => OpenAiPrompts.TryOnOutfitPhotoFromFaceTemplate, ImageMaxLength, PromptTrialTarget.None),

        new(CleanupItem(false), "cleanup", "image_cleanup", PromptKind.Image,
            "Arka plan temizleme: product photo of one detected piece on the sand house background.",
            [new("piece", true, "Sub-type with spaces, else the category (\"ankle boots\", \"top\").", "ankle boots")],
            () => OpenAiPrompts.CleanupItemTemplate(false), ImageMaxLength, PromptTrialTarget.None),
        new(CleanupItem(true), "cleanup", "image_cleanup", PromptKind.Image,
            "Arka plan temizleme (takı): jewellery product shot of one detected piece.",
            [new("piece", true, "Jewellery sub-type with spaces (\"ring\", \"necklace\").", "ring")],
            () => OpenAiPrompts.CleanupItemTemplate(true), ImageMaxLength, PromptTrialTarget.None),
        new(CleanupGarment, "cleanup", "image_cleanup", PromptKind.Image,
            "Arka plan temizleme (tek parça fotoğrafı, eski akış): product photo of the garment.",
            None, () => OpenAiPrompts.Cleanup, ImageMaxLength, PromptTrialTarget.None),
    ];

    private static readonly Dictionary<string, PromptDefinition> ByKey = All.ToDictionary(d => d.Key, StringComparer.Ordinal);

    public static PromptDefinition? Find(string key) => ByKey.GetValueOrDefault(key);

    /// <summary>Sample variable values (the editor's preview and a dry-run).</summary>
    public static IReadOnlyDictionary<string, string> SampleValues(PromptDefinition definition) =>
        definition.Variables.ToDictionary(v => v.Name, v => v.Sample, StringComparer.Ordinal);

    // ── Validation ─────────────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Errors keyed by field: text = empty | too_long | malformed_placeholder | read_only;
    /// placeholders.{name} = missing (a required one is absent) | unknown (not a variable of this prompt).
    /// </summary>
    public static Dictionary<string, string[]> Validate(PromptDefinition definition, string? text)
    {
        var errors = new Dictionary<string, string[]>(StringComparer.Ordinal);
        if (!definition.Editable)
        {
            errors["text"] = ["read_only"];
            return errors;
        }
        if (string.IsNullOrWhiteSpace(text))
        {
            errors["text"] = ["empty"];
            return errors;
        }
        if (text.Length > definition.MaxLength)
            errors["text"] = ["too_long"];
        else if (PromptTemplate.HasMalformedPlaceholder(text))
            errors["text"] = ["malformed_placeholder"];

        var used = PromptTemplate.Placeholders(text);
        foreach (var variable in definition.Variables.Where(v => v.Required && !used.Contains(v.Name, StringComparer.Ordinal)))
            errors[$"placeholders.{variable.Name}"] = ["missing"];
        foreach (var name in used.Where(n => definition.Variables.All(v => v.Name != n)))
            errors[$"placeholders.{name}"] = ["unknown"];
        return errors;
    }

    /// <summary>
    /// Prompt-caching warnings (never block a save). OpenAI reuses cached input tokens only for an identical request
    /// prefix: system prompt first, then the user text, then images. cache_prefix_shorter = a variable now appears
    /// earlier than in the code default, so less static text precedes the per-request values.
    /// </summary>
    public static IReadOnlyList<string> CacheWarnings(PromptDefinition definition, string text)
    {
        var warnings = new List<string>();
        if (definition.Variables.Count == 0 || !definition.Editable)
            return warnings;
        if (PromptTemplate.StaticPrefixLength(text) < PromptTemplate.StaticPrefixLength(definition.Default()))
            warnings.Add("cache_prefix_shorter");
        return warnings;
    }

    // ── Dry-run samples ────────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>A small synthetic request in the shape the stylist job builds (no user data). Editable in the panel.</summary>
    public static string SampleInput(PromptTrialTarget target) => target switch
    {
        PromptTrialTarget.StylistOutfit => """
            {"language":"tr","styleProfile":null,"palette":null,"candidates":[
            {"id":"t1","category":"top","colorIds":["white"],"fabric":"cotton","seasons":["spring","summer"]},
            {"id":"t2","category":"top","colorIds":["navy"],"fabric":"linen","seasons":["summer"]},
            {"id":"b1","category":"bottom","colorIds":["beige"],"fabric":"cotton","seasons":["spring","summer","autumn"]},
            {"id":"b2","category":"bottom","colorIds":["black"],"fabric":"denim","seasons":["spring","autumn","winter"]},
            {"id":"s1","category":"shoes","colorIds":["white"],"fabric":"leather","seasons":["spring","summer","autumn"]},
            {"id":"a1","category":"bag","colorIds":["taupe"],"fabric":"leather","seasons":["spring","summer","autumn","winter"]}],
            "productCandidates":[],"count":3,"onlyMyWardrobe":true,"avoidCombinations":[],"date":"2026-06-12","season":"summer",
            "occasion":"weekend","weather":{"minTempC":19,"maxTempC":27,"condition":"clear"},"freeText":null,"pinnedItemId":null}
            """,
        PromptTrialTarget.StylistWeek => """
            {"language":"tr","styleProfile":null,"candidates":[
            {"id":"t1","category":"top","colorIds":["white"],"fabric":"cotton","seasons":["spring","summer"]},
            {"id":"t2","category":"top","colorIds":["navy"],"fabric":"linen","seasons":["summer"]},
            {"id":"b1","category":"bottom","colorIds":["beige"],"fabric":"cotton","seasons":["spring","summer","autumn"]},
            {"id":"b2","category":"bottom","colorIds":["black"],"fabric":"denim","seasons":["spring","autumn","winter"]},
            {"id":"s1","category":"shoes","colorIds":["white"],"fabric":"leather","seasons":["spring","summer","autumn"]}],
            "weekStart":"2026-06-08","days":[
            {"date":"2026-06-08","occasion":"office","weather":{"minTempC":18,"maxTempC":25,"condition":"clear"}},
            {"date":"2026-06-09","occasion":"office","weather":{"minTempC":17,"maxTempC":24,"condition":"cloudy"}}]}
            """,
        PromptTrialTarget.StylistPack => """
            {"language":"tr","candidates":[
            {"id":"t1","category":"top","colorIds":["white"],"fabric":"cotton","seasons":["spring","summer"]},
            {"id":"t2","category":"top","colorIds":["navy"],"fabric":"linen","seasons":["summer"]},
            {"id":"b1","category":"bottom","colorIds":["beige"],"fabric":"cotton","seasons":["spring","summer","autumn"]},
            {"id":"s1","category":"shoes","colorIds":["white"],"fabric":"leather","seasons":["spring","summer","autumn"]},
            {"id":"a1","category":"bag","colorIds":["taupe"],"fabric":"leather","seasons":["spring","summer","autumn","winter"]}],
            "trip":{"dates":["2026-06-12","2026-06-13"],"tripTypes":["sightseeing"],"cabinOnly":true,"cabinMaxItems":0,"weather":[]},
            "days":[{"date":"2026-06-12","occasion":"travel","outerLayer":false},{"date":"2026-06-13","occasion":"weekend","outerLayer":false}],
            "capsule":{"tops":2,"bottoms":1,"shoes":1,"outerwear":0,"bags":1,"pieces":5,"minPieces":3,"maxPieces":6},"minRewearRatio":1.0}
            """,
        _ => "",
    };

    /// <summary>Language of a dry-run (the "language" field of the sample, else tr).</summary>
    public static string SampleLanguage(string? input)
    {
        try
        {
            return JsonNode.Parse(input ?? "")?["language"]?.GetValue<string>() is { Length: > 0 } language ? language : "tr";
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException or FormatException)
        {
            return "tr";
        }
    }

    public static JobKind? StylistKind(PromptTrialTarget target) => target switch
    {
        PromptTrialTarget.StylistOutfit => JobKind.StylistOutfit,
        PromptTrialTarget.StylistWeek => JobKind.StylistWeek,
        PromptTrialTarget.StylistPack => JobKind.StylistPack,
        _ => null,
    };
}
