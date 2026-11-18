using System.Text.Json;
using Domain.Entity;
using Domain.Enum;
using Domain.Events;
using Domain.Services;
using Domain.Services.Ai;
using Domain.Services.Styling;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Stylist.Services;
using Tests.Shared;

namespace StylistTests;

public class StylistJobServiceTests
{
    private const string Tenant = "01JTENANT0000000000000000A";
    private const string Other = "01JTENANT0000000000000000B";

    private sealed class FixedModel(string output) : IStylistModel
    {
        public List<StylistPrompt> Prompts { get; } = [];

        public Task<string> GenerateAsync(StylistPrompt prompt, CancellationToken ct)
        {
            Prompts.Add(prompt);
            return Task.FromResult(output);
        }
    }

    private sealed class FixedWeather(params DailyForecast[] days) : IWeatherService
    {
        private WeatherForecast Forecast(string key) => new(key, null, DateTime.UnixEpoch, days);

        public Task<WeatherForecast?> GetForecastByCityAsync(string cityId, int days, CancellationToken ct) =>
            Task.FromResult<WeatherForecast?>(Forecast(WeatherRules.CityKey(cityId)));
        public Task<WeatherForecast> GetForecastByLocationAsync(double latitude, double longitude, int days, CancellationToken ct) =>
            Task.FromResult(Forecast(WeatherRules.LocationKey(latitude, longitude)));
        public Task<IReadOnlyList<CityDto>> SearchCitiesAsync(string query, CancellationToken ct) => Task.FromResult<IReadOnlyList<CityDto>>([]);
        public Task<CityDto?> GetCityAsync(string cityId, CancellationToken ct) => Task.FromResult<CityDto?>(null);
    }

    private static WorkerTestHost Host(IStylistModel? model = null, IWeatherService? weather = null) => new(s =>
    {
        s.AddSingleton<IStylistJobService, StylistJobService>();
        if (model is not null)
        {
            s.RemoveAll<IStylistModel>();
            s.AddSingleton(model);
        }
        if (weather is not null)
        {
            s.RemoveAll<IWeatherService>();
            s.AddSingleton(weather);
        }
    });

    private static async Task SeedWardrobeAsync(WorkerTestHost host, string tenant = Tenant, bool shoes = true)
    {
        async Task Add(string id, ItemCategory category) => await host.Repository.SaveAsync(new ItemEntity
        {
            Id = id, TenantId = tenant, Category = category, ColorIds = ["black"],
            Seasons = [Season.Spring, Season.Summer, Season.Autumn, Season.Winter], CreatedAt = WorkerTestHost.Now, Version = 1,
        });

        await Add("top1", ItemCategory.Top);
        await Add("top2", ItemCategory.Top);
        await Add("bot1", ItemCategory.Bottom);
        await Add("bot2", ItemCategory.Bottom);
        await Add("dress1", ItemCategory.Dress);
        await Add("coat1", ItemCategory.Outerwear);
        await Add("bag1", ItemCategory.Bag);
        if (shoes)
        {
            await Add("shoe1", ItemCategory.Shoes);
            await Add("shoe2", ItemCategory.Shoes);
        }
    }

    private static async Task<JobEntity> QueueAsync(WorkerTestHost host, JobKind kind, object input)
    {
        var job = await host.QueueJobAsync(Tenant, kind);
        job.Input = StylingJson.Serialize(input);
        await host.Repository.SaveAsync(job);
        return job;
    }

    private static OutfitJobInput OutfitInput(bool onlyMyWardrobe = true, string? pinned = null, string language = "tr", string? cityId = null) =>
        new("2026-11-18", Occasion.Office, "akşam iş yemeği", onlyMyWardrobe, pinned, cityId, null, null, language);

    private static async Task<JobEntity> RunAsync(WorkerTestHost host, JobEntity job)
    {
        await host.Get<IStylistJobService>().ProcessAsync(new StylistRequestedEvent(Tenant, job.Id, job.Kind), false, default);
        return (await host.JobAsync(job))!;
    }

