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
///   2. a wardrobe that cannot dress a single day is answered without calling the model: Droblet picks the missing pieces
///      itself (GapFill — ready library first, catalog for the rest; owner decision 3) and returns complete outfits with
///      the picks in `missing`; refusal insufficient_wardrobe only when even that is impossible (empty library and catalog);
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
    ILibraryCatalog library,
    ICatalogService catalog,
    IOptionsMonitor<StylistOptions> stylistOptions,
    IOptionsMonitor<PackingOptions> packingOptions,
    ILogger<StylistJobService> logger,
    IOptionsMonitor<AiOptions> aiOptions) : IStylistJobService
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
        // Independent reads in parallel; the prompt-only ones are awaited when the prompt is built.
        var wardrobeRead = WardrobeAsync(job.TenantId, ct);
        var forecastRead = ForecastAsync(input.CityId, input.Latitude, input.Longitude, input.Date, input.Date, ct);
        var styleRead = StyleAsync(job.TenantId, ct);
        var paletteRead = PaletteAsync(job.TenantId, ct);
        var dislikedRead = DislikedAsync(job.TenantId, settings.DislikeMemory, ct);
        var wardrobe = await wardrobeRead;
        var forecast = (await forecastRead).FirstOrDefault();
        var season = SeasonRules.For(date);
        var candidates = StylistCandidateSelector.Select(wardrobe, new CandidateCriteria(
            new HashSet<Season> { season }, input.Occasion, forecast is null ? null : WeatherRules.WholeDegrees(forecast.MaxC), false, settings.MaxCandidates, settings.HotFromC, input.PinnedItemId));

        OutfitResult Result(string? refusal, IReadOnlyList<SuggestedOutfit> suggestions) =>
            new(input.Date, input.Occasion, input.OnlyMyWardrobe, refusal, suggestions, language, suggestions.Any(GapFill.HasPicks));

        var wantsOuter = WantsOuterLayer(forecast, settings);
        var fill = await GapFillAsync(job.TenantId, new HashSet<Season> { season }, input.Occasion,
            forecast is null ? null : WeatherRules.WholeDegrees(forecast.MaxC), false, wantsOuter, ct);
        // The segment (style profile) shapes the rules (menswear), the picks and the prompt.
        var ruleOptions = new RuleOutfitOptions(input.PinnedItemId, wantsOuter, input.OnlyMyWardrobe, Segment: fill.Segment, Occasion: input.Occasion);
        if (RuleBasedOutfit.Build(candidates, 1, ruleOptions).Count == 0)
        {
            // Thin wardrobe (owner decision 3): Droblet picks the missing pieces itself — no model call, no dead end.
            var filled = Indexed(GapFill.Outfits(candidates, fill, settings.SuggestionCount, ruleOptions));
            return new Outcome(StylingJson.Serialize(filled.Count == 0 ? Result(StylistRefusals.InsufficientWardrobe, []) : Result(null, filled)));
        }

        // Per-user context first (stable between requests → a cacheable prefix), the request itself last.
        var aliases = CandidateAliases.For(candidates, aiOptions.CurrentValue.CompactStylistPrompt);
        var prompt = StylistPrompts.Outfit(aliases, candidates, language, await styleRead, await paletteRead, settings.SuggestionCount, input.OnlyMyWardrobe,
            await dislikedRead, input.Date, season, input.Occasion, Weather(forecast), input.FreeText, input.PinnedItemId);

        var output = StylingJson.TryDeserialize<ModelOutfitOutput>(aliases.Restore(
            await model.GenerateAsync(new StylistPrompt(JobKind.StylistOutfit, prompt, language, aliases.Compact, fill.Segment, fill.Teen), ct)));
        if (StylistOutputGuard.ViolatesContentPolicy(StylistOutputGuard.Texts(output), fill.Teen))
            return Outcome.Fail(JobFailure.GuardRejected);
        if (output?.Refusal == StylistRefusals.OutOfScope)
            return new Outcome(StylingJson.Serialize(Result(StylistRefusals.OutOfScope, [])));

        var context = GuardContext.For(candidates, input.OnlyMyWardrobe, input.PinnedItemId, settings.MaxTitleLength, settings.MaxExplanationLength);
        var suggestions = StylistOutputGuard.AcceptDistinct(output?.Suggestions, context, settings.SuggestionCount)
            .Select(s => WithoutForeignMissing(s, fill.Segment)).ToList();
        if (suggestions.Count < settings.SuggestionCount)
        {
            var taken = suggestions.Select(s => StylistOutputGuard.Signature(s.Slots)).ToHashSet(StringComparer.Ordinal);
            suggestions.AddRange(RuleBasedOutfit.Build(candidates, settings.SuggestionCount - suggestions.Count, ruleOptions with { ExcludeSignatures = taken }));
        }
        if (suggestions.Count < settings.SuggestionCount)
        {
            // The wardrobe only dresses the day one or two ways: the rest are filled with picked pieces.
            var taken = suggestions.Select(s => StylistOutputGuard.Signature(s.Slots)).ToHashSet(StringComparer.Ordinal);
            suggestions.AddRange(GapFill.Outfits(candidates, fill, settings.SuggestionCount - suggestions.Count, ruleOptions with { ExcludeSignatures = taken }));
        }

        return new Outcome(StylingJson.Serialize(Result(null, Indexed(WithShoes(suggestions, candidates, fill)))));
    }

    /// <summary>Menswear: the model may suggest a missing piece only for a slot a man would fill — never a dress.</summary>
    private static SuggestedOutfit WithoutForeignMissing(SuggestedOutfit outfit, Segment segment) =>
        segment == Segment.Men && outfit.Missing.Any(m => m.Category == ItemCategory.Dress)
            ? outfit with { Missing = outfit.Missing.Where(m => m.Category != ItemCategory.Dress).ToList() }
            : outfit;

    private static List<SuggestedOutfit> Indexed(IEnumerable<SuggestedOutfit> suggestions) => suggestions.Select((s, i) => s with { Index = i }).ToList();

    /// <summary>A wardrobe without shoes: every look still gets a picked pair (library first, else the shop).</summary>
    private static IEnumerable<SuggestedOutfit> WithShoes(IEnumerable<SuggestedOutfit> suggestions, IReadOnlyList<CandidateItem> candidates, GapFillContext fill)
    {
        if (candidates.Any(c => c.Category == ItemCategory.Shoes))
            return suggestions;
        var picked = GapFill.Candidates(candidates, fill);
        return suggestions.Select((s, i) => GapFill.WithShoes(s, picked, i));
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
        // Independent reads in parallel (wardrobe, forecast, style profile).
        var wardrobeRead = WardrobeAsync(job.TenantId, ct);
        var forecastRead = ForecastAsync(input.CityId, input.Latitude, input.Longitude, dates.Min()!, dates.Max()!, ct);
        var style0 = StyleAsync(job.TenantId, ct);
        var wardrobe = await wardrobeRead;
        var forecast = (await forecastRead)
            .GroupBy(f => f.Date, StringComparer.Ordinal).ToDictionary(g => g.Key, g => g.First(), StringComparer.Ordinal);
        var seasons = dates.Select(d => SeasonRules.For(CalendarDay.Parse(d))).ToHashSet();
        var candidates = StylistCandidateSelector.Select(wardrobe, new CandidateCriteria(seasons, null, null, false, settings.MaxCandidates, settings.HotFromC));

        var weekMax = forecast.Count == 0 ? (int?)null : forecast.Values.Min(f => WeatherRules.WholeDegrees(f.MaxC));
        var fill = await GapFillAsync(job.TenantId, seasons, null, weekMax, false, forecast.Values.Any(f => WantsOuterLayer(f, settings)), ct);

        // A day the wardrobe cannot dress (thin wardrobe, owner decision 3) is dressed with picked pieces.
        SuggestedOutfit? Filled(int i, string? previous, DailyForecast? day) =>
            GapFill.Outfits(candidates, fill with { WantsOuterLayer = WantsOuterLayer(day, settings) }, 1,
                new RuleOutfitOptions(null, WantsOuterLayer(day, settings), true, i,
                    previous is null ? null : new HashSet<string>(StringComparer.Ordinal) { previous }, fill.Segment, input.Days[i].Occasion)).FirstOrDefault();

        if (RuleBasedOutfit.Build(candidates, 1).Count == 0)
        {
            var filledPlan = new List<WeekDayPlan>();
            string? last = null;
            for (var i = 0; i < input.Days.Count; i++)
            {
                var day = input.Days[i];
                var outfit = Filled(i, last, forecast.GetValueOrDefault(day.Date));
                last = outfit is null ? null : GapFill.RawSignature(outfit);
                filledPlan.Add(new WeekDayPlan(day.Date, day.Occasion, outfit is null ? null : outfit with { Index = i }));
            }
            return new Outcome(StylingJson.Serialize(filledPlan.All(d => d.Outfit is null)
                ? new WeekResult(input.WeekStart, StylistRefusals.InsufficientWardrobe, [], language)
                : new WeekResult(input.WeekStart, null, filledPlan, language, true)));
        }

        // Static context first (candidates, style), the batch's days last: the prefix is the same for every batch and job.
        var style = await style0;
        var aliases = CandidateAliases.For(candidates, aiOptions.CurrentValue.CompactStylistPrompt);
        string Prompt(IReadOnlyList<string> batch) => StylistPrompts.Week(aliases, candidates, language, style, input.WeekStart,
            input.Days.Where(d => batch.Contains(d.Date)).Select(d => new StylistPrompts.WeekDay(d.Date, d.Occasion, Weather(forecast.GetValueOrDefault(d.Date)))));

        // The days in small batches, one model call each, in parallel (Stylist:WeekBatchDays; 0 = one call for the week).
        // A batch that fails is dressed by the rules below; only when every batch fails does the job fail (or retry).
        var batches = WeekPlanning.Split(dates, settings.WeekBatchDays);
        var calls = batches.Select(async batch => aliases.Restore(
            await model.GenerateAsync(new StylistPrompt(JobKind.StylistWeek, Prompt(batch), language, aliases.Compact, fill.Segment, fill.Teen), ct))).ToList();
        try
        {
            await Task.WhenAll(calls);
        }
        catch (Exception) when (calls.Any(c => c.IsCompletedSuccessfully))
        {
            logger.LogWarning("Week job {JobId}: {Failed} of {Batches} batches failed; their days are dressed by the rules",
                job.Id, calls.Count(c => !c.IsCompletedSuccessfully), calls.Count);
        }
        var output = WeekPlanning.Merge(batches.Zip(calls)
            .Where(b => b.Second.IsCompletedSuccessfully)
            .Select(b => (b.First, StylingJson.TryDeserialize<ModelWeekOutput>(b.Second.Result))));
        if (StylistOutputGuard.ViolatesContentPolicy(StylistOutputGuard.Texts(output?.Days), fill.Teen))
            return Outcome.Fail(JobFailure.GuardRejected);

        var accepted = StylistOutputGuard.AcceptWeek(output, dates, GuardContext.For(candidates, true, null, settings.MaxTitleLength, settings.MaxExplanationLength));
        // Consistency pass: a look the week already had (batches cannot see each other) makes way for another one.
        var repeated = WeekPlanning.RepeatedDates(accepted, dates).ToHashSet(StringComparer.Ordinal);
        var used = new HashSet<string>(StringComparer.Ordinal);
        var plan = new List<WeekDayPlan>();
        string? previous = null;
        for (var i = 0; i < input.Days.Count; i++)
        {
            var day = input.Days[i];
            var wantsOuter = WantsOuterLayer(forecast.GetValueOrDefault(day.Date), settings);
            if (repeated.Contains(day.Date)
                && RuleBasedOutfit.Build(candidates, 1, new RuleOutfitOptions(null, wantsOuter, true, i,
                    new HashSet<string>(used.Append(previous ?? ""), StringComparer.Ordinal), fill.Segment, day.Occasion)).FirstOrDefault() is { } fresh)
                accepted = new Dictionary<string, SuggestedOutfit>(accepted, StringComparer.Ordinal) { [day.Date] = fresh };
            // A replaced day can make the next model look a repeat of the day before: that one is replaced too.
            if (!accepted.TryGetValue(day.Date, out var outfit) || GapFill.RawSignature(outfit) == previous)
            {
                var exclude = previous is null ? null : new HashSet<string>(StringComparer.Ordinal) { previous };
                outfit = RuleBasedOutfit.Build(candidates, 1, new RuleOutfitOptions(null, wantsOuter, true, i, exclude, fill.Segment, day.Occasion)).FirstOrDefault()
                         ?? Filled(i, previous, forecast.GetValueOrDefault(day.Date));
            }

            outfit = outfit is null ? null : WithShoes([outfit], candidates, fill).First();
            previous = outfit is null ? null : GapFill.RawSignature(outfit);
            if (previous is not null)
                used.Add(previous);
            plan.Add(new WeekDayPlan(day.Date, day.Occasion, outfit is null ? null : outfit with { Index = i }));
        }

        return new Outcome(StylingJson.Serialize(new WeekResult(input.WeekStart, null, plan, language, plan.Any(d => GapFill.HasPicks(d.Outfit)))));
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

        var wardrobeRead = WardrobeAsync(job.TenantId, ct);
        var forecast = await ForecastAsync(trip.CityId, null, null, trip.StartDate, trip.EndDate, ct);
        var wardrobe = await wardrobeRead;
        var seasons = dates.Select(d => SeasonRules.For(CalendarDay.Parse(d))).ToHashSet();
        var maxTemp = forecast.Count == 0 ? (int?)null : forecast.Min(f => WeatherRules.WholeDegrees(f.MaxC)); // outerwear stays unless every day is hot
        var candidates = StylistCandidateSelector.Select(wardrobe, new CandidateCriteria(seasons, null, maxTemp, true, settings.MaxCandidates, settings.HotFromC));
        var occasions = trip.TripTypes.Select(PackingRules.OccasionFor).ToList();
        var dayOccasions = CapsuleRules.DayOccasions(dates.Count, occasions);
        // Cold or wet trip days: the outer layer is packed and worn on those days (forecast per date when known).
        var layerDates = forecast.Where(f => WantsOuterLayer(f, settings)).Select(f => f.Date).Where(dates.Contains).ToHashSet(StringComparer.Ordinal);
        var context = new PackingContext(candidates.ToDictionary(c => c.Id, StringComparer.Ordinal), dates, trip.CabinOnly, packing.CabinMaxItems,
            dayOccasions, layerDates);
        var wantsOuter = layerDates.Count > 0;
        var target = CapsuleRules.TargetFor(context)!;
        var range = CapsuleRules.PieceRange(context)!.Value;
        // Gap filling (owner decision 3): a generic "missing" placeholder (no shoes, rain, cold) names a concrete library /
        // shop piece, and a wardrobe that cannot dress the trip is packed with picked pieces.
        var fill = await GapFillAsync(job.TenantId, seasons, null, maxTemp, true, wantsOuter, ct);
        var picked = GapFill.Candidates(candidates, fill);
        var missing = PackingRules.MissingPieces(wardrobe, forecast, settings.ColdBelowC).Select(m => GapFill.Concrete(m, picked)).ToList();

        PackResult Result(PackPlan? plan, string source, string? refusal, bool trimmed = false, IReadOnlyList<string>? dropped = null)
        {
            var wears = plan is null ? new Dictionary<string, int>() : PackingRules.PlannedWears(plan);
            return new PackResult(trip.Id, trip.CabinOnly, plan is not null && PackingRules.EveryPieceWornTwice(plan), source, refusal,
                (plan?.ItemIds ?? []).Select(id => new PackItem(id, wears[id])).ToList(),
                (plan?.Days ?? []).OrderBy(d => d.Date, StringComparer.Ordinal).Select(d => new PackDay(d.Date, d.Label, d.Occasion, d.Slots)).ToList(),
                missing, language, context.CabinLimit, trimmed, dropped ?? [], missing.Any(m => m.LibraryItemId is not null || m.ProductId is not null));
        }

        var fallback = RuleBasedPacking.Build(context, wantsOuter, occasions);
        if (fallback is null)
        {
            var filledContext = context with { Candidates = candidates.Concat(picked).ToDictionary(c => c.Id, StringComparer.Ordinal) };
            if (RuleBasedPacking.Build(filledContext, wantsOuter, occasions) is not { } filledPlan)
                return new Outcome(StylingJson.Serialize(Result(null, StylistOutputGuard.SourceRule, StylistRefusals.InsufficientWardrobe)));

            // The picked pieces leave the packing list and the day looks; they are listed as suggestions in `missing`.
            var pickedById = picked.ToDictionary(p => p.Id, StringComparer.Ordinal);
            foreach (var id in filledPlan.ItemIds.Where(GapFill.IsPicked))
            {
                var piece = GapFill.Missing(OutfitSlotRules.DefaultSlot(pickedById[id].Category), pickedById[id]);
                if (!missing.Any(m => (m.LibraryItemId ?? m.ProductId) == (piece.LibraryItemId ?? piece.ProductId)))
                    missing.Add(piece);
            }
            var own = filledPlan with
            {
                ItemIds = filledPlan.ItemIds.Where(id => !GapFill.IsPicked(id)).ToList(),
                Days = filledPlan.Days.Select(d => d with { Slots = d.Slots.Where(s => !GapFill.IsPicked(s.ItemId)).ToList() }).ToList(),
            };
            return new Outcome(StylingJson.Serialize(Result(own, StylistOutputGuard.SourceRule, null)));
        }
        // Did the cabin limit make the rule-based list shorter than it would otherwise be?
        var fallbackTrimmed = context.CabinLimit is not null
            && RuleBasedPacking.Build(context with { CabinOnly = false }, wantsOuter, occasions) is { } unlimited
            && unlimited.ItemIds.Count > fallback.ItemIds.Count;

        var byDate = forecast.GroupBy(f => f.Date, StringComparer.Ordinal).ToDictionary(g => g.Key, g => g.First(), StringComparer.Ordinal);
        var aliases = CandidateAliases.For(candidates, aiOptions.CurrentValue.CompactStylistPrompt);
        var prompt = StylistPrompts.Pack(aliases, candidates, language,
            new
            {
                dates,
                trip.TripTypes,
                trip.CabinOnly,
                // 0 when no limit applies. Every piece counts once: shoes, bags and accessories included.
                cabinMaxItems = context.CabinLimit ?? 0,
                weather = dates.Select(d => byDate.TryGetValue(d, out var f) ? new { date = d, MinTempC = WeatherRules.WholeDegrees(f.MinC), MaxTempC = WeatherRules.WholeDegrees(f.MaxC), f.Condition } : null).Where(w => w is not null),
            },
            // One look per date for that date's occasion; outerLayer = cold or wet (wear the outer layer that day).
            dates.Select((d, i) => new { date = d, occasion = dayOccasions[i], outerLayer = layerDates.Contains(d) }),
            // The capsule the rules expect (CapsuleRules): about `pieces` in total, never more than maxPieces.
            new { target.Tops, target.Bottoms, target.Shoes, target.Outerwear, target.Bags, pieces = target.Pieces, minPieces = range.Min, maxPieces = range.Max },
            PackingRules.RequiresMinWears(dates.Count) ? CapsuleRules.MinRewearRatio : 1.0,
            await StyleAsync(job.TenantId, ct));

        var output = StylingJson.TryDeserialize<ModelPackOutput>(aliases.Restore(
            await model.GenerateAsync(new StylistPrompt(JobKind.StylistPack, prompt, language, aliases.Compact, fill.Segment, fill.Teen), ct)));
        if (StylistOutputGuard.ViolatesContentPolicy(StylistOutputGuard.Texts(output?.Days), fill.Teen))
            return Outcome.Fail(JobFailure.GuardRejected);

        // Each date's occasion is the rule's (trip types in turn), whatever the model wrote.
        var plan = PackingRules.FromModel(output) is { } parsed
            ? parsed with { Days = parsed.Days.Select(d => d with { Occasion = context.OccasionOn(d.Date) ?? d.Occasion }).ToList() }
            : null;
        var labelsFit = plan is not null && plan.Days.All(d => (d.Label?.Length ?? 0) <= settings.MaxTitleLength);
        if (plan is null || !labelsFit)
        {
            logger.LogInformation("Pack job {JobId}: source rule ({Reason}); {Pieces} pieces, target {Target}, {Days} days, {Candidates} candidates",
                job.Id, plan is null ? "unusable answer" : "label too long", fallback.ItemIds.Count, target.Pieces, dates.Count, candidates.Count);
            return new Outcome(StylingJson.Serialize(Result(fallback, StylistOutputGuard.SourceRule, null, fallbackTrimmed)));
        }

        // Small faults are fixed by rule (PackingRules.Repair) instead of throwing the model's list away. The model is
        // told the cabin limit, but it is enforced here: a list that is only too long is trimmed by rule (the pieces used
        // in the most looks stay); anything that still fails the rules is replaced by the rule-based list.
        var asAnswered = PackingRules.Validate(plan, context);
        var repaired = asAnswered.Count == 0 ? plan : PackingRules.Repair(plan, context, fallback);
        var trim = PackingRules.TrimToCabinLimit(repaired, context);
        var remaining = trim.Plan is null ? [PackingRules.CabinLimit] : PackingRules.Validate(trim.Plan, context);
        var accepted = trim.Plan is not null && remaining.Count == 0;
        // What decided the list, for measuring the prompt and the rules (ids and rule codes only — no piece, no text).
        logger.LogInformation(
            "Pack job {JobId}: source {Source}; answered with [{Answered}], after repair [{Remaining}]; {Pieces} pieces, target {Target}, {Days} days, {Candidates} candidates",
            job.Id, accepted ? StylistOutputGuard.SourceModel : StylistOutputGuard.SourceRule, string.Join(',', asAnswered), string.Join(',', remaining),
            (accepted ? trim.Plan! : fallback).ItemIds.Count, target.Pieces, dates.Count, candidates.Count);
        return accepted
            ? new Outcome(StylingJson.Serialize(Result(trim.Plan!, StylistOutputGuard.SourceModel, null, trim.DroppedItemIds.Count > 0, trim.DroppedItemIds)))
            : new Outcome(StylingJson.Serialize(Result(fallback, StylistOutputGuard.SourceRule, null, fallbackTrimmed)));
    }

    // ── Context ───────────────────────────────────────────────────────────────────────────────────────────────────

    private static PromptWeather? Weather(DailyForecast? forecast) =>
        forecast is null ? null : new PromptWeather(WeatherRules.WholeDegrees(forecast.MinC), WeatherRules.WholeDegrees(forecast.MaxC), forecast.Condition);

    private static bool WantsOuterLayer(DailyForecast? forecast, StylistOptions settings) =>
        forecast is not null && (forecast.MinC < settings.ColdBelowC || WeatherRules.IsWet(forecast.Condition));

    /// <summary>The wardrobe as candidates. Teen (docs/api/teen.md §4): revealing pieces (beachwear, lingerie…) are left out.</summary>
    private async Task<List<CandidateItem>> WardrobeAsync(string tenantId, CancellationToken ct)
    {
        var itemsRead = repository.GetAllAsync<ItemEntity>(ItemEntity.GetPk(tenantId), ct);
        var teen = await repository.IsTeenTenantAsync(tenantId, ct);
        return (await itemsRead).Where(i => !teen || !TeenRules.IsRevealing(i.Category, i.Subcategory)).Select(i => i.ToCandidate()).ToList();
    }

    private async Task<IReadOnlyList<DailyForecast>> ForecastAsync(string? cityId, double? latitude, double? longitude, string from, string to, CancellationToken ct) =>
        cityId is null && latitude is null && longitude is null
            ? []
            : await weather.GetForecastAsync(new WeatherQuery(cityId, latitude, longitude, from, to), ct);

    private async Task<object?> StyleAsync(string tenantId, CancellationToken ct)
    {
        var style = await repository.GetAsync<StyleProfileEntity>(StyleProfileEntity.GetPk(tenantId), StyleProfileEntity.GetSk(), ct);
        return style is null ? null : new { style.StyleTags, style.Budget };
    }

    /// <summary>What the gap filling may pick (library, catalog) and the user's palette and budget band to respect.</summary>
    private async Task<GapFillContext> GapFillAsync(string tenantId, IReadOnlySet<Season> seasons, Occasion? occasion, int? maxTempC, bool isTrip,
        bool wantsOuterLayer, CancellationToken ct)
    {
        var settings = stylistOptions.CurrentValue;
        // Four independent reads: in parallel.
        var paletteRead = repository.GetAsync<PaletteResultEntity>(PaletteResultEntity.GetPk(tenantId), PaletteResultEntity.GetSk(), ct);
        var styleRead = repository.GetAsync<StyleProfileEntity>(StyleProfileEntity.GetPk(tenantId), StyleProfileEntity.GetSk(), ct);
        var libraryRead = library.GetAllAsync(ct);
        var catalogRead = catalog.GetProductsAsync(ct);
        var teenRead = repository.IsTeenTenantAsync(tenantId, ct);
        await Task.WhenAll(paletteRead, styleRead, libraryRead, catalogRead, teenRead);
        // Teen (docs/api/teen.md §4): no store products (commerce off) and no revealing library pieces.
        var teen = teenRead.Result;
        var (palette, style) = (paletteRead.Result, styleRead.Result);
        var band = style?.Budget switch
        {
            Budget.HighStreet => PriceBand.HighStreet,
            Budget.LuxuryTouch => PriceBand.LuxuryTouch,
            _ => (PriceBand?)null,
        };
        return new GapFillContext(
            teen ? libraryRead.Result.Where(l => !TeenRules.IsRevealing(l.Category, null)).ToList() : libraryRead.Result,
            teen ? [] : catalogRead.Result,
            seasons, occasion, maxTempC, settings.HotFromC, isTrip, wantsOuterLayer,
            (palette?.FlatteringColorIds ?? []).ToHashSet(StringComparer.Ordinal),
            (palette?.AvoidColorIds ?? []).ToHashSet(StringComparer.Ordinal),
            band,
            Segment: style?.Segment ?? Segment.Women,
            Teen: teen);
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
