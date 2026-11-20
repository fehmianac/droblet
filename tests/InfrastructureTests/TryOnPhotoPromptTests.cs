using Domain.Enum;
using Domain.Options;
using Domain.Services;
using Domain.Services.Admin;
using Domain.Services.Ai;
using Domain.Services.Styling;
using Infrastructure.Ai;

namespace InfrastructureTests;

/// <summary>"Kombini ayırmadan üzerimde gör": the prompts are registry keys (editable in the admin panel) and say the guards.</summary>
public class TryOnPhotoPromptTests
{
    [Fact]
    public void Catalog_ListsThePhotoTryOnPrompts_AndTheOutfitPhotoCheck()
    {
        var body = PromptCatalog.Find("tryon.image.photo.body")!;
        var face = PromptCatalog.Find("tryon.image.photo.face")!;
        var check = PromptCatalog.Find("photo_check.reference.instructions")!;

        Assert.Equal((PromptKind.Image, "image_tryon", true), (body.Kind, body.Operation, body.Editable));
        Assert.Equal(OpenAiPrompts.TryOnOutfitPhotoTemplate, body.Default());
        Assert.Equal(PromptKind.Image, face.Kind);
        Assert.Equal(["bodyShape", "height", "size"], face.Variables.Select(v => v.Name).ToArray());
        Assert.Empty(PromptCatalog.Validate(face, face.Default()));
        Assert.Equal((PromptKind.Instructions, AiSchemas.ReferenceCheck, PromptTrialTarget.PhotoCheckReference), (check.Kind, check.Operation, check.Trial));
        Assert.False(PromptCatalog.Find("photo_check.reference.schema")!.Editable);
    }

    [Fact]
    public void Prompts_DressTheUserInTheWholeOutfit_NeverTheReferencePersonsIdentity()
    {
        foreach (var text in new[] { OpenAiPrompts.TryOnOutfitPhotoTemplate, OpenAiPrompts.TryOnOutfitPhotoFromFace(new TryOnFigure(BodyType.Pear, 168, ClothingSize.M)) })
        {
            Assert.Contains("exactly the outfit worn in the reference photo", text);
            Assert.Contains("every visible garment, the shoes, the bag and every accessory", text);
            Assert.Contains("logo", text);
            Assert.Contains("never copy the reference person's face, hair, skin, body shape", text);
            Assert.Contains("full body in frame", text);
            Assert.DoesNotContain("{{", text);
        }
        Assert.Contains("about 168 cm tall", OpenAiPrompts.TryOnOutfitPhotoFromFace(new TryOnFigure(BodyType.Pear, 168, ClothingSize.M)));
        Assert.Contains("under 18", OpenAiPrompts.ReferenceCheck);
    }

    [Fact]
    public void ReferenceCheck_IsAFastModelOperation_CountedAsAPhotoCheck_AndTunableInThePanel()
    {
        var options = new AiOptions { TextModel = "text-model", FastTextModel = "fast-model" };
        Assert.Equal("fast-model", options.ModelFor(AiSchemas.ReferenceCheck));
        Assert.Equal(AiUsageOperations.PhotoCheck, AiUsageOperations.Classify(JobKind.TryOn, AiSchemas.ReferenceCheck));
        Assert.Equal(AiUsageOperations.TryOn, AiUsageOperations.Classify(JobKind.TryOn, "image_tryon"));
        Assert.Contains(AiSchemas.ReferenceCheck, SettingsCatalog.AiTextOperations);
    }

    [Fact]
    public void ParseReferenceCheck_ReadsTheVerdict()
    {
        var verdict = OpenAiPayloads.ParseReferenceCheck("""{"people":1,"clothingVisible":true,"appearsMinor":false}""");
        Assert.Equal(new ReferenceInspection(1, true, false), verdict);
        Assert.Equal(["appearsMinor", "clothingVisible", "people"], AiSchemas.ReferenceCheckSchema()["required"]!.AsArray().Select(n => n!.GetValue<string>()).Order().ToArray());
    }
}
