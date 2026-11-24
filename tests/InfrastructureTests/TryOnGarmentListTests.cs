using Domain.Enum;
using Domain.Services;
using Domain.Services.Ai;
using Infrastructure.Ai;

namespace InfrastructureTests;

/// <summary>Owner request 2026-11-24 "seçtiğim her şey giydirilsin": the try-on prompt names every garment and its layer.</summary>
public class TryOnGarmentListTests
{
    private static ImageInput Garment(ItemCategory? category) => new([1], "image/jpeg", category);

    [Fact]
    public void Every_garment_is_named_with_its_image_number_and_layer()
    {
        var text = OpenAiPrompts.GarmentList([Garment(ItemCategory.Top), Garment(ItemCategory.Top), Garment(ItemCategory.Bottom), Garment(ItemCategory.Outerwear), Garment(ItemCategory.Shoes)]);

        Assert.Contains("image 2 is a top, the innermost layer", text);
        Assert.Contains("image 3 is a top worn as a layer over the previous top", text);
        Assert.Contains("image 4 is the bottom", text);
        Assert.Contains("image 5 is outerwear (a jacket, blazer or coat) worn on top of everything else", text);
        Assert.Contains("image 6 is the shoes", text);
        Assert.Contains("All 5 pieces must be worn at the same time", text);
        Assert.Contains("never leave a piece out", text);
    }

    [Fact]
    public void Garments_without_a_category_add_nothing() =>
        Assert.Equal("", OpenAiPrompts.GarmentList([Garment(null), Garment(null)]));

    [Fact]
    public void Wear_order_is_inside_out_and_keeps_the_order_of_the_top_layers()
    {
        ImageInput[] sent = [Garment(ItemCategory.Outerwear), Garment(ItemCategory.Shoes), new([1], "a", ItemCategory.Top), new([2], "b", ItemCategory.Top), Garment(ItemCategory.Accessory), Garment(ItemCategory.Bottom), Garment(ItemCategory.Socks), Garment(ItemCategory.Bag)];

        var ordered = sent.OrderBy(g => TryOnRules.WearOrder(g.Category)).ToList();

        Assert.Equal(
            [ItemCategory.Top, ItemCategory.Top, ItemCategory.Bottom, ItemCategory.Outerwear, ItemCategory.Socks, ItemCategory.Shoes, ItemCategory.Bag, ItemCategory.Accessory],
            ordered.Select(g => g.Category!.Value));
        Assert.Equal(["a", "b"], ordered.Take(2).Select(g => g.ContentType));
    }

    [Fact]
    public void TryOnBackdrop_IsTheAppsSandSurface_AndOverrulesTheTemplateWording()
    {
        Assert.Contains("#E8E1D7", OpenAiPrompts.TryOnBackdrop);
        Assert.Contains("overruling any other background instruction", OpenAiPrompts.TryOnBackdrop);
        Assert.StartsWith(" ", OpenAiPrompts.TryOnBackdrop);   // appended after the template and the garment list
    }
}
