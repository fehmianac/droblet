using Domain.Enum;
using Domain.Services;
using Domain.Services.Styling;

namespace DomainTests.Services;

public class WeekPlanningTests
{
    private static readonly string[] Week = ["d1", "d2", "d3", "d4", "d5", "d6", "d7"];

    [Theory]
    [InlineData(3, new[] { 3, 2, 2 })]
    [InlineData(2, new[] { 2, 2, 2, 1 })]
    [InlineData(1, new[] { 1, 1, 1, 1, 1, 1, 1 })]
    [InlineData(7, new[] { 7 })]
    [InlineData(0, new[] { 7 })]
    [InlineData(10, new[] { 7 })]
    public void Split_IsContiguous_EvenAndKeepsEveryDate(int maxPerBatch, int[] sizes)
    {
        var batches = WeekPlanning.Split(Week, maxPerBatch);

        Assert.Equal(sizes, batches.Select(b => b.Count));
        Assert.Equal(Week, batches.SelectMany(b => b));
    }

    [Fact]
    public void Split_Empty_IsNoBatch() => Assert.Empty(WeekPlanning.Split([], 3));

    private static ModelDay Day(string date, string top) => new(date, "t", null, "office", new ModelSlots(top, "b", null, "s", null));

    [Fact]
    public void Merge_KeepsOnlyTheDatesEachBatchWasAskedFor_NullWhenNothingAnswered()
    {
        var merged = WeekPlanning.Merge([
            (["d1", "d2"], new ModelWeekOutput([Day("d1", "a"), Day("d2", "b"), Day("d3", "stray")], null)),
            (["d3"], new ModelWeekOutput([Day("d3", "c")], null)),
            (["d4"], null),
        ])!;

        Assert.Equal(["d1:a", "d2:b", "d3:c"], merged.Days!.Select(d => $"{d.Date}:{d.Slots!.Top}"));
        Assert.Null(WeekPlanning.Merge([(["d1"], null)]));
    }

    private static SuggestedOutfit Look(string top, string bottom) =>
        new(0, null, null, "model", [new SlotRef(OutfitSlot.Top, top), new SlotRef(OutfitSlot.Bottom, bottom)], []);

    [Fact]
    public void RepeatedDates_NamesLaterOccurrencesOfALook_TheFirstKeepsIt()
    {
        var accepted = new Dictionary<string, SuggestedOutfit>
        {
            ["d1"] = Look("a", "b"),
            ["d2"] = Look("c", "d"),
            ["d4"] = Look("a", "b"),
            ["d6"] = Look("a", "b"),
        };

        Assert.Equal(["d4", "d6"], WeekPlanning.RepeatedDates(accepted, Week));
    }
}
