using Domain.Constant;
using Domain.Enum;

namespace Domain.Services;

public sealed record CreditState(DateTime? PeriodStart, int AllowanceUsed, int PackBalance)
{
    public static readonly CreditState Empty = new(null, 0, 0);
}

/// <summary>What the subscription grants right now. Premium = monthly allowance window; free = no allowance.</summary>
public sealed record CreditContext(DateTime? PeriodStart, DateTime? PeriodEnd, int MonthlyAllowance)
{
    public static readonly CreditContext NoAllowance = new(null, null, 0);
    public bool HasAllowance => PeriodStart is not null && MonthlyAllowance > 0;
}

public sealed record CreditBalance(int MonthlyAllowance, int AllowanceRemaining, int PackRemaining, DateTime? ResetsAt)
{
    public int TotalRemaining => AllowanceRemaining + PackRemaining;
}

public sealed record ReservationSnapshot(CreditReservationStatus Status, int FromAllowance, int FromPack, DateTime? PeriodStart);

public enum ReserveOutcome { Reserved, AlreadyReserved, Insufficient }

public sealed record ReserveDecision(ReserveOutcome Outcome, CreditState State, int FromAllowance, int FromPack, string? Reason)
{
    public bool Charged => Outcome == ReserveOutcome.Reserved;
}

public enum RefundOutcome { Refunded, AlreadyCommitted }

public sealed record RefundDecision(RefundOutcome Outcome, CreditState State, int AllowanceReturned, int PackReturned);

/// <summary>
/// Try-on credit rules (brief §5.2, README §9.1). Pure: no AWS, no clock.
/// - Premium includes MonthlyAllowance credits per subscription month; unused allowance does not roll over.
/// - Consumable pack credits are added on top and never expire; allowance is spent first (it expires).
/// - 1 credit per try-on image; text stylist costs nothing (EntitlementPolicy.CreditCost).
/// - A reservation is keyed by an idempotency key (same outfit + same body photo): a second request never charges again.
/// - Reserve on enqueue, commit on success, refund on terminal failure. Allowance from an earlier month is not refunded
///   into a new month (the new month already started full); pack credits are always refunded.
/// </summary>
public static class CreditLedger
{
    public static CreditState Normalize(CreditState state, CreditContext context)
    {
        if (!context.HasAllowance)
            return state;

        return state.PeriodStart == context.PeriodStart
            ? state
            : state with { PeriodStart = context.PeriodStart, AllowanceUsed = 0 };
    }

    public static CreditBalance Balance(CreditState state, CreditContext context)
    {
        var normalized = Normalize(state, context);
        var allowanceRemaining = context.HasAllowance
            ? Math.Max(0, context.MonthlyAllowance - normalized.AllowanceUsed)
            : 0;

        return new CreditBalance(
            context.HasAllowance ? context.MonthlyAllowance : 0,
            allowanceRemaining,
            Math.Max(0, normalized.PackBalance),
            context.HasAllowance ? context.PeriodEnd : null);
    }

    public static ReserveDecision Reserve(CreditState state, CreditContext context, int cost, ReservationSnapshot? existing)
    {
        if (cost <= 0)
            throw new ArgumentOutOfRangeException(nameof(cost), "Credit cost must be positive.");

        if (existing is not null)
            return new ReserveDecision(ReserveOutcome.AlreadyReserved, state, 0, 0, null);

        var normalized = Normalize(state, context);
        var balance = Balance(normalized, context);

        var fromAllowance = Math.Min(cost, balance.AllowanceRemaining);
        var fromPack = cost - fromAllowance;
        if (fromPack > balance.PackRemaining)
            return new ReserveDecision(ReserveOutcome.Insufficient, normalized, 0, 0, ErrorCodes.CreditsExhausted);

        var next = normalized with
        {
            AllowanceUsed = normalized.AllowanceUsed + fromAllowance,
            PackBalance = normalized.PackBalance - fromPack,
        };
        return new ReserveDecision(ReserveOutcome.Reserved, next, fromAllowance, fromPack, null);
    }

    public static RefundDecision Refund(CreditState state, CreditContext context, ReservationSnapshot reservation)
    {
        if (reservation.Status == CreditReservationStatus.Committed)
            return new RefundDecision(RefundOutcome.AlreadyCommitted, state, 0, 0);

        var normalized = Normalize(state, context);
        var allowanceBack = context.HasAllowance && reservation.PeriodStart == normalized.PeriodStart
            ? Math.Min(reservation.FromAllowance, normalized.AllowanceUsed)
            : 0;

        var next = normalized with
        {
            AllowanceUsed = normalized.AllowanceUsed - allowanceBack,
            PackBalance = normalized.PackBalance + reservation.FromPack,
        };
        return new RefundDecision(RefundOutcome.Refunded, next, allowanceBack, reservation.FromPack);
    }

    public static CreditState AddPack(CreditState state, int credits)
    {
        if (credits <= 0)
            throw new ArgumentOutOfRangeException(nameof(credits), "Pack credits must be positive.");
        return state with { PackBalance = state.PackBalance + credits };
    }

    /// <summary>
    /// Idempotency key of one try-on image: same body photo + same target + same target version = same image,
    /// so a repeat request returns the cached image and is never charged twice.
    /// </summary>
    public static string TryOnIdempotencyKey(string bodyPhotoId, TryOnTargetKind kind, string targetId, long targetVersion) =>
        $"tryon#{bodyPhotoId}#{kind}#{targetId}#{targetVersion}";
}