    private static string Suggestion(string top, string? bottom, string shoes, string title = "Sakin Ofis", string explanation = "Kısa not.") =>
        $$"""{"title":"{{title}}","explanation":"{{explanation}}","slots":{"top":"{{top}}","bottom":{{(bottom is null ? "null" : $"\"{bottom}\"")}},"outerwear":null,"shoes":"{{shoes}}","bagAccessory":null},"missing":[]}""";

    private static string Outfits(params string[] suggestions) => $$"""{"suggestions":[{{string.Join(',', suggestions)}}],"refusal":null}""";

    // ── Outfit ────────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Outfit_WhenProviderNotConfigured_ProviderError()
    {
        var host = Host();
        await SeedWardrobeAsync(host);
        var job = await QueueAsync(host, JobKind.StylistOutfit, OutfitInput());

        var stored = await RunAsync(host, job);

        Assert.Equal(JobStatus.Failed, stored.Status);
        Assert.Equal(JobFailure.ProviderError, stored.Failure);
        Assert.Null(stored.Result);
    }

    [Fact]
    public async Task Outfit_WardrobeCannotDress_RefusesWithoutCallingTheModel()
    {
        var model = new FixedModel(Outfits());
        var host = Host(model);
        var job = await QueueAsync(host, JobKind.StylistOutfit, OutfitInput());

        var stored = await RunAsync(host, job);

        var result = StylingJson.TryDeserialize<OutfitResult>(stored.Result)!;
        Assert.Equal(JobStatus.Completed, stored.Status);
        Assert.Equal(StylistRefusals.InsufficientWardrobe, result.Refusal);
        Assert.Empty(result.Suggestions);
        Assert.Empty(model.Prompts);
    }

    [Fact]
    public async Task Outfit_ValidModelOutput_ThreeModelSuggestions_InTheUsersLanguage()
    {
        var model = new FixedModel(Outfits(Suggestion("top1", "bot1", "shoe1"), Suggestion("top2", "bot2", "shoe2"), Suggestion("dress1", null, "shoe1")));
        var host = Host(model);
        await SeedWardrobeAsync(host);
        var job = await QueueAsync(host, JobKind.StylistOutfit, OutfitInput(language: "en"));

        var stored = await RunAsync(host, job);

        var result = StylingJson.TryDeserialize<OutfitResult>(stored.Result)!;
        Assert.Equal(JobStatus.Completed, stored.Status);
        Assert.Equal([0, 1, 2], result.Suggestions.Select(s => s.Index));
        Assert.All(result.Suggestions, s => Assert.Equal("model", s.Source));
        Assert.Equal("Sakin Ofis", result.Suggestions[0].Title);
        Assert.Equal("en", result.Language);                       // stored with the draft
        Assert.Equal("en", Assert.Single(model.Prompts).Language); // and passed to the prompt builder
    }

    [Fact]
    public async Task Outfit_PromptCarriesOnlyIdsAndAttributes_OfTheCallersOwnWardrobe()
    {
        var model = new FixedModel(Outfits());
        var host = Host(model);
        await SeedWardrobeAsync(host);
        await host.Repository.SaveAsync(new ItemEntity { Id = "other-top", TenantId = Other, Category = ItemCategory.Top, ColorIds = ["red"], Seasons = [Season.Autumn], Name = "Secret", Brand = "Brand" });
        await host.Repository.SaveAsync(new BodyProfileEntity { TenantId = Tenant, HeightCm = 170, WeightKg = 58 });
        var job = await QueueAsync(host, JobKind.StylistOutfit, OutfitInput());

        await RunAsync(host, job);

        var prompt = JsonDocument.Parse(Assert.Single(model.Prompts).InputJson).RootElement;
        var candidates = prompt.GetProperty("candidates").EnumerateArray().ToList();
        Assert.Equal(9, candidates.Count);
        Assert.DoesNotContain(candidates, c => c.GetProperty("id").GetString() == "other-top");
        Assert.All(candidates, c => Assert.Equal(["category", "colorIds", "fabric", "id", "seasons"], c.EnumerateObject().Select(p => p.Name).Order()));
        Assert.Equal("autumn", prompt.GetProperty("season").GetString());
        Assert.Equal(3, prompt.GetProperty("count").GetInt32());
        Assert.DoesNotContain("heightCm", model.Prompts[0].InputJson);
        Assert.DoesNotContain("weightKg", model.Prompts[0].InputJson);
        Assert.DoesNotContain("Secret", model.Prompts[0].InputJson);
    }

