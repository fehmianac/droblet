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

    // ── Gap filling (owner decision 3): a thin wardrobe still gets complete outfits ────────────────────────────────

    private static bool Complete(SuggestedOutfit outfit)
    {
        var slots = outfit.Slots.Select(s => s.Slot).Concat(outfit.Missing.Select(m => m.Slot)).ToList();
        var dress = outfit.Missing.Any(m => m.Category == ItemCategory.Dress);
        return slots.Contains(OutfitSlot.Top) && (dress || slots.Contains(OutfitSlot.Bottom)) && slots.Contains(OutfitSlot.Shoes);
    }

    private sealed class FixedLibrary(params LibraryItemEntity[] items) : ILibraryCatalog
    {
        public Task<IReadOnlyList<LibraryItemEntity>> GetAllAsync(CancellationToken ct) => Task.FromResult<IReadOnlyList<LibraryItemEntity>>(items);
    }

    private static LibraryItemEntity Lib(string id, ItemCategory category, string color = "black") => new()
    {
        Id = id, Name = new() { ["tr"] = id }, Category = category, ColorIds = [color],
        Seasons = [Season.Spring, Season.Summer, Season.Autumn, Season.Winter],
    };

    private static WorkerTestHost FillHost(IStylistModel model, ILibraryCatalog library) => new(s =>
    {
        s.AddSingleton<IStylistJobService, StylistJobService>();
        s.RemoveAll<IStylistModel>();
        s.AddSingleton(model);
        s.RemoveAll<ILibraryCatalog>();
        s.AddSingleton(library);
    });

    private static Task AddItemAsync(WorkerTestHost host, string id, ItemCategory category, string color = "black") =>
        host.Repository.SaveAsync(new ItemEntity
        {
            Id = id, TenantId = Tenant, Category = category, ColorIds = [color],
            Seasons = [Season.Spring, Season.Summer, Season.Autumn, Season.Winter], CreatedAt = WorkerTestHost.Now, Version = 1,
        });

    [Fact]
    public async Task Outfit_EmptyWardrobe_CompleteOutfitsFromTheLibrary_WithoutCallingTheModel()
    {
        var model = new FixedModel(Outfits());
        var host = Host(model); // the real (embedded) library seed
        var job = await QueueAsync(host, JobKind.StylistOutfit, OutfitInput());

        var stored = await RunAsync(host, job);

        var result = StylingJson.TryDeserialize<OutfitResult>(stored.Result)!;
        Assert.Equal(JobStatus.Completed, stored.Status);
        Assert.Null(result.Refusal);
        Assert.True(result.GapFilled);
        Assert.Equal(3, result.Suggestions.Count);
        Assert.All(result.Suggestions, s => Assert.Empty(s.Slots));                                   // nothing claimed as owned
        Assert.All(result.Suggestions, s => Assert.All(s.Missing, m => Assert.NotNull(m.LibraryItemId)));
        Assert.All(result.Suggestions, s => Assert.True(Complete(s)));
        Assert.Equal(3, result.Suggestions.Select(GapFill.Signature).Distinct().Count());
        Assert.Empty(model.Prompts);
    }

    [Fact]
    public async Task Outfit_TwoPieceWardrobe_OwnPiecesStay_TheGapsAreFilledFromTheLibrary()
    {
        var host = FillHost(new FixedModel(Outfits()), new FixedLibrary(
            Lib("lib-black-trousers", ItemCategory.Bottom), Lib("lib-blue-jeans", ItemCategory.Bottom, "denim"),
            Lib("lib-red-skirt", ItemCategory.Bottom, "red"), Lib("lib-white-sneakers", ItemCategory.Shoes, "white")));
        await AddItemAsync(host, "mytop", ItemCategory.Top, "green");
        await AddItemAsync(host, "myshoes", ItemCategory.Shoes);
        var job = await QueueAsync(host, JobKind.StylistOutfit, OutfitInput(onlyMyWardrobe: true));

        var result = StylingJson.TryDeserialize<OutfitResult>((await RunAsync(host, job)).Result)!;

        Assert.Null(result.Refusal);
        Assert.True(result.GapFilled);
        Assert.NotEmpty(result.Suggestions);
        Assert.All(result.Suggestions, s => Assert.True(Complete(s)));
        Assert.All(result.Suggestions, s => Assert.Contains(new SlotRef(OutfitSlot.Shoes, "myshoes"), s.Slots)); // own shoes kept, no library pair
        var first = result.Suggestions[0];
        Assert.Contains(new SlotRef(OutfitSlot.Top, "mytop"), first.Slots);
        var bottom = Assert.Single(first.Missing);
        Assert.Equal(OutfitSlot.Bottom, bottom.Slot);
        // Colour harmony: the green top goes with neutrals (black trousers, denim jeans) before a red skirt.
        Assert.Contains(bottom.LibraryItemId, new[] { "lib-black-trousers", "lib-blue-jeans" });
        Assert.DoesNotContain(result.Suggestions.SelectMany(s => s.Missing), m => m.LibraryItemId == "lib-white-sneakers");
    }

    [Fact]
    public async Task Outfit_LibraryHasNoShoes_TheShopFillsThatSlot_InTheBudgetBand()
    {
        var host = FillHost(new FixedModel(Outfits()), new FixedLibrary(Lib("lib-black-trousers", ItemCategory.Bottom)));
        await AddItemAsync(host, "mytop", ItemCategory.Top);
        await host.Repository.SaveAsync(new StyleProfileEntity { TenantId = Tenant, Budget = Budget.HighStreet });
        async Task Product(string id, PriceBand band) => await host.Repository.SaveAsync(new CatalogProductEntity
        {
            Id = id, BrandId = "b1", Name = new() { ["tr"] = id }, Category = ProductCategory.Shoes, Colors = ["black"], PriceBand = band,
            PriceMinor = 100_00, CreatedAt = WorkerTestHost.Now,
        });
        await Product("p-lux-shoes", PriceBand.LuxuryTouch);
        await Product("p-street-shoes", PriceBand.HighStreet);
        var job = await QueueAsync(host, JobKind.StylistOutfit, OutfitInput());

        var result = StylingJson.TryDeserialize<OutfitResult>((await RunAsync(host, job)).Result)!;

        Assert.True(result.GapFilled);
        var outfit = result.Suggestions[0];
        Assert.True(Complete(outfit));
        Assert.Contains(outfit.Missing, m => m is { Slot: OutfitSlot.Bottom, LibraryItemId: "lib-black-trousers" });
        Assert.Contains(outfit.Missing, m => m is { Slot: OutfitSlot.Shoes, ProductId: "p-street-shoes", LibraryItemId: null });
        Assert.DoesNotContain(result.Suggestions.SelectMany(s => s.Missing), m => m.ProductId == "p-lux-shoes");
    }

    [Fact]
    public async Task Outfit_NoLibraryAndNoCatalog_RefusalStaysInternalOnly()
    {
        var host = FillHost(new FixedModel(Outfits()), new FixedLibrary());
        await AddItemAsync(host, "mytop", ItemCategory.Top);
        var job = await QueueAsync(host, JobKind.StylistOutfit, OutfitInput());

        var result = StylingJson.TryDeserialize<OutfitResult>((await RunAsync(host, job)).Result)!;

        Assert.Equal(StylistRefusals.InsufficientWardrobe, result.Refusal);
        Assert.False(result.GapFilled);
        Assert.Empty(result.Suggestions);
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

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Outfit_NoShoesInTheWardrobe_EveryLookGetsALibraryPair(bool onlyMyWardrobe)
    {
        var host = Host(new FixedModel("{}"));
        await SeedWardrobeAsync(host, shoes: false);
        var job = await QueueAsync(host, JobKind.StylistOutfit, OutfitInput(onlyMyWardrobe: onlyMyWardrobe));

        var result = StylingJson.TryDeserialize<OutfitResult>((await RunAsync(host, job)).Result)!;

        Assert.True(result.GapFilled);
        Assert.Equal(3, result.Suggestions.Count);
        Assert.All(result.Suggestions, s =>
        {
            var shoes = Assert.Single(s.Missing, m => m.Slot == OutfitSlot.Shoes);
            Assert.Equal(ItemCategory.Shoes, shoes.Category);
            Assert.StartsWith("lib-", shoes.LibraryItemId);
        });
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

    /// <summary>Answers each week batch with one look per asked date (from the prompt), all calls held until every batch has started.</summary>
    private sealed class BatchModel(int expectedBatches, Func<string, int, string?> slotsFor, int? failBatch = null) : IStylistModel
    {
        private readonly TaskCompletionSource _allStarted = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private int _started;
        public List<List<string>> Batches { get; } = [];

        public async Task<string> GenerateAsync(StylistPrompt prompt, CancellationToken ct)
        {
            var dates = JsonDocument.Parse(prompt.InputJson).RootElement.GetProperty("days").EnumerateArray()
                .Select(d => d.GetProperty("date").GetString()!).ToList();
            int index;
            lock (Batches)
            {
                index = Batches.Count;
                Batches.Add(dates);
            }
            if (Interlocked.Increment(ref _started) == expectedBatches)
                _allStarted.SetResult();
            // Parallel: no batch answers before all of them were requested.
            await _allStarted.Task.WaitAsync(TimeSpan.FromSeconds(5), ct);
            if (index == failBatch)
                throw new AiProviderException("batch failed");
            var days = dates.Select((d, i) => slotsFor(d, i) is { } slots
                ? $$"""{"date":"{{d}}","title":"Gün","explanation":null,"occasion":"office","slots":{{slots}}}"""
                : null).Where(d => d is not null);
            return $$"""{"days":[{{string.Join(',', days)}}],"refusal":null}""";
        }
    }

    private static string Slots(string top, string bottom, string shoes) =>
        $$"""{"top":"{{top}}","bottom":"{{bottom}}","outerwear":null,"shoes":"{{shoes}}","bagAccessory":null}""";

    [Fact]
    public async Task Week_IsPlannedInParallelBatches_3_2_2_EachWithItsOwnDates_AndTheSameCandidates()
    {
        string[] looks = [Slots("top1", "bot1", "shoe1"), Slots("top2", "bot2", "shoe2"), Slots("top1", "bot2", "shoe1"), Slots("top2", "bot1", "shoe2"),
            Slots("top1", "bot1", "shoe2"), Slots("top2", "bot2", "shoe1"), Slots("top1", "bot2", "shoe2")];
        var model = new BatchModel(3, (date, _) => looks[int.Parse(date[^2..]) - 16]);
        var host = Host(model);
        await SeedWardrobeAsync(host);
        var job = await QueueAsync(host, JobKind.StylistWeek, WeekInput());

        var stored = await RunAsync(host, job);

        var result = StylingJson.TryDeserialize<WeekResult>(stored.Result)!;
        Assert.Equal(JobStatus.Completed, stored.Status);
        Assert.Equal([3, 2, 2], model.Batches.OrderBy(b => b[0]).Select(b => b.Count));
        Assert.Equal(WeekInput().Days.Select(d => d.Date), model.Batches.OrderBy(b => b[0]).SelectMany(b => b));
        Assert.All(result.Days, d => Assert.Equal("model", d.Outfit!.Source));
    }

    [Fact]
    public async Task Week_RepeatsAcrossBatches_AreFixedByTheConsistencyPass()
    {
        // Every batch proposes the same look for its first day: Monday keeps it, Thursday and Saturday (other batches) get another one.
        var model = new BatchModel(3, (_, i) => i == 0 ? Slots("top1", "bot1", "shoe1") : Slots("top2", "bot2", "shoe2"));
        var host = Host(model);
        await SeedWardrobeAsync(host);
        var job = await QueueAsync(host, JobKind.StylistWeek, WeekInput());

        var result = StylingJson.TryDeserialize<WeekResult>((await RunAsync(host, job)).Result)!;

        var signatures = result.Days.Select(d => GapFill.RawSignature(d.Outfit!)).ToList();
        Assert.Equal("model", result.Days[0].Outfit!.Source);
        Assert.Equal(1, signatures.Count(s => s == signatures[0])); // the batch-first look appears once
        for (var i = 1; i < signatures.Count; i++)
            Assert.NotEqual(signatures[i - 1], signatures[i]);
    }

    [Fact]
    public async Task Week_AFailedBatch_IsDressedByTheRules_TheOthersKeepTheModelLooks()
    {
        string[] looks = [Slots("top1", "bot1", "shoe1"), Slots("top2", "bot2", "shoe2"), Slots("top1", "bot2", "shoe1"), Slots("top2", "bot1", "shoe2"),
            Slots("top1", "bot1", "shoe2"), Slots("top2", "bot2", "shoe1"), Slots("top1", "bot2", "shoe2")];
        var model = new BatchModel(3, (date, _) => looks[int.Parse(date[^2..]) - 16], failBatch: 1);
        var host = Host(model);
        await SeedWardrobeAsync(host);
        var job = await QueueAsync(host, JobKind.StylistWeek, WeekInput());

        var stored = await RunAsync(host, job);

        var result = StylingJson.TryDeserialize<WeekResult>(stored.Result)!;
        Assert.Equal(JobStatus.Completed, stored.Status);
        Assert.Equal(7, result.Days.Count);
        Assert.All(result.Days, d => Assert.NotNull(d.Outfit));
        var failedDates = model.Batches[1];
        Assert.All(result.Days.Where(d => failedDates.Contains(d.Date)), d => Assert.Equal("rule", d.Outfit!.Source));
        Assert.Contains(result.Days, d => d.Outfit!.Source == "model");
    }

    [Fact]
    public async Task Week_EveryBatchFailing_FailsTheJob()
    {
        var host = Host(new BatchModel(1, (_, _) => null, failBatch: 0));
        host.Get<Microsoft.Extensions.Options.IOptionsMonitor<Domain.Options.StylistOptions>>().CurrentValue.WeekBatchDays = 0;
        await SeedWardrobeAsync(host);
        var job = await QueueAsync(host, JobKind.StylistWeek, WeekInput());

        var stored = await RunAsync(host, job);

        Assert.Equal(JobStatus.Failed, stored.Status);
        Assert.Equal(JobFailure.ProviderError, stored.Failure);
    }

    [Fact]
    public async Task Week_EmptyWardrobe_EveryDayDressedFromTheLibrary_NoRepeatOnConsecutiveDays()
    {
        var model = new FixedModel("{}");
        var host = Host(model);
        var job = await QueueAsync(host, JobKind.StylistWeek, WeekInput());

        var result = StylingJson.TryDeserialize<WeekResult>((await RunAsync(host, job)).Result)!;

        Assert.Null(result.Refusal);
        Assert.True(result.GapFilled);
        Assert.Equal(7, result.Days.Count);
        Assert.All(result.Days, d => Assert.True(Complete(d.Outfit!)));
        for (var i = 1; i < result.Days.Count; i++)
            Assert.NotEqual(GapFill.Signature(result.Days[i - 1].Outfit!), GapFill.Signature(result.Days[i].Outfit!));
        Assert.Empty(model.Prompts);
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
    public async Task Pack_OfficeAndDinnerInTheSameLook_ModelListRejected_RuleBasedListUsed()
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
    public async Task Pack_ThreeDayBusinessAndDinner_RuleCapsule_GivesDinnerItsOwnLook_AndTheModelGetsTheCapsule()
    {
        var model = new FixedModel("{}");
        var host = Host(model, new FixedWeather(new DailyForecast("2026-12-02", 4, 9, WeatherCondition.Rain)));
        await SeedWardrobeAsync(host);
        await host.Repository.SaveAsync(new ItemEntity
        {
            Id = "top3", TenantId = Tenant, Category = ItemCategory.Top, ColorIds = ["white"],
            Seasons = [Season.Spring, Season.Summer, Season.Autumn, Season.Winter], CreatedAt = WorkerTestHost.Now, Version = 1,
        });
        var job = await QueuePackAsync(host, "2026-12-01", "2026-12-03");

        var result = StylingJson.TryDeserialize<PackResult>((await RunAsync(host, job)).Result)!;

        Assert.Equal("rule", result.Source);
        Assert.InRange(result.Items.Count, 6, 9);
        Assert.Equal([Occasion.Office, Occasion.Dinner, Occasion.Office], result.Days.Select(d => d.Occasion));
        string TopOf(PackDay day) => day.Slots.Single(s => s.Slot == OutfitSlot.Top).ItemId!;
        Assert.DoesNotContain(TopOf(result.Days[1]), new[] { TopOf(result.Days[0]), TopOf(result.Days[2]) });
        Assert.Contains(result.Days[1].Slots, s => s is { Slot: OutfitSlot.Outerwear, ItemId: "coat1" });   // the rainy day
        Assert.DoesNotContain(result.Days[0].Slots, s => s.Slot == OutfitSlot.Outerwear);
        Assert.Contains(result.Items, i => i.PlannedWears == 3);                                             // re-worn pieces

        var input = Assert.Single(model.Prompts).InputJson;
        Assert.Contains("\"capsule\":{", input);
        Assert.Contains("\"minRewearRatio\":1.5", input);
        Assert.Contains("\"outerLayer\":true", input);
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

        // The placeholders keep their reason and now name a concrete library piece of that category.
        Assert.Equal([(OutfitSlot.Shoes, MissingPieceReason.NoShoes), (OutfitSlot.Outerwear, MissingPieceReason.Rain)], result.Missing.Select(m => (m.Slot, m.Reason)));
        Assert.All(result.Missing, m => Assert.StartsWith("lib-", m.LibraryItemId));
        Assert.True(result.GapFilled);
        Assert.NotEmpty(result.Items);
    }

    [Fact]
    public async Task Pack_TripDeleted_SourceDeleted_And_EmptyWardrobe_Refusal()
    {
        var host = Host(new FixedModel("{}"));
        var orphan = await QueueAsync(host, JobKind.StylistPack, new PackJobInput("gone", "tr"));
        Assert.Equal(JobFailure.SourceDeleted, (await RunAsync(host, orphan)).Failure);

        var job = await QueuePackAsync(host);
        var result = StylingJson.TryDeserialize<PackResult>((await RunAsync(host, job)).Result)!;
        // An empty wardrobe is packed with picked library pieces: nothing in the packing list, all of it suggested.
        Assert.Null(result.Refusal);
        Assert.True(result.GapFilled);
        Assert.Empty(result.Items);
        Assert.Contains(result.Missing, m => m.Slot == OutfitSlot.Top && m.LibraryItemId is not null);
        Assert.Contains(result.Missing, m => m.Slot == OutfitSlot.Shoes && m.LibraryItemId is not null);
        Assert.DoesNotContain(result.Days.SelectMany(d => d.Slots), s => GapFill.IsPicked(s.ItemId));
    }

    // ── Cabin-only limit (Packing:CabinMaxItems) ──────────────────────────────────────────────────────────────────

    private static WorkerTestHost CabinHost(FixedModel model, int limit) => new(s =>
    {
        s.AddSingleton<IStylistJobService, StylistJobService>();
        s.RemoveAll<IStylistModel>();
        s.AddSingleton<IStylistModel>(model);
        s.Configure<Domain.Options.PackingOptions>(o => o.CabinMaxItems = limit);
    });

    private static readonly string SixPieceList = JsonSerializer.Serialize(new
    {
        itemIds = new[] { "top1", "top2", "bot1", "bot2", "shoe1", "bag1" },
        days = new[] { "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04" }.Select((date, i) => new
        {
            date, title = "Gün", explanation = (string?)null, occasion = "office",
            slots = new { top = i % 2 == 0 ? "top1" : "top2", bottom = i % 2 == 0 ? "bot1" : "bot2", outerwear = (string?)null, shoes = "shoe1", bagAccessory = "bag1" },
        }),
        refusal = (string?)null,
    });

    [Fact]
    public async Task Pack_CabinOnly_ModelListAtTheLimit_IsKept_AndTheLimitIsReported()
    {
        var model = new FixedModel(SixPieceList);
        var host = CabinHost(model, limit: 6);
        await SeedWardrobeAsync(host);
        var job = await QueuePackAsync(host, cabinOnly: true);

        var result = StylingJson.TryDeserialize<PackResult>((await RunAsync(host, job)).Result)!;

        Assert.Equal(("model", 6, false), (result.Source, result.CabinLimit, result.CabinTrimmed));
        Assert.Equal(6, result.Items.Count);
        Assert.Empty(result.DroppedItemIds!);
        Assert.Contains("\"cabinMaxItems\":6", Assert.Single(model.Prompts).InputJson); // the model is asked for at most that many
    }

    [Fact]
    public async Task Pack_CabinOnly_ModelListOverTheLimit_IsTrimmedByRule_AndReportsWhatWasDropped()
    {
        var host = CabinHost(new FixedModel(SixPieceList), limit: 4);
        await SeedWardrobeAsync(host);
        var job = await QueuePackAsync(host, cabinOnly: true);

        var result = StylingJson.TryDeserialize<PackResult>((await RunAsync(host, job)).Result)!;

        Assert.Equal(("model", 4, true), (result.Source, result.CabinLimit, result.CabinTrimmed));
        Assert.Equal(["top1", "bot1", "shoe1", "bag1"], result.Items.Select(i => i.ItemId));
        Assert.Equal(["top2", "bot2"], result.DroppedItemIds);
        Assert.True(result.EveryPieceWornTwice);
        Assert.All(result.Days, d => Assert.Equal(4, d.Slots.Count));
    }

    [Fact]
    public async Task Pack_CabinOnly_ZeroLimit_IsNotEnforced_AndANormalTripHasNoLimit()
    {
        var unlimitedHost = CabinHost(new FixedModel(SixPieceList), limit: 0);
        await SeedWardrobeAsync(unlimitedHost);
        var unlimited = StylingJson.TryDeserialize<PackResult>((await RunAsync(unlimitedHost, await QueuePackAsync(unlimitedHost, cabinOnly: true))).Result)!;

        var normalModel = new FixedModel(SixPieceList);
        var normalHost = CabinHost(normalModel, limit: 2);
        await SeedWardrobeAsync(normalHost);
        var normal = StylingJson.TryDeserialize<PackResult>((await RunAsync(normalHost, await QueuePackAsync(normalHost, cabinOnly: false))).Result)!;

        Assert.Equal(((int?)null, false, 6), (unlimited.CabinLimit, unlimited.CabinTrimmed, unlimited.Items.Count));
        Assert.Equal(((int?)null, false, 6), (normal.CabinLimit, normal.CabinTrimmed, normal.Items.Count));
        Assert.Contains("\"cabinMaxItems\":0", Assert.Single(normalModel.Prompts).InputJson);
    }

    [Fact]
    public async Task Pack_CabinOnly_OneDayTrip_RuleBasedListStaysWithinTheLimit()
    {
        var host = CabinHost(new FixedModel("{}"), limit: 3);
        await SeedWardrobeAsync(host);
        var job = await QueuePackAsync(host, "2026-12-01", "2026-12-01", cabinOnly: true);

        var result = StylingJson.TryDeserialize<PackResult>((await RunAsync(host, job)).Result)!;

        Assert.Equal(("rule", 3), (result.Source, result.CabinLimit));
        Assert.True(result.Items.Count <= 3);
        Assert.True(result.CabinTrimmed);          // without the limit the rule would also have packed a bag
        Assert.False(result.EveryPieceWornTwice);
        Assert.Single(result.Days);
    }

    [Fact]
    public async Task Pack_CabinOnly_DefaultLimitIs12()
    {
        var host = Host(new FixedModel(SixPieceList));
        await SeedWardrobeAsync(host);
        var job = await QueuePackAsync(host, cabinOnly: true);

        var result = StylingJson.TryDeserialize<PackResult>((await RunAsync(host, job)).Result)!;

        Assert.Equal((12, false, "model"), (result.CabinLimit, result.CabinTrimmed, result.Source));
    }
}
