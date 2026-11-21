using Domain.Enum;
using Domain.Services;
using Domain.Services.Ai;
using Infrastructure.Ai;

namespace InfrastructureTests;

/// <summary>Segment-aware prompts: women's requests are byte-identical to phase 1, men get menswear fragments and wording.</summary>
public class SegmentPromptTests
{
    // The phase 1 face-path templates, verbatim (before {{personNoun}} existed).
    private const string Phase1Face =
        "The first image is a photo of an adult person's face. The following {{garmentCount}} image(s) are garments. " +
        "Create a realistic full-length photo of this same adult person with {{bodyShape}},{{height}}{{size}} standing in a relaxed, neutral pose. " +
        "Keep the face, facial features, skin tone, hair and apparent age exactly as in the face photo — do not change, beautify or replace the person's identity. " +
        "The face must be the same face as in the photo: the same face shape, eyes, nose, mouth, eyebrows, skin texture and expression. Never redraw, retouch, slim, age or de-age it; render it at a natural size for a full-length photo. " +
        "The person is fully clothed, wearing exactly these garments, keeping each garment's colour, pattern, cut and every brand logo, monogram, print and lettering exactly as on the garment; add plain neutral basics only where a garment is missing so the person is never undressed. " +
        "Never show nudity, underwear alone or a suggestive pose. Never exaggerate the body shape. Neutral studio background, full body in frame, no text.";

    private const string Phase1PhotoFace =
        "The first image is a photo of an adult user's face. The second image is a reference photo of another person wearing a complete outfit. " +
        "Create a realistic full-length photo of this same adult user with {{bodyShape}},{{height}}{{size}} standing in a relaxed, neutral pose. " +
        "Keep the face, facial features, skin tone, hair and apparent age exactly as in the face photo — do not change, beautify or replace the user's identity. " +
        "Dress the user in exactly the outfit worn in the reference photo: every visible garment, the shoes, the bag and every accessory, keeping each one's colour, pattern, fabric, cut and every brand logo, monogram, print and lettering exactly as in the reference; " +
        "add plain neutral basics only where the reference shows no garment so the user is never undressed. " +
        "Use the reference photo only for the clothes: never copy the reference person's face, hair, skin, body shape, pose or background. " +
        "Never show nudity, underwear alone or a suggestive pose. Never exaggerate the body shape. Neutral studio background, full body in frame, no text.";

    [Theory]
    [InlineData(BodyType.Hourglass)]
    [InlineData(BodyType.Pear)]
    [InlineData(BodyType.Rectangle)]
    [InlineData(BodyType.Unsure)]
    public void Women_FacePathPrompts_AreByteIdenticalToPhase1(BodyType bodyType)
    {
        var figure = new TryOnFigure(bodyType, 168, ClothingSize.M);
        var values = OpenAiPrompts.TryOnFromFaceValues(2, figure);

        Assert.Equal(PromptTemplate.Render(Phase1Face, values), OpenAiPrompts.TryOnFromFace(2, figure));
        Assert.Equal(PromptTemplate.Render(Phase1PhotoFace, OpenAiPrompts.FigureValues(figure)), OpenAiPrompts.TryOnOutfitPhotoFromFace(figure));
        Assert.Equal("a pear body shape (hips wider than the shoulders)", OpenAiPrompts.BodyShape(new TryOnFigure(BodyType.Pear, null, null)));
    }

    [Fact]
    public void Men_FacePath_IsAnAdultMan_WithMensBuildWording()
    {
        var figure = new TryOnFigure(BodyType.Trapezoid, 182, ClothingSize.L, Segment.Men);

        var face = OpenAiPrompts.TryOnFromFace(2, figure);
        var photo = OpenAiPrompts.TryOnOutfitPhotoFromFace(figure);

        Assert.Contains("a photo of an adult man's face", face);
        Assert.Contains("this same adult man with a trapezoid, athletic build", face);
        Assert.Contains("a photo of an adult man's face", photo);
        Assert.DoesNotContain("{{", face + photo);
        Assert.Contains("V-shaped", OpenAiPrompts.BodyShape(figure with { BodyType = BodyType.InvertedTriangle }));
        Assert.Contains("rounded midsection", OpenAiPrompts.BodyShape(figure with { BodyType = BodyType.Oval }));
        Assert.Contains("hips and waist wider than the shoulders", OpenAiPrompts.BodyShape(figure with { BodyType = BodyType.Triangle }));
        // A women's body type left from before a segment change reads as "not sure", never as a woman's figure.
        Assert.Equal("a balanced, average build", OpenAiPrompts.BodyShape(figure with { BodyType = BodyType.Hourglass }));
        Assert.Equal("a balanced, average body shape", OpenAiPrompts.BodyShape(new TryOnFigure(BodyType.Trapezoid, null, null)));
    }

