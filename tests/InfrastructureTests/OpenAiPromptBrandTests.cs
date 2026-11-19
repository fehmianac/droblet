using Domain.Services.Ai;
using Infrastructure.Ai;

namespace InfrastructureTests;

/// <summary>Owner rule: a piece's brand marks survive the product shot and the try-on (they used to be wiped by "no logos").</summary>
public class OpenAiPromptBrandTests
{
    [Theory]
    [InlineData(ItemCategoryHint.Bag, "clutch")]
    [InlineData(ItemCategoryHint.Top, "t-shirt")]
    [InlineData(null, null)]
    public void Cleanup_KeepsTheLogosOnThePiece_AndOnlyTheBackgroundStaysPlain(ItemCategoryHint? category, string? subcategory)
    {
        var prompt = OpenAiPrompts.CleanupItem(category, subcategory);
        Assert.Contains("Keep every brand logo, monogram", prompt);
        Assert.DoesNotContain("no text, no logos", prompt);
        Assert.Contains("add no text or logo to the background", prompt);
    }
}
