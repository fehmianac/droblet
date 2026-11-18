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
/// Persists CreditLedger decisions. Account (versioned) + reservation + ledger entry are written in one transaction,
/// so a credit is never lost or double-spent; version conflicts are retried (another device wrote at the same time).
/// </summary>
public sealed class CreditService(
    IRepository repository,
    IOptionsMonitor<EntitlementOptions> options,
    TimeProvider timeProvider,
    ILogger<CreditService> logger) : ICreditService
{
    private const int MaxAttempts = 4;

    public async Task<CreditReservationResult> ReserveAsync(string tenantId, string idempotencyKey, string jobId, CancellationToken ct)
    {
        for (var attempt = 0; attempt < MaxAttempts; attempt++)
        {
            var existing = await GetReservationAsync(tenantId, idempotencyKey, ct);
            if (existing is not null)
                return new CreditReservationResult(ReserveOutcome.AlreadyReserved, null);

            var (_, context, account) = await CreditContextLoader.LoadAsync(repository, tenantId, options.CurrentValue, timeProvider, ct);
            var decision = CreditLedger.Reserve(CreditContextLoader.StateOf(account), context, cost: 1, existing: null);
            if (decision.Outcome == ReserveOutcome.Insufficient)
                return new CreditReservationResult(ReserveOutcome.Insufficient, decision.Reason);

            var now = timeProvider.GetUtcNow().UtcDateTime;
            account ??= new CreditAccountEntity { TenantId = tenantId };
            CreditContextLoader.Apply(account, decision.State, now);

            var reservation = new CreditReservationEntity
            {
                TenantId = tenantId,
                IdempotencyKey = idempotencyKey,
                JobId = jobId,
                Status = CreditReservationStatus.Reserved,
                FromAllowance = decision.FromAllowance,
                FromPack = decision.FromPack,
                PeriodStart = decision.State.PeriodStart,
                CreatedAt = now,
                UpdatedAt = now,
            };

            var result = await repository.TransactWriteAsync(
            [
                TransactWriteOperation.Create(reservation),
                TransactWriteOperation.PutVersioned(account),
                TransactWriteOperation.Put(LedgerEntry(tenantId,
                    decision.FromPack > 0 ? CreditLedgerEntryKind.PackReserved : CreditLedgerEntryKind.AllowanceReserved,
                    -decision.FromAllowance, -decision.FromPack, idempotencyKey, jobId, now)),
            ], ct);

            if (result.Applied)
                return new CreditReservationResult(ReserveOutcome.Reserved, null);
            if (result.Outcome == TransactOutcome.ConditionFailed && result.FailedIndex == 0)
                return new CreditReservationResult(ReserveOutcome.AlreadyReserved, null);
        }

        throw new InvalidOperationException($"Credit reservation for tenant {tenantId} could not be applied after {MaxAttempts} attempts.");
    }

    public async Task CommitAsync(string tenantId, string idempotencyKey, CancellationToken ct)
    {
        for (var attempt = 0; attempt < MaxAttempts; attempt++)
        {
            var reservation = await GetReservationAsync(tenantId, idempotencyKey, ct);
            if (reservation is null || reservation.Status == CreditReservationStatus.Committed)
                return;

            var now = timeProvider.GetUtcNow().UtcDateTime;
            reservation.Status = CreditReservationStatus.Committed;
            reservation.UpdatedAt = now;
            var result = await repository.TransactWriteAsync(
            [
                TransactWriteOperation.PutVersioned(reservation),
                TransactWriteOperation.Put(LedgerEntry(tenantId, CreditLedgerEntryKind.Committed, 0, 0, idempotencyKey, reservation.JobId, now)),
            ], ct);
            if (result.Applied)
                return;
        }

        throw new InvalidOperationException($"Credit commit for tenant {tenantId} could not be applied after {MaxAttempts} attempts.");
    }

    public async Task RefundAsync(string tenantId, string idempotencyKey, CancellationToken ct)
    {
        for (var attempt = 0; attempt < MaxAttempts; attempt++)
        {
            var reservation = await GetReservationAsync(tenantId, idempotencyKey, ct);
            if (reservation is null)
                return;

            var (_, context, account) = await CreditContextLoader.LoadAsync(repository, tenantId, options.CurrentValue, timeProvider, ct);
            var decision = CreditLedger.Refund(
                CreditContextLoader.StateOf(account),
                context,
                new ReservationSnapshot(reservation.Status, reservation.FromAllowance, reservation.FromPack, reservation.PeriodStart));
            if (decision.Outcome == RefundOutcome.AlreadyCommitted)
                return;

            var now = timeProvider.GetUtcNow().UtcDateTime;
            account ??= new CreditAccountEntity { TenantId = tenantId };
            CreditContextLoader.Apply(account, decision.State, now);

            // The reservation is removed so a retry of the same outfit can reserve again.
            var result = await repository.TransactWriteAsync(
            [
                TransactWriteOperation.DeleteExisting(reservation.Pk, reservation.Sk),
                TransactWriteOperation.PutVersioned(account),
                TransactWriteOperation.Put(LedgerEntry(tenantId, CreditLedgerEntryKind.Refunded,
                    decision.AllowanceReturned, decision.PackReturned, idempotencyKey, reservation.JobId, now)),
            ], ct);

            if (result.Applied)
            {
                logger.LogInformation("Refunded credit for tenant {TenantId} job {JobId}", tenantId, reservation.JobId);
                return;
            }
        }

        throw new InvalidOperationException($"Credit refund for tenant {tenantId} could not be applied after {MaxAttempts} attempts.");
    }

    public async Task AddPackCreditsAsync(string tenantId, int credits, string reference, CancellationToken ct)
    {
        for (var attempt = 0; attempt < MaxAttempts; attempt++)
        {
            var account = await repository.GetAsync<CreditAccountEntity>(CreditAccountEntity.GetPk(tenantId), CreditAccountEntity.GetSk(), ct)
                          ?? new CreditAccountEntity { TenantId = tenantId };
            var now = timeProvider.GetUtcNow().UtcDateTime;
            CreditContextLoader.Apply(account, CreditLedger.AddPack(CreditContextLoader.StateOf(account), credits), now);
            // The purchase reference is the receipt: the same store transaction never adds credits twice.
            var result = await repository.TransactWriteAsync(
            [
                TransactWriteOperation.Create(new MutationReceiptEntity { TenantId = tenantId, ClientMutationId = $"creditpack#{reference}", CreatedAt = now }),
                TransactWriteOperation.PutVersioned(account),
                TransactWriteOperation.Put(LedgerEntry(tenantId, CreditLedgerEntryKind.PackPurchased, 0, credits, null, reference, now)),
            ], ct);
            if (result.Applied || (result.Outcome == TransactOutcome.ConditionFailed && result.FailedIndex == 0))
                return;
        }

        throw new InvalidOperationException($"Credit pack for tenant {tenantId} could not be applied after {MaxAttempts} attempts.");
    }

    private Task<CreditReservationEntity?> GetReservationAsync(string tenantId, string key, CancellationToken ct) =>
        repository.GetAsync<CreditReservationEntity>(CreditReservationEntity.GetPk(tenantId), CreditReservationEntity.GetSk(key), ct);

    private static CreditLedgerEntryEntity LedgerEntry(string tenantId, CreditLedgerEntryKind kind, int allowanceDelta, int packDelta, string? key, string? reference, DateTime now) =>
        new()
        {
            Id = Ulid.New(now),
            TenantId = tenantId,
            Kind = kind,
            AllowanceDelta = allowanceDelta,
            PackDelta = packDelta,
            IdempotencyKey = key,
            Reference = reference,
            CreatedAt = now,
        };
}
