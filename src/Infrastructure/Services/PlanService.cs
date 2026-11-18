using Domain.Constant;
using Domain.Domain;
using Domain.Entity;
using Domain.Manager;
using Domain.Services;

namespace Infrastructure.Services;

/// <summary>
/// E4: plan days, "Bunu giyiyorum" wear log, calendar month summary and the Today snapshot.
/// Calendar days are the user's local day (yyyy-MM-dd); instants are UTC. Wear counters only move through WearStatsRules.
/// </summary>
public sealed class PlanService(
    IRepository repository,
    IWardrobeService wardrobe,
    IWeatherService weather,
    TimeProvider timeProvider) : IPlanService
{
    private const int MaxVersionRetries = 4;

    private DateTime Now => timeProvider.GetUtcNow().UtcDateTime;

    // ── Plan days ─────────────────────────────────────────────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<PlanDayDto>> GetPlanDaysAsync(string tenantId, DateOnly from, DateOnly to, CancellationToken ct)
    {
        var (fromText, toText) = (CalendarDay.ToText(from), CalendarDay.ToText(to));
        var days = (await repository.GetAllAsync<PlanDayEntity>(PlanDayEntity.GetPk(tenantId), fromText, SkOperator.GreaterThanOrEqual, ct))
            .Where(d => string.CompareOrdinal(d.Date, toText) <= 0).ToList();
        var worn = await WornDaysAsync(tenantId, fromText, toText, ct);
        var looks = days.Any(d => d.LookId is not null) ? await LooksAsync(tenantId, ct) : new Dictionary<string, LookDto>();
        return days.OrderBy(d => d.Date, StringComparer.Ordinal).Select(d => ToDto(d, looks, worn)).ToList();
    }

    public async Task<ServiceResult<PlanDayDto>> PutPlanDayAsync(string tenantId, string date, PutPlanDayCommand command, CancellationToken ct)
    {
        var looks = await LooksAsync(tenantId, ct);
        if (command.LookId is not null && !looks.ContainsKey(command.LookId))
            return ServiceResult.Invalid<PlanDayDto>(ErrorCodes.LookNotFound);

        var worn = await WornDaysAsync(tenantId, date, date, ct);
        var entity = await GetPlanDayAsync(tenantId, date, ct);
        if (entity is null && command.BaseVersion != 0)
            return ServiceResult.NotFound<PlanDayDto>();
        if (entity is not null && entity.Version != command.BaseVersion)
            return ServiceResult.Conflict(ToDto(entity, looks, worn));

        entity ??= new PlanDayEntity { TenantId = tenantId, Date = date };
        entity.Occasion = command.Occasion;
        entity.LookId = command.LookId;
        entity.UpdatedAt = Now;

        if (await repository.SaveIfVersionAsync(entity, command.BaseVersion, ct))
            return ServiceResult.Ok(ToDto(entity, looks, worn));

        var current = await GetPlanDayAsync(tenantId, date, ct);
        return current is null ? ServiceResult.NotFound<PlanDayDto>() : ServiceResult.Conflict(ToDto(current, looks, worn));
    }

    public async Task<bool> DeletePlanDayAsync(string tenantId, string date, CancellationToken ct)
    {
        var entity = await GetPlanDayAsync(tenantId, date, ct);
        if (entity is null)
            return false;
        await repository.DeleteAsync(entity.Pk, entity.Sk, ct);
        return true;
    }

    // ── Wear log ──────────────────────────────────────────────────────────────────────────────────────────────────

    public async Task<ServiceResult<WearLogResultDto>> LogWearAsync(string tenantId, WearLogCommand command, CancellationToken ct)
    {
        // The log id is the clientMutationId, so a replay finds exactly the log it created.
        var logKey = (Pk: WearLogEntity.GetPk(tenantId), Sk: WearLogEntity.GetSk(command.Date, command.ClientMutationId));

        for (var attempt = 0; attempt < MaxVersionRetries; attempt++)
        {
            if (await ReceiptExistsAsync(tenantId, command.ClientMutationId, ct))
                return await ReplayAsync(tenantId, logKey, ct);

            List<string> itemIds;
            if (command.LookId is not null)
            {
                var look = await repository.GetAsync<LookEntity>(LookEntity.GetPk(tenantId), LookEntity.GetSk(command.LookId), ct);
                if (look is null)
                    return ServiceResult.Invalid<WearLogResultDto>(ErrorCodes.LookNotFound);
                itemIds = look.Slots.Where(s => s.ItemId is not null).Select(s => s.ItemId!).Distinct(StringComparer.Ordinal).ToList();
            }
            else
            {
                itemIds = (command.ItemIds ?? []).Distinct(StringComparer.Ordinal).ToList();
            }

            var items = new List<ItemEntity>();
            foreach (var id in itemIds)
            {
                var item = await repository.GetAsync<ItemEntity>(ItemEntity.GetPk(tenantId), ItemEntity.GetSk(id), ct);
                if (item is not null)
                    items.Add(item);
                else if (command.LookId is null)
                    return ServiceResult.Invalid<WearLogResultDto>(ErrorCodes.ItemNotFound); // explicit ids must be the caller's own pieces
            }
            if (items.Count == 0)
                return ServiceResult.Invalid<WearLogResultDto>(ErrorCodes.WearLogEmpty);

            var sameDay = await repository.GetAllAsync<WearLogEntity>(logKey.Pk, WearLogEntity.DatePrefix(command.Date), SkOperator.BeginsWith, ct);
            var newlyCounted = WearStatsRules.NewlyCounted(items.Select(i => i.Id), sameDay.Select(ToEvent)).ToHashSet(StringComparer.Ordinal);

            var now = Now;
            var log = new WearLogEntity
            {
                Id = command.ClientMutationId,
                TenantId = tenantId,
                Date = command.Date,
                LookId = command.LookId,
                ItemIds = items.Select(i => i.Id).ToList(),
                OccurredAt = command.OccurredAt.ToUniversalTime(),
                ClientMutationId = command.ClientMutationId,
                CreatedAt = now,
            };

            var changed = items.Where(i => newlyCounted.Contains(i.Id)).ToList();
            foreach (var item in changed)
            {
                item.WearCount++;
                item.LastWornAt = WearStatsRules.LaterDay(item.LastWornAt, command.Date);
                item.UpdatedAt = now;
            }

            var receipt = new MutationReceiptEntity { TenantId = tenantId, ClientMutationId = command.ClientMutationId, CreatedAt = now };
            var outcome = await repository.SaveWithReceiptAsync(receipt, [log, .. changed], ct);
            switch (outcome)
            {
                case TransactOutcome.Applied:
                    return ServiceResult.Ok(new WearLogResultDto(log.ToDto(), items.Select(i => new ItemWearDto(i.Id, i.WearCount, i.LastWornAt)).ToList()));
                case TransactOutcome.DuplicateReceipt:
                    return await ReplayAsync(tenantId, logKey, ct);
                // Another device changed one of the pieces at the same moment: it is an event, so re-read and re-apply — no 409.
                default:
                    continue;
            }
        }

        throw new InvalidOperationException($"Wear log {command.ClientMutationId} could not be applied after {MaxVersionRetries} attempts.");
    }

    public async Task<bool> DeleteWearLogAsync(string tenantId, string date, string id, CancellationToken ct)
    {
        var pk = WearLogEntity.GetPk(tenantId);
        for (var attempt = 0; attempt < MaxVersionRetries; attempt++)
        {
            var log = await repository.GetAsync<WearLogEntity>(pk, WearLogEntity.GetSk(date, id), ct);
            if (log is null)
                return false;

            var remaining = (await repository.GetAllAsync<WearLogEntity>(pk, ct)).Where(l => l.Sk != log.Sk).Select(ToEvent).ToList();
            var operations = new List<TransactWriteOperation> { TransactWriteOperation.DeleteExisting(log.Pk, log.Sk) };
            var now = Now;
            foreach (var itemId in log.ItemIds.Distinct(StringComparer.Ordinal))
            {
                var item = await repository.GetAsync<ItemEntity>(ItemEntity.GetPk(tenantId), ItemEntity.GetSk(itemId), ct);
                if (item is null)
                    continue;
                var stats = WearStatsRules.Recompute(itemId, remaining);
                if (item.WearCount == stats.WearCount && item.LastWornAt == stats.LastWornAt)
                    continue;
                item.WearCount = stats.WearCount;
                item.LastWornAt = stats.LastWornAt;
                item.UpdatedAt = now;
                operations.Add(TransactWriteOperation.PutVersioned(item));
            }

            var result = await repository.TransactWriteAsync(operations, ct);
            if (result.Applied)
                return true;
            if (result.Outcome == TransactOutcome.ConditionFailed)
                return false; // deleted concurrently
        }

        throw new InvalidOperationException($"Wear log {id} could not be removed after {MaxVersionRetries} attempts.");
    }

    public async Task<IReadOnlyList<WearLogDto>> GetWearLogsAsync(string tenantId, DateOnly month, CancellationToken ct) =>
        (await MonthLogsAsync(tenantId, month, ct)).OrderBy(l => l.Sk, StringComparer.Ordinal).Select(l => l.ToDto()).ToList();

    public async Task<WearSummaryDto> GetWearSummaryAsync(string tenantId, DateOnly month, CancellationToken ct)
    {
        var summary = WearStatsRules.Summarize((await MonthLogsAsync(tenantId, month, ct)).Select(ToEvent));
        var mostWorn = new List<MostWornItemDto>();
        foreach (var entry in summary.MostWorn)
        {
            var item = await repository.GetAsync<ItemEntity>(ItemEntity.GetPk(tenantId), ItemEntity.GetSk(entry.ItemId), ct);
            mostWorn.Add(new MostWornItemDto(entry.ItemId, entry.Days, item is null ? null : await wardrobe.ToDtoAsync(item, ct)));
        }
        return new WearSummaryDto(month.ToString(CalendarDay.MonthFormat, System.Globalization.CultureInfo.InvariantCulture), summary.LoggedDays, summary.TotalWears, mostWorn);
    }

    // ── Today ─────────────────────────────────────────────────────────────────────────────────────────────────────

    public async Task<TodayDto> GetTodayAsync(string tenantId, DateOnly date, double? latitude, double? longitude, CancellationToken ct)
    {
        var today = CalendarDay.ToText(date);
        var weekEnd = date.AddDays(6);
        var week = await GetPlanDaysAsync(tenantId, date, weekEnd, ct);
        var worn = await WornDaysAsync(tenantId, today, CalendarDay.ToText(weekEnd), ct);
        var plan = week.FirstOrDefault(d => d.Date == today);

        // Location permission -> coordinates; otherwise the profile city (brief §4.2). Neither -> weather unknown.
        var tenant = await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(tenantId), ct);
        IReadOnlyList<DailyForecast> forecast = latitude is null && longitude is null && tenant?.CityId is null
            ? []
            : await weather.GetForecastAsync(new WeatherQuery(tenant?.CityId, latitude, longitude, today, today), ct);

        var missing = plan?.Look?.Slots.Where(s => s.Missing || s.Unavailable).ToList() ?? [];
        var strip = CalendarDay.Range(date, weekEnd)
            .Select(d => new WeekStripDayDto(d, week.Any(p => p.Date == d && (p.LookId is not null || p.Occasion is not null)), worn.Contains(d)))
            .ToList();

        return new TodayDto(today, SeasonRules.For(date), forecast.FirstOrDefault(f => f.Date == today)?.ToDto(), plan?.Occasion, plan,
            plan?.Look, missing.Count > 0, missing, worn.Contains(today), strip);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────────────────────────────────────────

    private static PlanDayDto ToDto(PlanDayEntity day, IReadOnlyDictionary<string, LookDto> looks, IReadOnlySet<string> worn) =>
        new(day.Date, day.Occasion, day.LookId, day.LookId is not null && looks.TryGetValue(day.LookId, out var look) ? look : null,
            worn.Contains(day.Date), day.Version, day.UpdatedAt);

    private static WearEvent ToEvent(WearLogEntity log) => new(log.Date, log.ItemIds);

    private Task<PlanDayEntity?> GetPlanDayAsync(string tenantId, string date, CancellationToken ct) =>
        repository.GetAsync<PlanDayEntity>(PlanDayEntity.GetPk(tenantId), PlanDayEntity.GetSk(date), ct);

    private async Task<IReadOnlyDictionary<string, LookDto>> LooksAsync(string tenantId, CancellationToken ct)
    {
        var itemIds = await LookService.ItemIdsAsync(repository, tenantId, ct);
        return (await repository.GetAllAsync<LookEntity>(LookEntity.GetPk(tenantId), ct)).ToDictionary(l => l.Id, l => l.ToDto(itemIds), StringComparer.Ordinal);
    }

    private async Task<IReadOnlySet<string>> WornDaysAsync(string tenantId, string from, string to, CancellationToken ct) =>
        (await repository.GetAllAsync<WearLogEntity>(WearLogEntity.GetPk(tenantId), from, SkOperator.GreaterThanOrEqual, ct))
        .Where(l => string.CompareOrdinal(l.Date, to) <= 0).Select(l => l.Date).ToHashSet(StringComparer.Ordinal);

    private Task<List<WearLogEntity>> MonthLogsAsync(string tenantId, DateOnly month, CancellationToken ct) =>
        repository.GetAllAsync<WearLogEntity>(WearLogEntity.GetPk(tenantId),
            month.ToString(CalendarDay.MonthFormat, System.Globalization.CultureInfo.InvariantCulture) + "-", SkOperator.BeginsWith, ct);

    private async Task<bool> ReceiptExistsAsync(string tenantId, string clientMutationId, CancellationToken ct) =>
        await repository.GetAsync<MutationReceiptEntity>(MutationReceiptEntity.GetPk(tenantId), MutationReceiptEntity.GetSk(clientMutationId), ct) is not null;

    private async Task<ServiceResult<WearLogResultDto>> ReplayAsync(string tenantId, (string Pk, string Sk) logKey, CancellationToken ct)
    {
        var log = await repository.GetAsync<WearLogEntity>(logKey.Pk, logKey.Sk, ct);
        if (log is null)
            return ServiceResult.NotFound<WearLogResultDto>(); // applied earlier, then undone: a deleted record never comes back

        var items = new List<ItemWearDto>();
        foreach (var id in log.ItemIds)
        {
            if (await repository.GetAsync<ItemEntity>(ItemEntity.GetPk(tenantId), ItemEntity.GetSk(id), ct) is { } item)
                items.Add(new ItemWearDto(item.Id, item.WearCount, item.LastWornAt));
        }
        return ServiceResult.Ok(new WearLogResultDto(log.ToDto(), items));
    }
}
