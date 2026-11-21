using Domain.Entity;
using Domain.Enum;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Infrastructure.Services;

/// <summary>
/// Daily teen run (Notifier lifecycle, docs/api/teen.md §7–§8), over the teen index only (no table scan):
///   • turning 18 → adult: band adult on the user and the tenant, birth year / month cleared (no longer needed), parental
///     links revoked, the parent address removed, history "ended", the index row gone, an inbox notification;
///   • retention → a teen inactive for Teen:PhotoRetentionInactiveDays loses the personal photos (once per inactive spell);
///   • request expiry → an undecided request past its link lifetime is recorded once (history "expired").
/// Each account is handled on its own: one failure is logged and the run goes on (the next run retries).
/// </summary>
public sealed class TeenMaintenance(
    IRepository repository,
    IPhotoService photos,
    IAvatarService avatars,
    INotificationInbox inbox,
    IOptionsMonitor<TeenOptions> options,
    ILogger<TeenMaintenance> logger) : ITeenMaintenance
{
    public async Task<TeenDailyResult> RunAsync(DateTime nowUtc, CancellationToken ct)
    {
        var rows = await repository.GetAllAsync<TeenAccountIndexEntity>(TeenAccountIndexEntity.GetPk(), ct);
        int adults = 0, purged = 0, expired = 0;
        foreach (var row in rows)
        {
            try
            {
                var (adult, purge, expire) = await RunOneAsync(row, nowUtc, ct);
                adults += adult ? 1 : 0;
                purged += purge ? 1 : 0;
                expired += expire ? 1 : 0;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "Teen maintenance failed for tenant {TenantId}", row.TenantId);
            }
        }

        var result = new TeenDailyResult(rows.Count, adults, purged, expired);
        logger.LogInformation("Teen maintenance: {Teens} teens, {Adults} became adult, {Purged} photo purges, {Expired} requests expired",
            result.Teens, result.BecameAdult, result.PhotosPurged, result.RequestsExpired);
        return result;
    }

    private async Task<(bool Adult, bool Purged, bool Expired)> RunOneAsync(TeenAccountIndexEntity row, DateTime now, CancellationToken ct)
    {
        var user = await repository.GetAsync<UserEntity>(UserEntity.GetPk(), UserEntity.GetSk(row.UserId), ct);
        if (user is null || user.AgeBand != AgeBand.Teen)
        {
            await repository.DeleteAsync(row.Pk, row.Sk, ct); // deleted or already adult
            return (false, false, false);
        }

        var consent = await repository.GetAsync<ParentalConsentEntity>(ParentalConsentEntity.GetPk(user.TenantId), ParentalConsentEntity.GetSk(), ct);
        if (user.BirthYear is { } year && AgeRules.IsAdultOn(year, user.BirthMonth, DateOnly.FromDateTime(now)))
        {
            await BecomeAdultAsync(user, consent, row, now, ct);
            return (true, false, false);
        }

        var purged = false;
        var inactiveDays = Math.Max(1, options.CurrentValue.PhotoRetentionInactiveDays);
        if (row.LastActiveAt <= now.AddDays(-inactiveDays) && (row.PhotosPurgedAt is null || row.PhotosPurgedAt < row.LastActiveAt))
        {
            await photos.DeleteAllAsync(user.TenantId, ct);
            await avatars.DeleteAsync(user.TenantId, ct);
            row.PhotosPurgedAt = now;
            await repository.SaveAsync(row, ct);
            logger.LogInformation("Teen retention: personal photos of tenant {TenantId} deleted after {Days} inactive days", user.TenantId, inactiveDays);
            purged = true;
        }

        var expired = false;
        if (consent is { Status: ParentalConsentStatus.PendingParentalConsent, RequestId: not null, RequestExpiredRecordedAt: null }
            && consent.RequestExpiresAt <= now)
        {
            consent.RequestExpiredRecordedAt = now;
            consent.UpdatedAt = now;
            await repository.TransactWriteAsync(
            [
                TransactWriteOperation.Put(History(consent, ParentalConsentEvent.Expired, now)),
                TransactWriteOperation.Put(consent),
            ], ct);
            expired = true;
        }

        return (false, purged, expired);
    }

    private async Task BecomeAdultAsync(UserEntity user, ParentalConsentEntity? consent, TeenAccountIndexEntity row, DateTime now, CancellationToken ct)
    {
        user.AgeBand = AgeBand.Adult;
        user.BirthYear = null;   // only needed to find the 18th birthday
        user.BirthMonth = null;
        user.AgeConfirmedAt ??= now;
        var operations = new List<TransactWriteOperation> { TransactWriteOperation.Put(user), TransactWriteOperation.Delete(row.Pk, row.Sk) };

        var tenant = await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(user.TenantId), ct);
        if (tenant is not null)
        {
            tenant.AgeBand = AgeBand.Adult;
            tenant.UpdatedAt = now;
            operations.Add(TransactWriteOperation.PutVersioned(tenant));
        }

        if (consent is not null)
        {
            operations.Add(TransactWriteOperation.Put(History(consent, ParentalConsentEvent.Ended, now)));
            operations.AddRange(consent.TokenHashes.Distinct().Select(h => TransactWriteOperation.Delete(ParentalConsentTokenEntity.GetPk(), ParentalConsentTokenEntity.GetSk(h))));
            consent.ParentEmail = null;   // the parental link ends with the teen state
            consent.ParentAllowedTryOn = false;
            consent.TokenHashes = [];
            consent.UpdatedAt = now;
            operations.Add(TransactWriteOperation.Put(consent));
        }

        var result = await repository.TransactWriteAsync(operations.Take(100).ToList(), ct);
        if (!result.Applied)
            throw new InvalidOperationException($"Teen → adult conversion failed: {result.Outcome}.");

        await inbox.AddAsync(user.TenantId, NotificationType.TeenBecameAdult, "adult", new Dictionary<string, string>(), now, ct);
        logger.LogInformation("Teen account {UserId} turned 18: converted to adult", user.Id);
    }

    private static ParentalConsentEventEntity History(ParentalConsentEntity consent, ParentalConsentEvent kind, DateTime now) => new()
    {
        Id = Domain.Extensions.Ulid.New(now),
        TenantId = consent.TenantId,
        Event = kind,
        At = now,
        ParentEmailHash = consent.ParentEmail is { } e ? Domain.Extensions.HashExtensions.Sha256Hex(e) : null,
        RequestId = consent.RequestId,
    };
}
