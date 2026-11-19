using Domain.Entity;
using Domain.Enum;
using Domain.Extensions;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Infrastructure.Services;

/// <summary>
/// Explicit consents (docs/legal consents 1–6). Every decision is written as an append-only history row plus the current
/// row in one transaction, so the audit log and the state the guards read never disagree.
/// </summary>
public sealed class ConsentService(
    IRepository repository,
    IOptionsMonitor<ConsentOptions> options,
    TimeProvider timeProvider,
    ILogger<ConsentService> logger) : IConsentService
{
    private DateTime Now => timeProvider.GetUtcNow().UtcDateTime;

    public async Task<ConsentsDto> GetAsync(string tenantId, CancellationToken ct)
    {
        var rows = await CurrentAsync(tenantId, ct);
        var settings = options.CurrentValue;
        return new ConsentsDto(System.Enum.GetValues<ConsentType>().Select(type =>
        {
            rows.TryGetValue(type, out var row);
            var current = settings.CurrentVersion(type);
            return new ConsentStateDto(type, row?.Granted ?? false, row?.Version, current, ConsentRules.IsValid(row, current),
                row?.GrantedAt, row?.WithdrawnAt, row?.Locale, row?.Source);
        }).ToList());
    }

    public async Task<ConsentHistoryDto> GetHistoryAsync(string tenantId, CancellationToken ct)
    {
        var rows = await repository.GetAllAsync<ConsentHistoryEntity>(ConsentHistoryEntity.GetPk(tenantId), ct);
        return new ConsentHistoryDto(rows
            .OrderByDescending(r => r.At).ThenByDescending(r => r.Id, StringComparer.Ordinal)
            .Select(r => new ConsentHistoryItemDto(r.Type, r.Granted, r.Version, r.At, r.Locale, r.Source))
            .ToList());
    }

    public async Task<(ConsentUpdateOutcome Outcome, ConsentsDto Consents)> SetAsync(
        string tenantId, string userId, IReadOnlyList<ConsentDecision> decisions, string? source, string? locale, CancellationToken ct)
    {
        var settings = options.CurrentValue;
        // A grant must name the text the user actually saw; an outdated app shows an outdated text.
        if (decisions.Any(d => d.Granted && !string.Equals(d.Version, settings.CurrentVersion(d.Type), StringComparison.Ordinal)))
            return (ConsentUpdateOutcome.VersionOutdated, await GetAsync(tenantId, ct));

        var rows = await CurrentAsync(tenantId, ct);
        var now = Now;
        var withdrawn = new List<ConsentType>();
        // The last decision per type wins when a request repeats a type.
        foreach (var decision in decisions.GroupBy(d => d.Type).Select(g => g.Last()))
        {
            rows.TryGetValue(decision.Type, out var row);
            if (row is not null && row.Granted == decision.Granted && (!decision.Granted || row.Version == decision.Version))
                continue; // unchanged: nothing to record
            if (row is null && !decision.Granted && !string.Equals(source, ConsentRules.OnboardingSource, StringComparison.Ordinal))
                continue; // "not now" on a consent never given is not a decision worth an audit row (the all-in-one step records it)

            var version = decision.Granted ? decision.Version : row?.Version ?? settings.CurrentVersion(decision.Type);
            await RecordAsync(tenantId, userId, row, decision.Type, decision.Granted, version, source, locale, now, ct);
            if (!decision.Granted)
                withdrawn.Add(decision.Type);
        }

        foreach (var type in withdrawn)
            await ApplyWithdrawalAsync(tenantId, userId, type, ct);

        return (ConsentUpdateOutcome.Ok, await GetAsync(tenantId, ct));
    }

    public async Task WithdrawAsync(string tenantId, string? userId, ConsentType type, string source, CancellationToken ct)
    {
        var row = await repository.GetAsync<ConsentEntity>(ConsentEntity.GetPk(tenantId), ConsentEntity.GetSk(type), ct);
        if (row is not { Granted: true })
            return;
        await RecordAsync(tenantId, userId, row, type, false, row.Version, source, row.Locale, Now, ct);
        if (userId is not null)
            await ApplyWithdrawalAsync(tenantId, userId, type, ct);
    }

    public async Task<IReadOnlyList<ConsentType>> MissingAsync(string tenantId, IReadOnlyList<ConsentType> required, CancellationToken ct)
    {
        if (required.Count == 0)
            return [];
        var rows = await CurrentAsync(tenantId, ct);
        var settings = options.CurrentValue;
        return required.Distinct()
            .Where(type => !ConsentRules.IsValid(rows.GetValueOrDefault(type), settings.CurrentVersion(type)))
            .ToList();
    }

    private async Task<Dictionary<ConsentType, ConsentEntity>> CurrentAsync(string tenantId, CancellationToken ct) =>
        (await repository.GetAllAsync<ConsentEntity>(ConsentEntity.GetPk(tenantId), ct))
        .GroupBy(r => r.Type).ToDictionary(g => g.Key, g => g.OrderByDescending(r => r.UpdatedAt).First());

    private async Task RecordAsync(string tenantId, string? userId, ConsentEntity? previous, ConsentType type, bool granted, string version,
        string? source, string? locale, DateTime now, CancellationToken ct)
    {
        source = Trim(source, ConsentRules.MaxSourceLength);
        locale = Trim(locale, 10);
        var history = new ConsentHistoryEntity
        {
            Id = Ulid.New(now),
            TenantId = tenantId,
            UserId = userId,
            Type = type,
            Granted = granted,
            Version = version,
            Locale = locale,
            Source = source,
            At = now,
        };
        var current = new ConsentEntity
        {
            TenantId = tenantId,
            UserId = userId ?? previous?.UserId,
            Type = type,
            Granted = granted,
            Version = version,
            GrantedAt = granted ? now : previous?.GrantedAt,
            WithdrawnAt = granted ? null : now,
            Locale = locale,
            Source = source,
            UpdatedAt = now,
        };

        var result = await repository.TransactWriteAsync(
            [TransactWriteOperation.Create(history), TransactWriteOperation.Put(current)], ct);
        if (!result.Applied)
            throw new InvalidOperationException($"Consent record was not written ({result.Outcome}).");
        logger.LogInformation("Consent {Type} {Decision} (version {Version}) for tenant {TenantId}",
            type, granted ? "granted" : "withdrawn", version, tenantId);
    }

    /// <summary>What a withdrawal switches off immediately (the guards stop the rest on the next request).</summary>
    private async Task ApplyWithdrawalAsync(string tenantId, string userId, ConsentType type, CancellationToken ct)
    {
        switch (type)
        {
            case ConsentType.MarketingNotifications:
                await SwitchOffMarketingAsync(tenantId, userId, ct);
                break;
            case ConsentType.Weight:
                await ClearWeightAsync(tenantId, ct);
                break;
        }
    }

    private async Task SwitchOffMarketingAsync(string tenantId, string userId, CancellationToken ct)
    {
        // The send lists first: even if the preference write races with the app, nothing marketing goes out.
        await repository.DeleteAsync(NotificationSubscriberEntity.GetPk(NotificationType.WeeklyEdit), NotificationSubscriberEntity.GetSk(tenantId), ct);
        await repository.DeleteAsync(NotificationSubscriberEntity.GetPk(NotificationType.PriceDrop), NotificationSubscriberEntity.GetSk(tenantId), ct);

        for (var attempt = 0; attempt < 3; attempt++)
        {
            var pref = await repository.GetAsync<NotificationPrefEntity>(NotificationPrefEntity.GetPk(tenantId), NotificationPrefEntity.GetSk(userId), ct);
            if (pref is null || (!pref.WeeklyEdit && !pref.PriceDrop))
                return;
            var expected = pref.Version;
            pref.WeeklyEdit = false;
            pref.PriceDrop = false;
            pref.UpdatedAt = Now;
            if (await repository.SaveIfVersionAsync(pref, expected, ct))
                return;
        }
    }

    private async Task ClearWeightAsync(string tenantId, CancellationToken ct)
    {
        for (var attempt = 0; attempt < 3; attempt++)
        {
            var body = await repository.GetAsync<BodyProfileEntity>(BodyProfileEntity.GetPk(tenantId), BodyProfileEntity.GetSk(), ct);
            if (body?.WeightKg is null)
                return;
            var expected = body.Version;
            body.WeightKg = null;
            body.UpdatedAt = Now;
            if (await repository.SaveIfVersionAsync(body, expected, ct))
                return;
        }
    }

    private static string? Trim(string? value, int max)
    {
        if (string.IsNullOrWhiteSpace(value))
            return null;
        value = value.Trim();
        return value.Length <= max ? value : value[..max];
    }
}
