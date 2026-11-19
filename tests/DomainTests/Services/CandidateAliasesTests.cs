using Domain.Enum;
using Domain.Services.Ai;
using Domain.Services.Styling;

namespace DomainTests.Services;

public class CandidateAliasesTests
{
    private static readonly CandidateItem[] Candidates =
    [
        new("01JAAAAAAAAAAAAAAAAAAAAAAA", ItemCategory.Top, ["white", "navy"], "cotton", [Season.Spring, Season.Autumn]),
        new("01JBBBBBBBBBBBBBBBBBBBBBBB", ItemCategory.Bottom, [], null, []),
        new("01JCCCCCCCCCCCCCCCCCCCCCCC", ItemCategory.Shoes, ["black"], "leather", [Season.Winter]),
    ];

    [Fact]
    public void Compact_DescribesEachPieceInOneString_WithAShortAlias()
    {
        var aliases = CandidateAliases.For(Candidates, compact: true);

        Assert.Equal("i1|top|white,navy|cotton|spring,autumn", aliases.Describe(Candidates[0]));
        Assert.Equal("i2|bottom|-|-|-", aliases.Describe(Candidates[1]));
        Assert.Equal("i3", aliases.AliasOrNull(Candidates[2].Id));
        Assert.Null(aliases.AliasOrNull(null));
    }

    [Fact]
    public void Restore_MapsSlotsAndItemIdsOnly_AndKeepsUnknownValuesForTheGuard()
    {
        var aliases = CandidateAliases.For(Candidates, compact: true);
        const string answer = """
            {"itemIds":["i1","i3","i9"],"days":[{"date":"2026-11-20","title":"i1","slots":{"top":"i1","bottom":"i2","outerwear":null,"shoes":"i3","bagAccessory":"x"}}]}
            """;

        var restored = aliases.Restore(answer);

        Assert.Contains("\"itemIds\":[\"01JAAAAAAAAAAAAAAAAAAAAAAA\",\"01JCCCCCCCCCCCCCCCCCCCCCCC\",\"i9\"]", restored);
        Assert.Contains("\"top\":\"01JAAAAAAAAAAAAAAAAAAAAAAA\"", restored);
        Assert.Contains("\"bottom\":\"01JBBBBBBBBBBBBBBBBBBBBBBB\"", restored);
        Assert.Contains("\"title\":\"i1\"", restored);                 // free text is never touched
        Assert.Contains("\"bagAccessory\":\"x\"", restored);
        Assert.Equal("not json", aliases.Restore("not json"));
    }

    [Fact]
    public void Off_IsTheIdentity_AndTheOriginalObjects()
    {
        var aliases = CandidateAliases.For(Candidates, compact: false);
        const string answer = """{"suggestions":[{"slots":{"top":"i1"}}]}""";

        Assert.Same(answer, aliases.Restore(answer));
        Assert.Equal(Candidates[0].Id, aliases.Alias(Candidates[0].Id));
        Assert.IsNotType<string>(aliases.Describe(Candidates[0]));
    }

    [Fact]
    public void Combinations_WithAPieceOutsideTheCandidates_AreDroppedInCompactMode()
    {
        var aliases = CandidateAliases.For(Candidates, compact: true);
        var combos = aliases.Combinations([[Candidates[0].Id, Candidates[1].Id], [Candidates[0].Id, "deleted-piece"]]);
        Assert.Equal([["i1", "i2"]], combos.Select(c => c.ToArray()));
    }

    [Fact]
    public void Prompt_IsTheSameAsBefore_WhenCompactIsOff()
    {
        var aliases = CandidateAliases.For(Candidates, compact: false);
        var json = StylistPrompts.Week(aliases, Candidates, "tr", null, "2026-11-23", [new StylistPrompts.WeekDay("2026-11-23", Occasion.Office, null)]);

        Assert.StartsWith("{\"language\":\"tr\",\"styleProfile\":null,\"candidates\":[{\"id\":\"01JAAAAAAAAAAAAAAAAAAAAAAA\",\"category\":\"top\"", json);
        Assert.EndsWith("\"days\":[{\"date\":\"2026-11-23\",\"occasion\":\"office\",\"weather\":null}]}", json);
        var compact = StylistPrompts.Week(CandidateAliases.For(Candidates, true), Candidates, "tr", null, "2026-11-23", [new StylistPrompts.WeekDay("2026-11-23", Occasion.Office, null)]);
        Assert.True(compact.Length < json.Length / 2);
    }
}