    [Fact]
    public async Task Outfit_ItemIdsThatDoNotExist_AreNeverStored_RuleBasedFallbackFillsIn()
    {
        var host = Host(new FixedModel(Outfits(Suggestion("not-mine", "bot1", "shoe1"), Suggestion("top1", "bot1", "shoe1"))));
        await SeedWardrobeAsync(host);
        var job = await QueueAsync(host, JobKind.StylistOutfit, OutfitInput());

        var stored = await RunAsync(host, job);

        var result = StylingJson.TryDeserialize<OutfitResult>(stored.Result)!;
        Assert.Equal(JobStatus.Completed, stored.Status);
        Assert.Equal(3, result.Suggestions.Count);
        Assert.Equal(["model", "rule", "rule"], result.Suggestions.Select(s => s.Source));
        Assert.DoesNotContain("not-mine", stored.Result);
        Assert.Equal(3, result.Suggestions.Select(s => StylistOutputGuard.Signature(s.Slots)).Distinct().Count());
    }

    [Theory]
    [InlineData("""{"looks":[{"itemId":"not-mine"}]}""")]
    [InlineData("I am sorry, here are some ideas...")]
    public async Task Outfit_OutputThatDoesNotMatchTheSchema_IsNeverUsedRaw(string output)
    {
        var host = Host(new FixedModel(output));
        await SeedWardrobeAsync(host);
        var job = await QueueAsync(host, JobKind.StylistOutfit, OutfitInput());

        var stored = await RunAsync(host, job);

        var result = StylingJson.TryDeserialize<OutfitResult>(stored.Result)!;
        Assert.All(result.Suggestions, s => Assert.Equal("rule", s.Source));
        Assert.Equal(3, result.Suggestions.Count);
        Assert.DoesNotContain("not-mine", stored.Result);
    }

    [Fact]
    public async Task Outfit_BodyOrWeightCommentary_GuardRejected_NothingStored()
    {
        var host = Host(new FixedModel(Outfits(Suggestion("top1", "bot1", "shoe1", explanation: "Bu kesim seni daha zayıf gösterir."))));
        await SeedWardrobeAsync(host);
        var job = await QueueAsync(host, JobKind.StylistOutfit, OutfitInput());

        var stored = await RunAsync(host, job);

        Assert.Equal(JobFailure.GuardRejected, stored.Failure);
        Assert.Null(stored.Result);
    }

    [Fact]
    public async Task Outfit_OutOfScopeRefusal_IsPassedOn()
    {
        var host = Host(new FixedModel("""{"suggestions":[],"refusal":"out_of_scope"}"""));
        await SeedWardrobeAsync(host);
        var job = await QueueAsync(host, JobKind.StylistOutfit, OutfitInput());

        var result = StylingJson.TryDeserialize<OutfitResult>((await RunAsync(host, job)).Result)!;

        Assert.Equal(StylistRefusals.OutOfScope, result.Refusal);
        Assert.Empty(result.Suggestions);
    }

