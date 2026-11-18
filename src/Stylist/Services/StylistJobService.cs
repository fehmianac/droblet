using Domain.Domain;
using Domain.Entity;
using Domain.Enum;
using Domain.Events;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Domain.Services.Ai;
using Domain.Services.Styling;
using Infrastructure.Workers;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Stylist.Services;

public interface IStylistJobService
{
    Task ProcessAsync(StylistRequestedEvent message, bool isLastAttempt, CancellationToken ct);
}

/// <summary>
/// Outfit ×3 / week plan / suitcase drafts. Flow per job:
///   1. candidates are selected on the server (StylistCandidateSelector) — the model sees ids + attributes only:
///      no photo, no name, no e-mail, no height / weight, no location (just the weather summary);
///   2. a wardrobe that cannot dress a single day is answered without calling the model (refusal insufficient_wardrobe);
///   3. model output is accepted only through StylistOutputGuard / PackingRules — never repaired;
///      what fails is replaced by the rule-based fallback, so the user always gets a result;
///   4. body / weight commentary in any text fails the job (GuardRejected);
///   5. the result is a draft: Look / PlanDay / Trip rows are written only by the accept endpoints.
/// Provider failure -> Failed(ProviderError). Text jobs reserve no credit.
/// </summary>
public sealed class StylistJobService(
    IJobLifecycle jobs,
    IRepository repository,
    IStylistModel model,
    IWeatherService weather,
    IOptionsMonitor<StylistOptions> stylistOptions,
    IOptionsMonitor<PackingOptions> packingOptions,
    ILogger<StylistJobService> logger) : IStylistJobService
{
    private sealed record Outcome(string? Result, JobFailure? Failure = null)
    {
        public static Outcome Fail(JobFailure failure) => new(null, failure);
    }

    public async Task ProcessAsync(StylistRequestedEvent message, bool isLastAttempt, CancellationToken ct)
    {
        var job = await jobs.StartAsync(message.TenantId, message.JobId, ct);
        if (job is null)
            return;

        try
        {
            var outcome = job.Kind switch
            {
                JobKind.StylistOutfit => await OutfitAsync(job, ct),
                JobKind.StylistWeek => await WeekAsync(job, ct),
                JobKind.StylistPack => await PackAsync(job, ct),
                // No guard exists for this kind yet: output is rejected, never used raw.
                _ => Outcome.Fail(JobFailure.GuardRejected),
            };

            if (outcome.Result is null)
                await jobs.FailAsync(job, outcome.Failure ?? JobFailure.GuardRejected, ct);
            else
                await jobs.CompleteAsync(job, outcome.Result, ct);
        }
        catch (Exception ex) when (!WorkerFailure.IsRetryable(ex, isLastAttempt))
        {
            logger.LogWarning(ex, "Stylist job {JobId} ({Kind}) failed for tenant {TenantId}", job.Id, job.Kind, job.TenantId);
            await jobs.FailAsync(job, JobFailure.ProviderError, ct);
        }
    }

    // ── Outfit ────────────────────────────────────────────────────────────────────────────────────────────────────

    private async Task<Outcome> OutfitAsync(JobEntity job, CancellationToken ct)
    {
        var input = StylingJson.TryDeserialize<OutfitJobInput>(job.Input);
        if (input is null || !CalendarDay.TryParse(input.Date, out var date))
            return Outcome.Fail(JobFailure.GuardRejected);

        var settings = stylistOptions.CurrentValue;
        var language = Localized.Language(input.Language);
        var wardrobe = await WardrobeAsync(job.TenantId, ct);
        var forecast = (await ForecastAsync(input.CityId, input.Latitude, input.Longitude, input.Date, input.Date, ct)).FirstOrDefault();
        var season = SeasonRules.For(date);
        var candidates = StylistCandidateSelector.Select(wardrobe, new CandidateCriteria(
            new HashSet<Season> { season }, input.Occasion, forecast is null ? null : WeatherRules.WholeDegrees(forecast.MaxC), false, settings.MaxCandidates, settings.HotFromC, input.PinnedItemId));

        OutfitResult Result(string? refusal, IReadOnlyList<SuggestedOutfit> suggestions) =>
            new(input.Date, input.Occasion, input.OnlyMyWardrobe, refusal, suggestions, language);

        var ruleOptions = new RuleOutfitOptions(input.PinnedItemId, WantsOuterLayer(forecast, settings), input.OnlyMyWardrobe);
        if (RuleBasedOutfit.Build(candidates, 1, ruleOptions).Count == 0)
            return new Outcome(StylingJson.Serialize(Result(StylistRefusals.InsufficientWardrobe, [])));

        var prompt = StylingJson.Serialize(new
        {
            date = input.Date,
            season,
            occasion = input.Occasion,
            weather = forecast is null ? null : new { MinTempC = WeatherRules.WholeDegrees(forecast.MinC), MaxTempC = WeatherRules.WholeDegrees(forecast.MaxC), forecast.Condition },
            freeText = input.FreeText,
            onlyMyWardrobe = input.OnlyMyWardrobe,
            pinnedItemId = input.PinnedItemId,
            language,
            count = settings.SuggestionCount,
            styleProfile = await StyleAsync(job.TenantId, ct),
            palette = await PaletteAsync(job.TenantId, ct),
            avoidCombinations = await DislikedAsync(job.TenantId, settings.DislikeMemory, ct),
            candidates = candidates.Select(Describe),
            productCandidates = Array.Empty<object>(), // filled by the catalog module ("Parçamı tamamla")
        });

        var output = StylingJson.TryDeserialize<ModelOutfitOutput>(await model.GenerateAsync(new StylistPrompt(JobKind.StylistOutfit, prompt, language), ct));
        if (StylistOutputGuard.ViolatesContentPolicy(StylistOutputGuard.Texts(output)))
            return Outcome.Fail(JobFailure.GuardRejected);
        if (output?.Refusal == StylistRefusals.OutOfScope)
            return new Outcome(StylingJson.Serialize(Result(StylistRefusals.OutOfScope, [])));

        var context = GuardContext.For(candidates, input.OnlyMyWardrobe, input.PinnedItemId, settings.MaxTitleLength, settings.MaxExplanationLength);
        var suggestions = StylistOutputGuard.AcceptDistinct(output?.Suggestions, context, settings.SuggestionCount).ToList();
        if (suggestions.Count < settings.SuggestionCount)
        {
            var taken = suggestions.Select(s => StylistOutputGuard.Signature(s.Slots)).ToHashSet(StringComparer.Ordinal);
            suggestions.AddRange(RuleBasedOutfit.Build(candidates, settings.SuggestionCount - suggestions.Count, ruleOptions with { ExcludeSignatures = taken }));
        }

        return new Outcome(StylingJson.Serialize(Result(null, suggestions.Select((s, i) => s with { Index = i }).ToList())));
    }

    // ── Week ──────────────────────────────────────────────────────────────────────────────────────────────────────

    private async Task<Outcome> WeekAsync(JobEntity job, CancellationToken ct)
    {
        var input = StylingJson.TryDeserialize<WeekJobInput>(job.Input);
        if (input is null || input.Days.Count == 0 || input.Days.Any(d => !CalendarDay.IsValid(d.Date)))
            return Outcome.Fail(JobFailure.GuardRejected);

        var settings = stylistOptions.CurrentValue;
        var language = Localized.Language(input.Language);
        var dates = input.Days.Select(d => d.Date).ToList();
        var wardrobe = await WardrobeAsync(job.TenantId, ct);
        var forecast = (await ForecastAsync(input.CityId, input.Latitude, input.Longitude, dates.Min()!, dates.Max()!, ct))
            .GroupBy(f => f.Date, StringComparer.Ordinal).ToDictionary(g => g.Key, g => g.First(), StringComparer.Ordinal);
        var seasons = dates.Select(d => SeasonRules.For(CalendarDay.Parse(d))).ToHashSet();
        var candidates = StylistCandidateSelector.Select(wardrobe, new CandidateCriteria(seasons, null, null, false, settings.MaxCandidates, settings.HotFromC));

        if (RuleBasedOutfit.Build(candidates, 1).Count == 0)
            return new Outcome(StylingJson.Serialize(new WeekResult(input.WeekStart, StylistRefusals.InsufficientWardrobe, [], language)));

        var prompt = StylingJson.Serialize(new
        {
            weekStart = input.WeekStart,
            language,
            days = input.Days.Select(d => new
            {
                d.Date,
                d.Occasion,
                weather = forecast.TryGetValue(d.Date, out var f) ? new { MinTempC = WeatherRules.WholeDegrees(f.MinC), MaxTempC = WeatherRules.WholeDegrees(f.MaxC), f.Condition } : null,
            }),
            styleProfile = await StyleAsync(job.TenantId, ct),
            candidates = candidates.Select(Describe),
        });

        var output = StylingJson.TryDeserialize<ModelWeekOutput>(await model.GenerateAsync(new StylistPrompt(JobKind.StylistWeek, prompt, language), ct));
        if (StylistOutputGuard.ViolatesContentPolicy(StylistOutputGuard.Texts(output?.Days)))
            return Outcome.Fail(JobFailure.GuardRejected);

        var accepted = StylistOutputGuard.AcceptWeek(output, dates, GuardContext.For(candidates, true, null, settings.MaxTitleLength, settings.MaxExplanationLength));
        var plan = new List<WeekDayPlan>();
        string? previous = null;
        for (var i = 0; i < input.Days.Count; i++)
        {
            var day = input.Days[i];
            if (!accepted.TryGetValue(day.Date, out var outfit))
            {
                var exclude = previous is null ? null : new HashSet<string>(StringComparer.Ordinal) { previous };
                var wantsOuter = WantsOuterLayer(forecast.GetValueOrDefault(day.Date), settings);
                outfit = RuleBasedOutfit.Build(candidates, 1, new RuleOutfitOptions(null, wantsOuter, true, i, exclude)).FirstOrDefault();
            }

            previous = outfit is null ? null : StylistOutputGuard.Signature(outfit.Slots);
            plan.Add(new WeekDayPlan(day.Date, day.Occasion, outfit is null ? null : outfit with { Index = i }));
        }

        return new Outcome(StylingJson.Serialize(new WeekResult(input.WeekStart, null, plan, language)));
    }

    // ── Suitcase ──────────────────────────────────────────────────────────────────────────────────────────────────

    private async Task<Outcome> PackAsync(JobEntity job, CancellationToken ct)
    {
        var input = StylingJson.TryDeserialize<PackJobInput>(job.Input);
        var trip = input is null ? null : await repository.GetAsync<TripEntity>(TripEntity.GetPk(job.TenantId), TripEntity.GetSk(input.TripId), ct);
        if (input is null || trip is null || !CalendarDay.TryParse(trip.StartDate, out var start) || !CalendarDay.TryParse(trip.EndDate, out var end))
            return Outcome.Fail(JobFailure.SourceDeleted);

        var settings = stylistOptions.CurrentValue;
        var packing = packingOptions.CurrentValue;
        var language = Localized.Language(input.Language);
        var dates = CalendarDay.Range(start, end);
        if (dates.Count == 0 || dates.Count > packing.MaxTripDays)
            return Outcome.Fail(JobFailure.GuardRejected);

        var wardrobe = await WardrobeAsync(job.TenantId, ct);
        var forecast = await ForecastAsync(trip.CityId, null, null, trip.StartDate, trip.EndDate, ct);
        var seasons = dates.Select(d => SeasonRules.For(CalendarDay.Parse(d))).ToHashSet();
        var maxTemp = forecast.Count == 0 ? (int?)null : forecast.Min(f => WeatherRules.WholeDegrees(f.MaxC)); // outerwear stays unless every day is hot
        var candidates = StylistCandidateSelector.Select(wardrobe, new CandidateCriteria(seasons, null, maxTemp, true, settings.MaxCandidates, settings.HotFromC));
        var context = new PackingContext(candidates.ToDictionary(c => c.Id, StringComparer.Ordinal), dates, trip.CabinOnly, packing.CabinMaxItems);
        var wantsOuter = forecast.Any(f => WantsOuterLayer(f, settings));
        var occasions = trip.TripTypes.Select(PackingRules.OccasionFor).ToList();
        var missing = PackingRules.MissingPieces(wardrobe, forecast, settings.ColdBelowC);

        PackResult Result(PackPlan? plan, string source, string? refusal)
        {
            var wears = plan is null ? new Dictionary<string, int>() : PackingRules.PlannedWears(plan);
            return new PackResult(trip.Id, trip.CabinOnly, plan is not null && PackingRules.EveryPieceWornTwice(plan), source, refusal,
                (plan?.ItemIds ?? []).Select(id => new PackItem(id, wears[id])).ToList(),
                (plan?.Days ?? []).OrderBy(d => d.Date, StringComparer.Ordinal).Select(d => new PackDay(d.Date, d.Label, d.Occasion, d.Slots)).ToList(),
                missing, language);
        }

        var fallback = RuleBasedPacking.Build(context, wantsOuter, occasions);
        if (fallback is null)
            return new Outcome(StylingJson.Serialize(Result(null, StylistOutputGuard.SourceRule, StylistRefusals.InsufficientWardrobe)));

        var byDate = forecast.GroupBy(f => f.Date, StringComparer.Ordinal).ToDictionary(g => g.Key, g => g.First(), StringComparer.Ordinal);
        var prompt = StylingJson.Serialize(new
        {
            language,
            trip = new
            {
                dates,
                trip.TripTypes,
                trip.CabinOnly,
                cabinMaxItems = packing.CabinMaxItems,
                weather = dates.Select(d => byDate.TryGetValue(d, out var f) ? new { date = d, MinTempC = WeatherRules.WholeDegrees(f.MinC), MaxTempC = WeatherRules.WholeDegrees(f.MaxC), f.Condition } : null).Where(w => w is not null),
            },
            minWearsPerPiece = PackingRules.RequiresMinWears(dates.Count) ? PackingRules.MinWearsPerPiece : 1,
            candidates = candidates.Select(Describe),
        });

        var output = StylingJson.TryDeserialize<ModelPackOutput>(await model.GenerateAsync(new StylistPrompt(JobKind.StylistPack, prompt, language), ct));
        if (StylistOutputGuard.ViolatesContentPolicy(StylistOutputGuard.Texts(output?.Days)))
            return Outcome.Fail(JobFailure.GuardRejected);

        var plan = PackingRules.FromModel(output);
        var labelsFit = plan is not null && plan.Days.All(d => (d.Label?.Length ?? 0) <= settings.MaxTitleLength);
        return plan is not null && labelsFit && PackingRules.Validate(plan, context).Count == 0
            ? new Outcome(StylingJson.Serialize(Result(plan, StylistOutputGuard.SourceModel, null)))
            : new Outcome(StylingJson.Serialize(Result(fallback, StylistOutputGuard.SourceRule, null)));
    }

    // ── Context ───────────────────────────────────────────────────────────────────────────────────────────────────

    private static object Describe(CandidateItem item) => new { item.Id, item.Category, item.ColorIds, item.Fabric, item.Seasons };

    private static bool WantsOuterLayer(DailyForecast? forecast, StylistOptions settings) =>
        forecast is not null && (forecast.MinC < settings.ColdBelowC || WeatherRules.IsWet(forecast.Condition));

    private async Task<List<CandidateItem>> WardrobeAsync(string tenantId, CancellationToken ct) =>
        (await repository.GetAllAsync<ItemEntity>(ItemEntity.GetPk(tenantId), ct)).Select(i => i.ToCandidate()).ToList();

    private async Task<IReadOnlyList<DailyForecast>> ForecastAsync(string? cityId, double? latitude, double? longitude, string from, string to, CancellationToken ct) =>
        cityId is null && latitude is null && longitude is null
            ? []
            : await weather.GetForecastAsync(new WeatherQuery(cityId, latitude, longitude, from, to), ct);

    private async Task<object?> StyleAsync(string tenantId, CancellationToken ct)
    {
        var style = await repository.GetAsync<StyleProfileEntity>(StyleProfileEntity.GetPk(tenantId), StyleProfileEntity.GetSk(), ct);
        return style is null ? null : new { style.StyleTags, style.Budget };
    }

    private async Task<object?> PaletteAsync(string tenantId, CancellationToken ct)
    {
        var palette = await repository.GetAsync<PaletteResultEntity>(PaletteResultEntity.GetPk(tenantId), PaletteResultEntity.GetSk(), ct);
        return palette is null ? null : new { palette.SeasonTypeId, palette.FlatteringColorIds, palette.AvoidColorIds };
    }

    private async Task<List<List<string>>> DislikedAsync(string tenantId, int take, CancellationToken ct) =>
        (await repository.GetAllAsync<StylistFeedbackEntity>(StylistFeedbackEntity.GetPk(tenantId), ct))
        .OrderByDescending(f => f.CreatedAt).Take(Math.Max(0, take)).Select(f => f.ItemIds).ToList();
}
