using Domain.Entity;
using Domain.Enum;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Microsoft.Extensions.Options;

namespace Infrastructure.Services;

/// <summary>
/// Stylist job gate (IStylistAllowanceService). The teen allowance row (TeenStylistUsageEntity) follows the item recognition
/// counter: reserve on start, commit on completion, release on failure, every write conditional on the row version, so
/// two concurrent starts can never both take the last slot.
/// </summary>
public sealed class StylistAllowanceService(
    IRepository repository,
    IEntitlementService entitlements,
    IOptionsMonitor<TeenOptions> teenOptions,
    TimeProvider timeProvider) : IStylistAllowanceService
{
    private const int Retries = 8;

    private DateTime Now => timeProvider.GetUtcNow().UtcDateTime;

    public static Task<TeenStylistUsageEntity?> LoadAsync(IRepository repository, string tenantId, CancellationToken ct) =>
        repository.GetAsync<TeenStylistUsageEntity>(TeenStylistUsageEntity.GetPk(tenantId), TeenStylistUsageEntity.GetSk(), ct);

    public async Task<EntitlementDecision> ReserveAsync(string tenantId, string jobId, TeenStylistKind kind, CancellationToken ct)
    {
        var snapshot = await entitlements.GetAsync(tenantId, ct);
        if (snapshot.Active.Tier == Tier.Premium || !await repository.IsTeenTenantAsync(tenantId, ct))
            return EntitlementPolicy.Check(snapshot.Active.Tier, EntitlementPolicy.CapabilityOf(kind), snapshot.Credits);

        var consent = await repository.GetAsync<ParentalConsentEntity>(ParentalConsentEntity.GetPk(tenantId), ParentalConsentEntity.GetSk(), ct);
        var consentActive = consent?.Status == ParentalConsentStatus.Active;
        var options = teenOptions.CurrentValue.Stylist;
        for (var attempt = 0; attempt < Retries; attempt++)
        {
            var now = Now;
            var usage = await LoadAsync(repository, tenantId, ct) ?? new TeenStylistUsageEntity { TenantId = tenantId };
            // A retried start of the same job already holds its slot.
            if (usage.Pending.Any(p => p.JobId == jobId))
                return EntitlementDecision.Allow() with { UsesTeenAllowance = true };

            var decision = EntitlementPolicy.CheckTeenStylist(snapshot.Active.Tier, kind, snapshot.Credits, consentActive,
                TeenStylistQuota.Of(usage, options, now));
            if (!decision.Allowed)
                return decision;

            var period = TeenStylistCalendar.Of(now);
            usage.Pending.RemoveAll(p => now - p.At >= TeenStylistQuota.PendingLifetime);
            usage.Pending.Add(new TeenStylistPending { JobId = jobId, Kind = kind, Day = period.Day, Week = period.Week, At = now });
            usage.UpdatedAt = now;
            if (await repository.SaveIfVersionAsync(usage, usage.Version, ct))
                return decision;
        }
        throw new InvalidOperationException("Teen stylist allowance could not be reserved (too many concurrent writers).");
    }

    public Task CommitAsync(string tenantId, string jobId, CancellationToken ct) => SettleAsync(tenantId, jobId, consumed: true, ct);

    public Task ReleaseAsync(string tenantId, string jobId, CancellationToken ct) => SettleAsync(tenantId, jobId, consumed: false, ct);

    private async Task SettleAsync(string tenantId, string jobId, bool consumed, CancellationToken ct)
    {
        for (var attempt = 0; attempt < Retries; attempt++)
        {
            var usage = await LoadAsync(repository, tenantId, ct);
            // No reservation = an adult's / a member's job, or settled already (SQS redelivery): nothing to do.
            var slot = usage?.Pending.FirstOrDefault(p => p.JobId == jobId);
            if (usage is null || slot is null)
                return;
            usage.Pending.Remove(slot);
            if (consumed)
                Charge(usage, slot);
            usage.UpdatedAt = Now;
            if (await repository.SaveIfVersionAsync(usage, usage.Version, ct))
                return;
        }
        throw new InvalidOperationException("Teen stylist allowance could not be settled (too many concurrent writers).");
    }

    /// <summary>A completed job counts in the day / week it was started in (a period already left behind is not counted).</summary>
    private static void Charge(TeenStylistUsageEntity usage, TeenStylistPending slot)
    {
        if (slot.Kind == TeenStylistKind.Outfit)
        {
            var order = string.CompareOrdinal(slot.Day, usage.Day);
            if (order > 0)
                (usage.Day, usage.OutfitsUsed) = (slot.Day, 0);
            if (order >= 0)
                usage.OutfitsUsed++;
            return;
        }

        var weekOrder = string.CompareOrdinal(slot.Week, usage.Week);
        if (weekOrder > 0)
            (usage.Week, usage.WeekPlansUsed, usage.TripPacksUsed) = (slot.Week, 0, 0);
        if (weekOrder < 0)
            return;
        if (slot.Kind == TeenStylistKind.WeekPlan)
            usage.WeekPlansUsed++;
        else
            usage.TripPacksUsed++;
    }
}