    [Fact]
    public async Task Outfit_OnlyMyWardrobe_SuggestionWithAMissingPieceIsReplaced_NeverACatalogProduct()
    {
        const string withMissing = """{"title":"A","explanation":"B","slots":{"top":"top1","bottom":"bot1","outerwear":null,"shoes":"shoe1","bagAccessory":null},"missing":[{"slot":"bagAccessory","category":"bag","productId":"prd1"}]}""";
        var host = Host(new FixedModel(Outfits(withMissing)));
        await SeedWardrobeAsync(host);
        var job = await QueueAsync(host, JobKind.StylistOutfit, OutfitInput(onlyMyWardrobe: true));

        var result = StylingJson.TryDeserialize<OutfitResult>((await RunAsync(host, job)).Result)!;

        Assert.All(result.Suggestions, s => Assert.Empty(s.Missing));
        Assert.All(result.Suggestions, s => Assert.All(s.Slots, slot => Assert.Null(slot.ProductId)));
    }

    [Fact]
    public async Task Outfit_NotOnlyMyWardrobe_NoShoes_FallbackCarriesACatalogSlotPlaceholder()
    {
        var host = Host(new FixedModel("{}"));
        await SeedWardrobeAsync(host, shoes: false);
        var job = await QueueAsync(host, JobKind.StylistOutfit, OutfitInput(onlyMyWardrobe: false));

        var result = StylingJson.TryDeserialize<OutfitResult>((await RunAsync(host, job)).Result)!;

        Assert.All(result.Suggestions, s => Assert.Equal([new MissingPiece(OutfitSlot.Shoes, ItemCategory.Shoes, MissingPieceReason.EmptySlot)], s.Missing));
    }

    [Fact]
    public async Task Outfit_PinnedPiece_IsInEverySuggestion_AndColdWeatherAddsAnOuterLayer()
    {
        var host = Host(new FixedModel("{}"), new FixedWeather(new DailyForecast("2026-11-18", 3, 9, WeatherCondition.Rain)));
        await SeedWardrobeAsync(host);
        var job = await QueueAsync(host, JobKind.StylistOutfit, OutfitInput(pinned: "bot2", cityId: "istanbul"));

        var result = StylingJson.TryDeserialize<OutfitResult>((await RunAsync(host, job)).Result)!;

        Assert.NotEmpty(result.Suggestions);
        Assert.All(result.Suggestions, s => Assert.Contains(new SlotRef(OutfitSlot.Bottom, "bot2"), s.Slots));
        Assert.All(result.Suggestions, s => Assert.Contains(new SlotRef(OutfitSlot.Outerwear, "coat1"), s.Slots));
    }

    [Fact]
    public async Task Outfit_DislikedCombinations_AreSentAsAvoid()
    {
        var model = new FixedModel("{}");
        var host = Host(model);
        await SeedWardrobeAsync(host);
        await host.Repository.SaveAsync(new StylistFeedbackEntity { TenantId = Tenant, JobId = "j0", Index = 1, ItemIds = ["top1", "bot1"], CreatedAt = WorkerTestHost.Now });
        var job = await QueueAsync(host, JobKind.StylistOutfit, OutfitInput());

        await RunAsync(host, job);

        var avoid = JsonDocument.Parse(model.Prompts[0].InputJson).RootElement.GetProperty("avoidCombinations");
        Assert.Equal(["top1", "bot1"], avoid[0].EnumerateArray().Select(e => e.GetString()));
    }

    [Fact]
    public async Task UnsupportedKind_GuardRejected()
    {
        var host = Host(new FixedModel("{}"));
        var job = await host.QueueJobAsync(Tenant, JobKind.StylistComplete);

        Assert.Equal(JobFailure.GuardRejected, (await RunAsync(host, job)).Failure);
    }

    // ── Week ──────────────────────────────────────────────────────────────────────────────────────────────────────

    private static WeekJobInput WeekInput() => new("2026-11-16",
        CalendarDay.Range(new DateOnly(2026, 11, 16), new DateOnly(2026, 11, 22)).Select(d => new WeekDayRequest(d, Occasion.Office)).ToList(),
        true, null, null, null, "tr");

