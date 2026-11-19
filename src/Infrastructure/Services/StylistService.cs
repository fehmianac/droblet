using Domain.Constant;
using Domain.Domain;
using Domain.Entity;
using Domain.Enum;
using Domain.Events;
using Domain.Extensions;
using Domain.Manager;
using Domain.Services;
using Domain.Services.Styling;

namespace Infrastructure.Services;

internal static class JobStarter
{
    /// <summary>The client's requestId is the job id: the same request sent twice is the same job (never queued twice).</summary>
    public static async Task<ServiceResult<JobDto>?> ExistingAsync(IRepository repository, string tenantId, string requestId, JobKind kind, CancellationToken ct)
    {
        var job = await repository.GetAsync<JobEntity>(JobEntity.GetPk(tenantId), JobEntity.GetSk(requestId), ct);
        if (job is null)
            return null;
        return job.Kind == kind ? ServiceResult.Accepted(job.ToDto()) : ServiceResult.Conflict<JobDto>(null, ErrorCodes.RequestIdReused);
    }

    public static JobEntity New(string tenantId, string id, JobKind kind, string? input, DateTime now, string? creditKey = null) =>
        new() { Id = id, TenantId = tenantId, Kind = kind, Status = JobStatus.Queued, Input = input, CreditIdempotencyKey = creditKey, CreatedAt = now, UpdatedAt = now };

    public static async Task<JobEntity?> CompletedAsync(IRepository repository, string tenantId, string jobId, JobKind kind, CancellationToken ct)
    {
        var job = await repository.GetAsync<JobEntity>(JobEntity.GetPk(tenantId), JobEntity.GetSk(jobId), ct);
        return job is not null && job.Kind == kind ? job : null;
    }
}