    [Fact]
    public void Body_And_PhotoPrompts_AreNeutral_ForBothSegments()
    {
        foreach (var text in new[] { OpenAiPrompts.TryOnTemplate, OpenAiPrompts.TryOnOutfitPhotoTemplate, OpenAiPrompts.PhotoCheck(PhotoKind.Body),
                     OpenAiPrompts.PhotoCheck(PhotoKind.Face), OpenAiPrompts.ReferenceCheck, OpenAiPrompts.Palette })
        {
            Assert.DoesNotContain("woman", text, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain(" her ", text, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("female", text, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Theory]
    [InlineData(JobKind.StylistOutfit)]
    [InlineData(JobKind.StylistWeek)]
    [InlineData(JobKind.StylistPack)]
    public void Stylist_Women_IsUnchanged_Men_GetsTheMenswearFragment(JobKind kind)
    {
        Assert.Equal(OpenAiPrompts.StylistInstructions(kind) + OpenAiPrompts.WriteIn("tr"), OpenAiPrompts.Stylist(kind, "tr"));
        Assert.Equal(OpenAiPrompts.Stylist(kind, "tr"), OpenAiPrompts.Stylist(kind, "tr", segment: Segment.Women));

        var men = OpenAiPrompts.Stylist(kind, "tr", compactCandidates: true, segment: Segment.Men);
        Assert.Equal(OpenAiPrompts.StylistInstructions(kind) + OpenAiPrompts.StylistMenswear + OpenAiPrompts.CompactCandidates + OpenAiPrompts.WriteIn("tr"), men);
        Assert.Contains("only when it is among the candidates", OpenAiPrompts.StylistMenswear);
        Assert.Contains("suit jacket", OpenAiPrompts.StylistMenswear);
        Assert.Contains("chinos", OpenAiPrompts.StylistMenswear);
    }

    [Fact]
    public void Detection_Women_IsUnchanged_Men_GetsTheMenswearSubtypes_AllInTheSchema()
    {
        Assert.Equal(OpenAiPrompts.ItemDetectionBase + OpenAiPrompts.WriteIn("en"), OpenAiPrompts.ItemDetection("en"));
        Assert.Equal(OpenAiPrompts.ItemDetectionBase + OpenAiPrompts.ItemDetectionMenswear + OpenAiPrompts.WriteIn("en"), OpenAiPrompts.ItemDetection("en", Segment.Men));

        // Every sub-type the men's hint names exists in the catalog (= the response schema enum).
        var named = System.Text.RegularExpressions.Regex.Match(OpenAiPrompts.ItemDetectionMenswear, @"\(([^)]*)\)").Groups[1].Value
            .Split(',', StringSplitOptions.TrimEntries);
        Assert.All(named, id => Assert.Contains(id, SubcategoryCatalog.Ids));
        var schema = Domain.Services.Styling.AiSchemas.ItemDetectionSchema().ToJsonString();
        Assert.Contains("\"suit-jacket\"", schema);
        Assert.Contains("\"derbies\"", schema);
    }

    [Fact]
    public void Catalog_ListsTheMenswearKeys_AsEditableFragments_ThatValidate()
    {
        foreach (var key in new[] { PromptCatalog.StylistMenswear, PromptCatalog.DetectMenswear })
        {
            var definition = PromptCatalog.Find(key)!;
            Assert.Equal(PromptKind.Fragment, definition.Kind);
            Assert.True(definition.Editable);
            Assert.Empty(PromptCatalog.Validate(definition, definition.Default()));
            Assert.True(PromptCatalog.IsMenswear(key));
            // A dry-run of a menswear key always runs as a man's request.
            Assert.Equal(Segment.Men, PromptCatalog.SampleSegment(definition, null));
        }
        Assert.Equal(PromptTrialTarget.StylistOutfit, PromptCatalog.Find(PromptCatalog.StylistMenswear)!.Trial);
        Assert.Equal(PromptTrialTarget.ItemDetect, PromptCatalog.Find(PromptCatalog.DetectMenswear)!.Trial);

        var outfit = PromptCatalog.Find(PromptCatalog.StylistInstructions(JobKind.StylistOutfit))!;
        Assert.Equal(Segment.Women, PromptCatalog.SampleSegment(outfit, PromptCatalog.SampleInput(PromptTrialTarget.StylistOutfit)));
        Assert.Equal(Segment.Men, PromptCatalog.SampleSegment(outfit, """{"language":"tr","segment":"men"}"""));
        Assert.Equal(Segment.Women, PromptCatalog.SampleSegment(outfit, "not json"));
    }
}