    [Fact]
    public async Task Week_ModelDaysThatPass_AreKept_TheRestComeFromRules_NoLookRepeatsOnConsecutiveDays()
    {
        const string slots = """{"top":"top1","bottom":"bot1","outerwear":null,"shoes":"shoe1","bagAccessory":null}""";
        var output = """
            {"days":[{"date":"2026-11-16","title":"Pzt","explanation":null,"occasion":"office","slots":SLOTS},
                     {"date":"2026-11-17","title":"Sal","explanation":null,"occasion":"office","slots":SLOTS},
                     {"date":"2026-11-18","title":"Çar","explanation":null,"occasion":"office","slots":{"top":"ghost","bottom":"bot1","outerwear":null,"shoes":"shoe1","bagAccessory":null}}],"refusal":null}
            """.Replace("SLOTS", slots);
        var host = Host(new FixedModel(output));
        await SeedWardrobeAsync(host);
        var job = await QueueAsync(host, JobKind.StylistWeek, WeekInput());

        var stored = await RunAsync(host, job);

        var result = StylingJson.TryDeserialize<WeekResult>(stored.Result)!;
        Assert.Equal(JobStatus.Completed, stored.Status);
        Assert.Equal(7, result.Days.Count);
        Assert.All(result.Days, d => Assert.NotNull(d.Outfit));
        Assert.Equal("model", result.Days[0].Outfit!.Source);
        Assert.Equal("rule", result.Days[1].Outfit!.Source); // repeated yesterday's look
        Assert.Equal("rule", result.Days[2].Outfit!.Source); // unknown item id
        Assert.DoesNotContain("ghost", stored.Result);
        for (var i = 1; i < result.Days.Count; i++)
            Assert.NotEqual(StylistOutputGuard.Signature(result.Days[i - 1].Outfit!.Slots), StylistOutputGuard.Signature(result.Days[i].Outfit!.Slots));
        Assert.Empty(await host.Repository.GetKeysAsync(PlanDayEntity.GetPk(Tenant))); // a draft: nothing planned until accepted
        Assert.Empty(await host.Repository.GetKeysAsync(LookEntity.GetPk(Tenant)));
    }

    [Fact]
    public async Task Week_EmptyWardrobe_Refusal()
    {
        var host = Host(new FixedModel("{}"));
        var job = await QueueAsync(host, JobKind.StylistWeek, WeekInput());

        Assert.Equal(StylistRefusals.InsufficientWardrobe, StylingJson.TryDeserialize<WeekResult>((await RunAsync(host, job)).Result)!.Refusal);
    }

    // ── Suitcase ──────────────────────────────────────────────────────────────────────────────────────────────────

    private static async Task<JobEntity> QueuePackAsync(WorkerTestHost host, string start = "2026-12-01", string end = "2026-12-04", bool cabinOnly = false)
    {
        await host.Repository.SaveAsync(new TripEntity
        {
            Id = "trip1", TenantId = Tenant, CityId = "paris", StartDate = start, EndDate = end, TripTypes = [TripType.Business, TripType.Dinner],
            CabinOnly = cabinOnly, CreatedAt = WorkerTestHost.Now, Version = 1,
        });
        return await QueueAsync(host, JobKind.StylistPack, new PackJobInput("trip1", "tr"));
    }

    private static string PackOutput(string[] itemIds, params (string Date, string Top, string Bottom, string Shoes)[] days) =>
        JsonSerializer.Serialize(new
        {
            itemIds,
            days = days.Select(d => new { date = d.Date, title = "Gün", explanation = (string?)null, occasion = "office",
                slots = new { top = d.Top, bottom = d.Bottom, outerwear = (string?)null, shoes = d.Shoes, bagAccessory = (string?)null } }),
            refusal = (string?)null,
        });