/// <summary>
/// E5 stylist (Api side): starts outfit / week jobs and turns a draft into Look / PlanDay — only when the user accepts.
/// Text stylist never costs a credit (EntitlementPolicy.CreditCost), it only needs the membership.
/// </summary>
public sealed class StylistService(
    IRepository repository,
    IEventManager events,
    IEntitlementService entitlements,
    ILookService looks,
    TimeProvider timeProvider) : IStylistService
{
    private const int MaxVersionRetries = 4;

    private DateTime Now => timeProvider.GetUtcNow().UtcDateTime;

    public async Task<ServiceResult<JobDto>> StartOutfitAsync(string tenantId, StartOutfitCommand command, string? requestLanguage, CancellationToken ct)
    {
        if (await GuardStartAsync(tenantId, command.RequestId, JobKind.StylistOutfit, ct) is { } early)
            return early;

        if (command.PinnedItemId is not null
            && await repository.GetAsync<ItemEntity>(ItemEntity.GetPk(tenantId), ItemEntity.GetSk(command.PinnedItemId), ct) is null)
            return ServiceResult.Invalid<JobDto>(ErrorCodes.ItemNotFound);

        var tenant = await TenantAsync(tenantId, ct);
        var freeText = string.IsNullOrWhiteSpace(command.FreeText) ? null : command.FreeText.Trim();
        var input = new OutfitJobInput(command.Date, command.Occasion, freeText, command.OnlyMyWardrobe, command.PinnedItemId,
            command.CityId ?? tenant?.CityId, command.Latitude, command.Longitude, Localized.Language(tenant?.Language, requestLanguage));
        return await QueueAsync(tenantId, command.RequestId, JobKind.StylistOutfit, StylingJson.Serialize(input), ct);
    }

    public async Task<ServiceResult<JobDto>> StartWeekAsync(string tenantId, StartWeekCommand command, string? requestLanguage, CancellationToken ct)
    {
        if (await GuardStartAsync(tenantId, command.RequestId, JobKind.StylistWeek, ct) is { } early)
            return early;

        var start = CalendarDay.Parse(command.WeekStart);
        var dates = CalendarDay.Range(start, start.AddDays(6));
        // Occasion per day: the request wins, then what is already planned for that day.
        var planned = (await repository.GetAllAsync<PlanDayEntity>(PlanDayEntity.GetPk(tenantId), dates[0], SkOperator.GreaterThanOrEqual, ct))
            .ToDictionary(d => d.Date, d => d.Occasion, StringComparer.Ordinal);
        var requested = (command.Days ?? []).GroupBy(d => d.Date, StringComparer.Ordinal).ToDictionary(g => g.Key, g => g.First().Occasion, StringComparer.Ordinal);
        var days = dates
            .Select(d => new WeekDayRequest(d, requested.TryGetValue(d, out var occasion) && occasion is not null ? occasion : planned.GetValueOrDefault(d)))
            .ToList();

        var tenant = await TenantAsync(tenantId, ct);
        var input = new WeekJobInput(command.WeekStart, days, command.OnlyMyWardrobe, command.CityId ?? tenant?.CityId,
            command.Latitude, command.Longitude, Localized.Language(tenant?.Language, requestLanguage));
        return await QueueAsync(tenantId, command.RequestId, JobKind.StylistWeek, StylingJson.Serialize(input), ct);
    }

    public async Task<ServiceResult<AcceptedSuggestionDto>> AcceptSuggestionAsync(string tenantId, string jobId, int index, AcceptSuggestionCommand command, CancellationToken ct)
    {
        var lookId = command.LookId ?? command.ClientMutationId;
        for (var attempt = 0; attempt < MaxVersionRetries; attempt++)
        {
            if (await ReceiptExistsAsync(tenantId, command.ClientMutationId, ct))
                return await AcceptedAsync(tenantId, lookId, command.PlanDate, ct);

            var job = await JobStarter.CompletedAsync(repository, tenantId, jobId, JobKind.StylistOutfit, ct);
            if (job is null)
                return ServiceResult.NotFound<AcceptedSuggestionDto>(ErrorCodes.JobNotFound);
            if (job.Status != JobStatus.Completed)
                return ServiceResult.Conflict<AcceptedSuggestionDto>(null, ErrorCodes.JobNotCompleted);

            var result = StylingJson.TryDeserialize<OutfitResult>(job.Result);
            var suggestion = result?.Suggestions.FirstOrDefault(s => s.Index == index);
            if (result is null || suggestion is null)
                return ServiceResult.NotFound<AcceptedSuggestionDto>(ErrorCodes.SuggestionNotFound);

            var now = Now;
            var look = await BuildLookAsync(tenantId, lookId, suggestion, command.Name, result.Occasion, command.Favorite, now, ct);
            if (look is null)
                return ServiceResult.Conflict<AcceptedSuggestionDto>(null, ErrorCodes.SuggestionStale);

            var operations = new List<TransactWriteOperation>
            {
                TransactWriteOperation.Create(new MutationReceiptEntity { TenantId = tenantId, ClientMutationId = command.ClientMutationId, CreatedAt = now }),
                TransactWriteOperation.Create(look),
            };
            if (command.PlanDate is not null)
                operations.Add(TransactWriteOperation.PutVersioned(await PlanAsync(tenantId, command.PlanDate, look.Id, result.Occasion, now, ct)));

            var write = await repository.TransactWriteAsync(operations, ct);
            if (write.Applied || write.FailedIndex == 0)
                return await AcceptedAsync(tenantId, lookId, command.PlanDate, ct);
            if (write.FailedIndex == 1)
                return ServiceResult.Conflict<AcceptedSuggestionDto>(null, ErrorCodes.LookIdTaken);
            // Plan day changed on another device in between: re-read and re-apply (an accept is an event, not an edit).
        }

        throw new InvalidOperationException($"Suggestion accept {command.ClientMutationId} could not be applied after {MaxVersionRetries} attempts.");
    }

    public async Task<ServiceResult<AcceptedWeekDto>> AcceptWeekAsync(string tenantId, string jobId, AcceptWeekCommand command, CancellationToken ct)
    {
        for (var attempt = 0; attempt < MaxVersionRetries; attempt++)
        {
            var job = await JobStarter.CompletedAsync(repository, tenantId, jobId, JobKind.StylistWeek, ct);
            if (job is null)
                return ServiceResult.NotFound<AcceptedWeekDto>(ErrorCodes.JobNotFound);
            if (job.Status != JobStatus.Completed)
                return ServiceResult.Conflict<AcceptedWeekDto>(null, ErrorCodes.JobNotCompleted);

            var result = StylingJson.TryDeserialize<WeekResult>(job.Result);
            var days = (result?.Days ?? [])
                .Where(d => d.Outfit is not null && (command.Dates is null || command.Dates.Contains(d.Date)))
                .ToList();
            if (result is null || days.Count == 0)
                return ServiceResult.NotFound<AcceptedWeekDto>(ErrorCodes.SuggestionNotFound);

            if (await ReceiptExistsAsync(tenantId, command.ClientMutationId, ct))
                return await AcceptedWeekAsync(tenantId, days.Select(d => d.Date).ToList(), ct);

            var now = Now;
            var operations = new List<TransactWriteOperation>
            {
                TransactWriteOperation.Create(new MutationReceiptEntity { TenantId = tenantId, ClientMutationId = command.ClientMutationId, CreatedAt = now }),
            };
            foreach (var day in days)
            {
                var look = await BuildLookAsync(tenantId, Ulid.New(now), day.Outfit!, null, day.Occasion, false, now, ct);
                if (look is null)
                    return ServiceResult.Conflict<AcceptedWeekDto>(null, ErrorCodes.SuggestionStale);
                operations.Add(TransactWriteOperation.Create(look));
                operations.Add(TransactWriteOperation.PutVersioned(await PlanAsync(tenantId, day.Date, look.Id, day.Occasion, now, ct)));
            }

            var write = await repository.TransactWriteAsync(operations, ct);
            if (write.Applied || write.FailedIndex == 0)
                return await AcceptedWeekAsync(tenantId, days.Select(d => d.Date).ToList(), ct);
        }

        throw new InvalidOperationException($"Week accept {command.ClientMutationId} could not be applied after {MaxVersionRetries} attempts.");
    }

    public async Task<ServiceResult<bool>> DislikeAsync(string tenantId, string jobId, int index, DislikeCommand command, CancellationToken ct)
    {
        var job = await JobStarter.CompletedAsync(repository, tenantId, jobId, JobKind.StylistOutfit, ct);
        if (job is null)
            return ServiceResult.NotFound<bool>(ErrorCodes.JobNotFound);

        var suggestion = StylingJson.TryDeserialize<OutfitResult>(job.Result)?.Suggestions.FirstOrDefault(s => s.Index == index);
        if (suggestion is null)
            return ServiceResult.NotFound<bool>(ErrorCodes.SuggestionNotFound);

        // Keyed by job + index: disliking the same suggestion twice just overwrites the reason.
        await repository.SaveAsync(new StylistFeedbackEntity
        {
            TenantId = tenantId,
            JobId = jobId,
            Index = index,
            Reason = command.Reason,
            ItemIds = suggestion.Slots.Where(s => s.ItemId is not null).Select(s => s.ItemId!).ToList(),
            CreatedAt = Now,
        }, ct);
        return ServiceResult.NoContent<bool>();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────────────────────────────────────────

    private async Task<ServiceResult<JobDto>?> GuardStartAsync(string tenantId, string requestId, JobKind kind, CancellationToken ct)
    {
        if (await JobStarter.ExistingAsync(repository, tenantId, requestId, kind, ct) is { } existing)
            return existing;
        var decision = await entitlements.CheckAsync(tenantId, Capability.DailyStylist, ct);
        return decision.Allowed ? null : ServiceResult.Forbidden<JobDto>(decision.Reason ?? ErrorCodes.PremiumRequired);
    }

    private async Task<ServiceResult<JobDto>> QueueAsync(string tenantId, string requestId, JobKind kind, string input, CancellationToken ct)
    {
        var job = JobStarter.New(tenantId, requestId, kind, input, Now);
        await repository.SaveAsync(job, ct);
        await events.PublishAsync(new StylistRequestedEvent(tenantId, job.Id, kind), ct);
        return ServiceResult.Accepted(job.ToDto());
    }

    /// <summary>The look a suggestion becomes: its wardrobe pieces + catalog-matched missing pieces. null = no longer valid.</summary>
    private async Task<LookEntity?> BuildLookAsync(string tenantId, string lookId, SuggestedOutfit suggestion, string? name, Occasion? occasion,
        bool favorite, DateTime now, CancellationToken ct)
    {
        // Library pieces Droblet picked for a thin wardrobe join the look once the user has added them ("Gardıroba ekle");
        // a library piece not added yet is left out (the app adds them before saving).
        var libraryIds = suggestion.Missing.Where(m => m.LibraryItemId is not null).Select(m => m.LibraryItemId!).ToHashSet(StringComparer.Ordinal);
        var owned = libraryIds.Count == 0
            ? []
            : (await repository.GetAllAsync<ItemEntity>(ItemEntity.GetPk(tenantId), ct))
                .Where(i => i.LibraryItemId is not null && libraryIds.Contains(i.LibraryItemId))
                .GroupBy(i => i.LibraryItemId!).ToDictionary(g => g.Key, g => g.OrderBy(i => i.CreatedAt).First().Id, StringComparer.Ordinal);
        var slots = suggestion.Slots
            .Concat(suggestion.Missing.Where(m => m.ProductId is not null).Select(m => new SlotRef(m.Slot, ProductId: m.ProductId)))
            .Concat(suggestion.Missing.Where(m => m.LibraryItemId is not null && owned.ContainsKey(m.LibraryItemId))
                .Select(m => new SlotRef(m.Slot, ItemId: owned[m.LibraryItemId!])))
            .ToList();
        // Pieces may have been deleted since the draft was made: the same rule set decides again at accept time.
        if ((await looks.ValidateSlotsAsync(tenantId, slots, ct)).Count > 0)
            return null;

        return new LookEntity
        {
            Id = lookId,
            TenantId = tenantId,
            Name = string.IsNullOrWhiteSpace(name) ? suggestion.Title : name.Trim(),
            Occasion = occasion,
            Slots = slots.Select(s => s.ToValue()).ToList(),
            Favorite = favorite,
            Source = LookSource.Stylist,
            CreatedAt = now,
            UpdatedAt = now,
        };
    }

    private async Task<PlanDayEntity> PlanAsync(string tenantId, string date, string lookId, Occasion? occasion, DateTime now, CancellationToken ct)
    {
        var day = await repository.GetAsync<PlanDayEntity>(PlanDayEntity.GetPk(tenantId), PlanDayEntity.GetSk(date), ct)
                  ?? new PlanDayEntity { TenantId = tenantId, Date = date };
        day.LookId = lookId;
        day.Occasion = occasion ?? day.Occasion;
        day.UpdatedAt = now;
        return day;
    }

    private async Task<ServiceResult<AcceptedSuggestionDto>> AcceptedAsync(string tenantId, string lookId, string? planDate, CancellationToken ct)
    {
        var look = await looks.GetAsync(tenantId, lookId, ct);
        if (look is null)
            return ServiceResult.NotFound<AcceptedSuggestionDto>(); // accepted earlier, look deleted since
        var plan = planDate is null ? null : (await PlanDaysAsync(tenantId, [planDate], ct)).FirstOrDefault();
        return ServiceResult.Ok(new AcceptedSuggestionDto(look, plan));
    }

    private async Task<ServiceResult<AcceptedWeekDto>> AcceptedWeekAsync(string tenantId, IReadOnlyList<string> dates, CancellationToken ct) =>
        ServiceResult.Ok(new AcceptedWeekDto(await PlanDaysAsync(tenantId, dates, ct)));

    private async Task<IReadOnlyList<PlanDayDto>> PlanDaysAsync(string tenantId, IReadOnlyList<string> dates, CancellationToken ct)
    {
        var result = new List<PlanDayDto>();
        foreach (var date in dates.Order(StringComparer.Ordinal))
        {
            var day = await repository.GetAsync<PlanDayEntity>(PlanDayEntity.GetPk(tenantId), PlanDayEntity.GetSk(date), ct);
            if (day is null)
                continue;
            var look = day.LookId is null ? null : await looks.GetAsync(tenantId, day.LookId, ct);
            result.Add(new PlanDayDto(day.Date, day.Occasion, day.LookId, look, false, day.Version, day.UpdatedAt));
        }
        return result;
    }

    private Task<TenantEntity?> TenantAsync(string tenantId, CancellationToken ct) =>
        repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(tenantId), ct);

    private async Task<bool> ReceiptExistsAsync(string tenantId, string clientMutationId, CancellationToken ct) =>
        await repository.GetAsync<MutationReceiptEntity>(MutationReceiptEntity.GetPk(tenantId), MutationReceiptEntity.GetSk(clientMutationId), ct) is not null;
}
