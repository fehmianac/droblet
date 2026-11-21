using Domain.Constant;
using Domain.Domain;
using Domain.Entity;
using Domain.Enum;
using Domain.Events;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Domain.Services.Styling;
using Microsoft.Extensions.Options;

namespace Infrastructure.Services;

/// <summary>
/// E5 trips: CRUD, archive, packing job start, accepting the packing draft (TripItem + TripDay — only on user action,
/// re-validated by PackingRules) and the packing checklist.
/// </summary>
public sealed class TripService(
    IRepository repository,
    IEventManager events,
    IStylistAllowanceService allowance,
    IWeatherService weather,
    IOptionsMonitor<PackingOptions> packingOptions,
    TimeProvider timeProvider,
    IAiUsageGuard aiLimits) : ITripService
{
    private const int MaxVersionRetries = 4;

    private DateTime Now => timeProvider.GetUtcNow().UtcDateTime;

    public async Task<IReadOnlyList<TripDto>> GetAllAsync(string tenantId, CancellationToken ct)
    {
        var trips = await repository.GetAllAsync<TripEntity>(TripEntity.GetPk(tenantId), ct);
        var items = (await repository.GetAllAsync<TripItemEntity>(TripItemEntity.GetPk(tenantId), ct)).ToLookup(i => i.TripId, StringComparer.Ordinal);
        return trips
            .OrderByDescending(t => t.StartDate, StringComparer.Ordinal).ThenByDescending(t => t.Id, StringComparer.Ordinal)
            .Select(t => ToDto(t, items[t.Id].ToList()))
            .ToList();
    }

    public async Task<TripDetailDto?> GetAsync(string tenantId, string id, CancellationToken ct)
    {
        var trip = await GetEntityAsync(tenantId, id, ct);
        return trip is null ? null : await DetailAsync(trip, ct);
    }

    public async Task<ServiceResult<TripDto>> CreateAsync(string tenantId, CreateTripCommand command, CancellationToken ct)
    {
        if (await GetEntityAsync(tenantId, command.Id, ct) is { } existing)
            return ServiceResult.Ok(ToDto(existing, await ItemsAsync(tenantId, existing.Id, ct)));

        var city = await LocationAsync(command.CityId, command.CityName, ct);
        if (city is null)
            return ServiceResult.Invalid<TripDto>(ErrorCodes.TripCityNotFound);

        var now = Now;
        var trip = new TripEntity
        {
            Id = command.Id,
            TenantId = tenantId,
            CityId = city.Value.Id,
            CityName = city.Value.Name,
            StartDate = command.StartDate,
            EndDate = command.EndDate,
            TripTypes = (command.TripTypes ?? []).Distinct().ToList(),
            CabinOnly = command.CabinOnly,
            CreatedAt = now,
            UpdatedAt = now,
        };
        if (!await repository.SaveIfVersionAsync(trip, 0, ct))
            trip = await GetEntityAsync(tenantId, command.Id, ct) ?? trip;
        return ServiceResult.Created(ToDto(trip, []));
    }

    public async Task<ServiceResult<TripDto>> UpdateAsync(string tenantId, string id, UpdateTripCommand command, CancellationToken ct)
    {
        var trip = await GetEntityAsync(tenantId, id, ct);
        if (trip is null)
            return ServiceResult.NotFound<TripDto>();
        var items = await ItemsAsync(tenantId, id, ct);
        if (trip.Version != command.BaseVersion)
            return ServiceResult.Conflict(ToDto(trip, items));

        var city = await LocationAsync(command.CityId, command.CityName, ct);
        if (city is null)
            return ServiceResult.Invalid<TripDto>(ErrorCodes.TripCityNotFound);

        trip.CityId = city.Value.Id;
        trip.CityName = city.Value.Name;
        trip.StartDate = command.StartDate;
        trip.EndDate = command.EndDate;
        trip.TripTypes = (command.TripTypes ?? []).Distinct().ToList();
        trip.CabinOnly = command.CabinOnly;
        trip.UpdatedAt = Now;

        if (await repository.SaveIfVersionAsync(trip, command.BaseVersion, ct))
            return ServiceResult.Ok(ToDto(trip, items));
        var current = await GetEntityAsync(tenantId, id, ct);
        return current is null ? ServiceResult.NotFound<TripDto>() : ServiceResult.Conflict(ToDto(current, items));
    }

    public async Task<bool> DeleteAsync(string tenantId, string id, CancellationToken ct)
    {
        var trip = await GetEntityAsync(tenantId, id, ct);
        if (trip is null)
            return false;

        var keys = new List<(string, string)>();
        keys.AddRange((await ItemsAsync(tenantId, id, ct)).Select(i => (i.Pk, i.Sk)));
        keys.AddRange((await DaysAsync(tenantId, id, ct)).Select(d => (d.Pk, d.Sk)));
        if (keys.Count > 0)
            await repository.BatchDeleteKeysAsync(keys, ct);
        await repository.DeleteAsync(trip.Pk, trip.Sk, ct);
        return true;
    }

    public async Task<ServiceResult<TripDto>> ArchiveAsync(string tenantId, string id, bool archived, CancellationToken ct)
    {
        for (var attempt = 0; attempt < MaxVersionRetries; attempt++)
        {
            var trip = await GetEntityAsync(tenantId, id, ct);
            if (trip is null)
                return ServiceResult.NotFound<TripDto>();

            var items = await ItemsAsync(tenantId, id, ct);
            if (archived == (trip.ArchivedAt is not null))
                return ServiceResult.Ok(ToDto(trip, items));

            trip.ArchivedAt = archived ? Now : null;
            trip.UpdatedAt = Now;
            if (await repository.SaveIfVersionAsync(trip, trip.Version, ct))
                return ServiceResult.Ok(ToDto(trip, items));
        }

        throw new InvalidOperationException($"Trip {id} could not be archived after {MaxVersionRetries} attempts.");
    }

    public async Task<ServiceResult<JobDto>> StartPackAsync(string tenantId, string id, StartPackCommand command, string? requestLanguage, CancellationToken ct)
    {
        if (await JobStarter.ExistingAsync(repository, tenantId, command.RequestId, JobKind.StylistPack, ct) is { } existing)
            return existing;

        var trip = await GetEntityAsync(tenantId, id, ct);
        if (trip is null)
            return ServiceResult.NotFound<JobDto>(ErrorCodes.TripNotFound);

        // Members, or an approved teen with a Teen:Stylist:TripPackPerWeek slot (0 by default = off for teens).
        var decision = await allowance.ReserveAsync(tenantId, command.RequestId, TeenStylistKind.TripPack, ct);
        if (!decision.Allowed)
            return ServiceResult.Denied<JobDto>(decision);
        if (!await aiLimits.AllowAsync(tenantId, AiCap.Stylist, 1, ct))
        {
            await allowance.ReleaseAsync(tenantId, command.RequestId, ct);
            return ServiceResult.TooManyRequests<JobDto>(ErrorCodes.AiLimitReached);
        }

        var tenant = await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(tenantId), ct);
        var job = JobStarter.New(tenantId, command.RequestId, JobKind.StylistPack, StylingJson.Serialize(new PackJobInput(id, Localized.Language(tenant?.Language, requestLanguage))), Now);
        await repository.SaveAsync(job, ct);
        await events.PublishAsync(new StylistRequestedEvent(tenantId, job.Id, JobKind.StylistPack), ct);
        return ServiceResult.Accepted(job.ToDto());
    }

    public async Task<ServiceResult<TripDetailDto>> AcceptPackAsync(string tenantId, string id, string jobId, AcceptPackCommand command, CancellationToken ct)
    {
        for (var attempt = 0; attempt < MaxVersionRetries; attempt++)
        {
            var trip = await GetEntityAsync(tenantId, id, ct);
            if (trip is null)
                return ServiceResult.NotFound<TripDetailDto>(ErrorCodes.TripNotFound);

            var receipt = await repository.GetAsync<MutationReceiptEntity>(MutationReceiptEntity.GetPk(tenantId), MutationReceiptEntity.GetSk(command.ClientMutationId), ct);
            if (receipt is not null)
                return ServiceResult.Ok(await DetailAsync(trip, ct));

            var job = await JobStarter.CompletedAsync(repository, tenantId, jobId, JobKind.StylistPack, ct);
            if (job is null)
                return ServiceResult.NotFound<TripDetailDto>(ErrorCodes.JobNotFound);
            if (job.Status != JobStatus.Completed)
                return ServiceResult.Conflict<TripDetailDto>(null, ErrorCodes.JobNotCompleted);

            var draft = StylingJson.TryDeserialize<PackResult>(job.Result);
            if (draft is null || draft.TripId != id || draft.Items.Count == 0)
                return ServiceResult.NotFound<TripDetailDto>(ErrorCodes.SuggestionNotFound);

            // The same rules as the worker, against the wardrobe and the trip as they are now.
            var wardrobe = (await repository.GetAllAsync<ItemEntity>(ItemEntity.GetPk(tenantId), ct)).ToDictionary(i => i.Id, i => i.ToCandidate(), StringComparer.Ordinal);
            var plan = new PackPlan(draft.Items.Select(i => i.ItemId).ToList(),
                draft.Days.Select(d => new PackDayPlan(d.Date, d.Label, d.Occasion, d.Slots)).ToList());
            var context = new PackingContext(wardrobe, TripDates(trip), trip.CabinOnly, packingOptions.CurrentValue.CabinMaxItems);
            if (PackingRules.Validate(plan, context).Count > 0)
                return ServiceResult.Conflict<TripDetailDto>(null, ErrorCodes.SuggestionStale);

            var now = Now;
            var wears = PackingRules.PlannedWears(plan);
            var oldItems = await ItemsAsync(tenantId, id, ct);
            var oldDays = await DaysAsync(tenantId, id, ct);
            var packedBefore = oldItems.Where(i => i.Packed).ToDictionary(i => i.ItemId, i => i.PackedAt, StringComparer.Ordinal);

            trip.PackJobId = jobId;
            trip.EveryPieceWornTwice = PackingRules.EveryPieceWornTwice(plan);
            trip.Missing = draft.Missing.Select(m => m.ToValue()).ToList();
            trip.UpdatedAt = now;

            var operations = new List<TransactWriteOperation>
            {
                TransactWriteOperation.Create(new MutationReceiptEntity { TenantId = tenantId, ClientMutationId = command.ClientMutationId, CreatedAt = now }),
                TransactWriteOperation.PutVersioned(trip),
            };
            // A piece already ticked off stays ticked when the list is regenerated.
            operations.AddRange(plan.ItemIds.Select(itemId => TransactWriteOperation.Put(new TripItemEntity
            {
                TenantId = tenantId, TripId = id, ItemId = itemId, PlannedWears = wears[itemId],
                Packed = packedBefore.ContainsKey(itemId), PackedAt = packedBefore.GetValueOrDefault(itemId),
            })));
            operations.AddRange(plan.Days.Select(d => TransactWriteOperation.Put(new TripDayEntity
            {
                TenantId = tenantId, TripId = id, Date = d.Date, Label = d.Label, Occasion = d.Occasion,
                Slots = d.Slots.Select(s => s.ToValue()).ToList(),
            })));

            var write = await repository.TransactWriteAsync(operations, ct);
            if (write.FailedIndex == 0)
                return ServiceResult.Ok(await DetailAsync(trip, ct));
            if (!write.Applied)
                continue;

            var stale = oldItems.Where(i => !wears.ContainsKey(i.ItemId)).Select(i => (i.Pk, i.Sk))
                .Concat(oldDays.Where(d => plan.Days.All(p => p.Date != d.Date)).Select(d => (d.Pk, d.Sk))).ToList();
            if (stale.Count > 0)
                await repository.BatchDeleteKeysAsync(stale, ct);
            return ServiceResult.Ok(await DetailAsync(trip, ct));
        }

        throw new InvalidOperationException($"Pack accept {command.ClientMutationId} could not be applied after {MaxVersionRetries} attempts.");
    }

    public async Task<ServiceResult<TripItemDto>> MarkPackedAsync(string tenantId, string id, string itemId, MarkPackedCommand command, CancellationToken ct)
    {
        var row = await repository.GetAsync<TripItemEntity>(TripItemEntity.GetPk(tenantId), TripItemEntity.GetSk(id, itemId), ct);
        if (row is null)
            return ServiceResult.NotFound<TripItemDto>();

        var itemIds = await LookService.ItemIdsAsync(repository, tenantId, ct);
        var receipt = await repository.GetAsync<MutationReceiptEntity>(MutationReceiptEntity.GetPk(tenantId), MutationReceiptEntity.GetSk(command.ClientMutationId), ct);
        if (receipt is not null)
            return ServiceResult.Ok(ToDto(row, itemIds));

        // A late offline event is recorded (receipt) but cannot rewind a newer mark.
        var occurredAt = command.OccurredAt.ToUniversalTime();
        if (row.PackedAt is null || occurredAt >= row.PackedAt)
        {
            row.Packed = command.Packed;
            row.PackedAt = occurredAt;
        }

        await repository.SaveWithReceiptAsync(
            new MutationReceiptEntity { TenantId = tenantId, ClientMutationId = command.ClientMutationId, CreatedAt = Now }, [row], ct);
        var stored = await repository.GetAsync<TripItemEntity>(row.Pk, row.Sk, ct) ?? row;
        return ServiceResult.Ok(ToDto(stored, itemIds));
    }

    // ── Helpers ───────────────────────────────────────────────────────────────────────────────────────────────────

    public static IReadOnlyList<string> TripDates(TripEntity trip) =>
        CalendarDay.Range(CalendarDay.Parse(trip.StartDate), CalendarDay.Parse(trip.EndDate));

    private async Task<TripDetailDto> DetailAsync(TripEntity trip, CancellationToken ct)
    {
        var items = await ItemsAsync(trip.TenantId, trip.Id, ct);
        var days = await DaysAsync(trip.TenantId, trip.Id, ct);
        var itemIds = await LookService.ItemIdsAsync(repository, trip.TenantId, ct);
        var tripForecast = await ForecastAsync(trip, ct);
        var forecast = tripForecast.Days.ToDictionary(d => d.Date, StringComparer.Ordinal);

        return new TripDetailDto(
            ToDto(trip, items),
            items.OrderBy(i => i.ItemId, StringComparer.Ordinal).Select(i => ToDto(i, itemIds)).ToList(),
            days.OrderBy(d => d.Date, StringComparer.Ordinal)
                .Select(d => new TripDayDto(d.Date, d.Label, d.Occasion, d.Slots.OrderBy(s => s.Slot).Select(s => s.ToDto(itemIds)).ToList(), forecast.GetValueOrDefault(d.Date)))
                .ToList(),
            tripForecast);
    }

    /// <summary>
    /// The trip's location as stored: a known city id (picked from the city search) is kept as sent; a trip without one
    /// (free-text city, older client) is geocoded by its name and stored with the first match's id and name. Null = the
    /// name matches no place (422 <c>trip_city_not_found</c>). A provider outage while geocoding surfaces as
    /// <see cref="WeatherUnavailableException"/> (503 <c>weather_unavailable</c>): a trip is never stored without a location.
    /// </summary>
    private async Task<(string Id, string? Name)?> LocationAsync(string? cityId, string? cityName, CancellationToken ct)
    {
        var name = Blank(cityName);
        if (Blank(cityId) is { } id)
            return (id, name);
        if (name is null)
            return null;
        var match = (await weather.SearchCitiesAsync(name, ct)).FirstOrDefault();
        return match is null ? null : (match.Id, match.Name);
    }

    /// <summary>
    /// The daily forecast of every trip day (not only of the accepted plan's days), with a status that tells the app what
    /// an empty strip means. The city comes from the city cache; an id the cache does not know is re-resolved by the trip's
    /// city name. Weather is context: this never throws for a provider failure.
    /// </summary>
    private async Task<TripForecastDto> ForecastAsync(TripEntity trip, CancellationToken ct)
    {
        var today = CalendarDay.ToText(DateOnly.FromDateTime(Now));
        if (string.CompareOrdinal(trip.EndDate, today) < 0)
            return new TripForecastDto(TripForecastStatus.Past, [], null);

        WeatherForecast? forecast;
        try
        {
            var city = await weather.GetCityAsync(trip.CityId, ct);
            if (city is null && Blank(trip.CityName) is { } name)
                city = (await weather.SearchCitiesAsync(name, ct)).FirstOrDefault();
            if (city is null)
                return new TripForecastDto(TripForecastStatus.NoLocation, [], null);
            forecast = await weather.GetForecastByCityAsync(city.Id, IWeatherService.HorizonDays, ct);
        }
        catch (WeatherUnavailableException)
        {
            return new TripForecastDto(TripForecastStatus.Unavailable, [], null);
        }
        if (forecast is null)
            return new TripForecastDto(TripForecastStatus.NoLocation, [], null);
        if (forecast.Days.Count == 0)
            return new TripForecastDto(TripForecastStatus.Unavailable, [], null);

        return TripForecast(TripDates(trip), forecast.Days);
    }

    /// <summary>Pure part of <see cref="ForecastAsync"/>: the trip's days out of the provider's horizon, and the status.</summary>
    public static TripForecastDto TripForecast(IReadOnlyList<string> tripDates, IReadOnlyList<DailyForecast> horizon)
    {
        if (horizon.Count == 0 || tripDates.Count == 0)
            return new TripForecastDto(TripForecastStatus.Unavailable, [], null);
        var horizonEnd = horizon.Max(d => d.Date)!;
        var wanted = tripDates.ToHashSet(StringComparer.Ordinal);
        var days = horizon.Where(d => wanted.Contains(d.Date))
            .GroupBy(d => d.Date, StringComparer.Ordinal).Select(g => g.First().ToDto())
            .OrderBy(d => d.Date, StringComparer.Ordinal).ToList();
        var status = days.Count == tripDates.Count ? TripForecastStatus.Available
            : days.Count > 0 ? TripForecastStatus.Partial
            : string.CompareOrdinal(tripDates[0], horizonEnd) > 0 ? TripForecastStatus.BeyondRange
            : TripForecastStatus.Unavailable;
        return new TripForecastDto(status, days, horizonEnd);
    }

    private TripDto ToDto(TripEntity trip, IReadOnlyList<TripItemEntity> items)
    {
        var today = CalendarDay.ToText(DateOnly.FromDateTime(Now));
        var status = string.CompareOrdinal(today, trip.StartDate) < 0 ? TripStatus.Upcoming
            : string.CompareOrdinal(today, trip.EndDate) > 0 ? TripStatus.Past
            : TripStatus.Active;

        return new TripDto(trip.Id, trip.CityId, trip.CityName, trip.StartDate, trip.EndDate, trip.TripTypes, trip.CabinOnly, status,
            trip.ArchivedAt is not null || status == TripStatus.Past, trip.ArchivedAt, TripDates(trip).Count, items.Count,
            items.Count(i => i.Packed), trip.EveryPieceWornTwice, trip.Missing.Select(m => m.ToDto()).ToList(), trip.CreatedAt, trip.UpdatedAt, trip.Version);
    }

    private static TripItemDto ToDto(TripItemEntity row, IReadOnlySet<string> itemIds) =>
        new(row.ItemId, row.PlannedWears, row.Packed, row.PackedAt, !itemIds.Contains(row.ItemId));

    private Task<TripEntity?> GetEntityAsync(string tenantId, string id, CancellationToken ct) =>
        repository.GetAsync<TripEntity>(TripEntity.GetPk(tenantId), TripEntity.GetSk(id), ct);

    private async Task<IReadOnlyList<TripItemEntity>> ItemsAsync(string tenantId, string tripId, CancellationToken ct) =>
        await repository.GetAllAsync<TripItemEntity>(TripItemEntity.GetPk(tenantId), TripItemEntity.TripPrefix(tripId), SkOperator.BeginsWith, ct);

    private async Task<IReadOnlyList<TripDayEntity>> DaysAsync(string tenantId, string tripId, CancellationToken ct) =>
        await repository.GetAllAsync<TripDayEntity>(TripDayEntity.GetPk(tenantId), TripDayEntity.TripPrefix(tripId), SkOperator.BeginsWith, ct);

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