    [Fact]
    public async Task Pack_ModelListThatPassesPackingRules_IsUsed()
    {
        var output = PackOutput(["top1", "top2", "bot1", "shoe1"],
            ("2026-12-01", "top1", "bot1", "shoe1"), ("2026-12-02", "top2", "bot1", "shoe1"), ("2026-12-03", "top1", "bot1", "shoe1"), ("2026-12-04", "top2", "bot1", "shoe1"));
        var host = Host(new FixedModel(output));
        await SeedWardrobeAsync(host);
        var job = await QueuePackAsync(host);

        var result = StylingJson.TryDeserialize<PackResult>((await RunAsync(host, job)).Result)!;

        Assert.Equal("model", result.Source);
        Assert.True(result.EveryPieceWornTwice);
        Assert.Equal(["top1", "top2", "bot1", "shoe1"], result.Items.Select(i => i.ItemId));
        Assert.All(result.Items, i => Assert.True(i.PlannedWears >= 2));
        Assert.Equal(4, result.Days.Count);
        Assert.Empty(await host.Repository.GetKeysAsync(TripItemEntity.GetPk(Tenant))); // a draft: the trip is written only on accept
    }

    [Fact]
    public async Task Pack_PieceWornOnlyOnce_ModelListRejected_RuleBasedListUsed()
    {
        var output = PackOutput(["top1", "top2", "bot1", "shoe1"],
            ("2026-12-01", "top1", "bot1", "shoe1"), ("2026-12-02", "top2", "bot1", "shoe1"), ("2026-12-03", "top1", "bot1", "shoe1"), ("2026-12-04", "top1", "bot1", "shoe1"));
        var host = Host(new FixedModel(output));
        await SeedWardrobeAsync(host);
        var job = await QueuePackAsync(host);

        var result = StylingJson.TryDeserialize<PackResult>((await RunAsync(host, job)).Result)!;

        Assert.Equal("rule", result.Source);
        Assert.True(result.EveryPieceWornTwice);
        Assert.All(result.Items, i => Assert.True(i.PlannedWears >= 2));
        Assert.Equal(Occasion.Office, result.Days[0].Occasion);
        Assert.Equal(Occasion.Dinner, result.Days[1].Occasion);
    }

    [Fact]
    public async Task Pack_OneDayTrip_NoWornTwiceClaim()
    {
        var host = Host(new FixedModel("{}"));
        await SeedWardrobeAsync(host);
        var job = await QueuePackAsync(host, "2026-12-01", "2026-12-01");

        var result = StylingJson.TryDeserialize<PackResult>((await RunAsync(host, job)).Result)!;

        Assert.Single(result.Days);
        Assert.False(result.EveryPieceWornTwice);
        Assert.All(result.Items, i => Assert.Equal(1, i.PlannedWears));
    }

    [Fact]
    public async Task Pack_RainAndNoOuterwearOrShoes_MissingPiecesAreCatalogSlotPlaceholders()
    {
        var host = Host(new FixedModel("{}"), new FixedWeather(new DailyForecast("2026-12-02", 6, 11, WeatherCondition.Rain)));
        await SeedWardrobeAsync(host, shoes: false);
        await host.Repository.DeleteAsync(ItemEntity.GetPk(Tenant), ItemEntity.GetSk("coat1"));
        var job = await QueuePackAsync(host);

        var result = StylingJson.TryDeserialize<PackResult>((await RunAsync(host, job)).Result)!;

        Assert.Equal(
            [new MissingPiece(OutfitSlot.Shoes, ItemCategory.Shoes, MissingPieceReason.NoShoes), new MissingPiece(OutfitSlot.Outerwear, ItemCategory.Outerwear, MissingPieceReason.Rain)],
            result.Missing);
        Assert.NotEmpty(result.Items);
    }

    [Fact]
    public async Task Pack_TripDeleted_SourceDeleted_And_EmptyWardrobe_Refusal()
    {
        var host = Host(new FixedModel("{}"));
        var orphan = await QueueAsync(host, JobKind.StylistPack, new PackJobInput("gone", "tr"));
        Assert.Equal(JobFailure.SourceDeleted, (await RunAsync(host, orphan)).Failure);

        var job = await QueuePackAsync(host);
        Assert.Equal(StylistRefusals.InsufficientWardrobe, StylingJson.TryDeserialize<PackResult>((await RunAsync(host, job)).Result)!.Refusal);
    }
}
